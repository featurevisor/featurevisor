import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { createFeaturevisor } from "../packages/sdk/cjs/index.js";

const FEATURE_COUNT = 250;
const FEATURE_VARIABLE_COUNT = 20;
const GLOBAL_VARIABLE_COUNT = 2_000;
const WORST_CASE_OVERRIDE_COUNT = 100;
const WORST_CASE_EVALUATIONS = 10_000;
const MAX_OPERATION_DURATION_MS = 10_000;

const features = {};
for (let featureIndex = 0; featureIndex < FEATURE_COUNT; featureIndex++) {
  const variablesSchema = {};
  for (let variableIndex = 0; variableIndex < FEATURE_VARIABLE_COUNT; variableIndex++) {
    variablesSchema[`value${variableIndex}`] = {
      type: "string",
      defaultValue: `${featureIndex}:${variableIndex}`,
    };
  }

  features[`feature${featureIndex}`] = {
    hash: `feature-${featureIndex}`,
    bucketBy: "userId",
    variablesSchema,
    force: [{ segments: "*", enabled: true }],
    traffic: [],
  };
}

const variables = {};
for (let index = 0; index < GLOBAL_VARIABLE_COUNT; index++) {
  variables[`variable${index}`] = {
    hash: `variable-${index}`,
    type: "string",
    defaultValue: `value-${index}`,
  };
}
variables.worstCase = {
  hash: "variable-worst-case",
  type: "string",
  defaultValue: "default",
  requiredFeatures: ["feature0"],
  overrides: [
    ...Array.from({ length: WORST_CASE_OVERRIDE_COUNT }, (_, index) => ({
      key: `non-match-${index}`,
      conditions: JSON.stringify({
        attribute: "slot",
        operator: "equals",
        value: `slot-${index}`,
      }),
      value: `unexpected-${index}`,
    })),
    {
      key: "final-match",
      segments: "eligible",
      conditions: JSON.stringify({
        and: [
          { attribute: "country", operator: "equals", value: "nl" },
          { attribute: "plan", operator: "equals", value: "pro" },
        ],
      }),
      value: "matched",
    },
  ],
};

const datafile = {
  schemaVersion: "2",
  revision: "large-initial",
  segments: {
    eligible: {
      conditions: JSON.stringify({
        and: [
          { attribute: "active", operator: "equals", value: true },
          { attribute: "region", operator: "equals", value: "eu" },
        ],
      }),
    },
  },
  features,
  variables,
};

function measure(label, operation) {
  const startedAt = performance.now();
  const result = operation();
  const duration = performance.now() - startedAt;
  assert.ok(
    duration < MAX_OPERATION_DURATION_MS,
    `${label} took ${duration.toFixed(2)}ms, above the ${MAX_OPERATION_DURATION_MS}ms guard`,
  );
  console.log(`${label}: ${duration.toFixed(2)}ms`);
  return result;
}

async function main() {
  const f = measure("Create large SDK instance", () =>
    createFeaturevisor({ datafile, logLevel: "fatal" }),
  );
  const featureEvaluations = measure("Evaluate every feature snapshot", () =>
    f.getFeatureEvaluations({ userId: "performance-user" }),
  );
  const variableEvaluations = measure("Evaluate every global variable", () =>
    f.getVariableEvaluations({ userId: "performance-user" }),
  );

  assert.equal(Object.keys(featureEvaluations).length, FEATURE_COUNT);
  assert.equal(
    Object.keys(featureEvaluations.feature0.variables || {}).length,
    FEATURE_VARIABLE_COUNT,
  );
  assert.equal(Object.keys(variableEvaluations).length, GLOBAL_VARIABLE_COUNT + 1);
  assert.equal(variableEvaluations.variable1999, "value-1999");

  const worstCaseContext = {
    userId: "performance-user",
    slot: "not-present",
    active: true,
    region: "eu",
    country: "nl",
    plan: "pro",
  };
  measure(`Evaluate worst-case global variable ${WORST_CASE_EVALUATIONS} times`, () => {
    for (let index = 0; index < WORST_CASE_EVALUATIONS; index++) {
      assert.equal(f.getVariable("worstCase", worstCaseContext), "matched");
    }
  });

  let event;
  f.on("datafile_set", (details) => {
    event = details;
  });
  measure("Merge one changed global variable", () =>
    f.setDatafile({
      schemaVersion: "2",
      revision: "large-updated",
      segments: {},
      features: {},
      variables: {
        variable1999: {
          hash: "variable-1999-updated",
          type: "string",
          defaultValue: "updated",
        },
      },
    }),
  );

  assert.equal(f.getVariable("variable0"), "value-0");
  assert.equal(f.getVariable("variable1999"), "updated");
  assert.deepEqual(event.variables, ["variable1999"]);
  assert.deepEqual(event.features, []);

  await f.close();
  console.log(
    `Verified ${FEATURE_COUNT} features, ${FEATURE_COUNT * FEATURE_VARIABLE_COUNT} feature variables, and ${GLOBAL_VARIABLE_COUNT + 1} global variables.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
