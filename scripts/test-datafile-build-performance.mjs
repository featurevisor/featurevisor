import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

import {
  buildDatafile,
  buildTargetDatafile,
  Datasource,
  getProjectConfig,
} from "../packages/core/lib/index.js";

const FEATURE_COUNT = 1_200;
const GLOBAL_VARIABLE_COUNT = 2_000;
const SHARED_DEPENDENCY_DEPTH = 20;
const MAX_BUILD_DURATION_MS = 60_000;

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-build-performance-"));
  writeFile(
    path.join(root, "featurevisor.config.js"),
    "module.exports = { tags: ['selected', 'other'] };\n",
  );
  writeFile(
    path.join(root, "segments", "eligible.yml"),
    [
      "description: Eligible generated users",
      "conditions:",
      "  attribute: eligible",
      "  operator: equals",
      "  value: true",
      "",
    ].join("\n"),
  );

  for (let index = 0; index < FEATURE_COUNT; index++) {
    const lines = [
      `description: Generated feature ${index}`,
      "tags:",
      `  - ${index % 2 === 0 ? "selected" : "other"}`,
      "bucketBy: userId",
    ];
    if (index % 10 === 0) {
      lines.push("rules:", "  - key: eligible", "    segments: eligible", "    percentage: 100");
    } else {
      lines.push("rules: []");
    }
    if (index > 0 && index < SHARED_DEPENDENCY_DEPTH) {
      lines.push(`requiredFeatures: feature${index - 1}`);
    }
    writeFile(path.join(root, "features", `feature${index}.yml`), `${lines.join("\n")}\n`);
  }

  for (let index = 0; index < GLOBAL_VARIABLE_COUNT; index++) {
    writeFile(
      path.join(root, "variables", `variable${index}.yml`),
      [
        `description: Generated variable ${index}`,
        "tags:",
        `  - ${index % 2 === 0 ? "selected" : "other"}`,
        "type: string",
        `defaultValue: value-${index}`,
        `requiredFeatures: feature${SHARED_DEPENDENCY_DEPTH - 1}`,
        "overrides:",
        "  - key: generated",
        "    conditions:",
        "      attribute: region",
        "      operator: equals",
        "      value: eu",
        `    value: override-${index}`,
        "    overrides:",
        "      - key: eligible",
        "        segments: eligible",
        `        value: nested-${index}`,
      ].join("\n") + "\n",
    );
  }

  return root;
}

async function measure(label, operation) {
  const startedAt = performance.now();
  const result = await operation();
  const duration = performance.now() - startedAt;
  assert.ok(
    duration < MAX_BUILD_DURATION_MS,
    `${label} took ${duration.toFixed(2)}ms, above the ${MAX_BUILD_DURATION_MS}ms guard`,
  );
  console.log(`${label}: ${duration.toFixed(2)}ms`);
  return result;
}

async function main() {
  const root = createProject();

  try {
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    const existingState = { features: {} };

    const complete = await measure("Build complete generated project", () =>
      buildDatafile(
        projectConfig,
        datasource,
        { revision: "complete", environment: false },
        existingState,
      ),
    );
    assert.equal(Object.keys(complete.features).length, FEATURE_COUNT);
    assert.equal(Object.keys(complete.variables || {}).length, GLOBAL_VARIABLE_COUNT);
    assert.deepEqual(Object.keys(complete.segments), ["eligible"]);

    const tagged = await measure("Build selected tag", () =>
      buildDatafile(
        projectConfig,
        datasource,
        { revision: "tagged", environment: false, tag: "selected" },
        existingState,
      ),
    );
    assert.equal(Object.keys(tagged.variables || {}).length, GLOBAL_VARIABLE_COUNT / 2);
    assert.ok(Object.prototype.hasOwnProperty.call(tagged.features, "feature0"));
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        tagged.features,
        `feature${SHARED_DEPENDENCY_DEPTH - 1}`,
      ),
    );

    const targeted = await measure("Build selected Target", () =>
      buildTargetDatafile({
        projectConfig,
        datasource,
        target: {
          includeFeatures: ["feature1*"],
          includeVariables: ["variable1*"],
        },
        environment: false,
        existingState,
        revision: "targeted",
      }),
    );
    assert.ok(Object.keys(targeted.features).length > 0);
    assert.ok(Object.keys(targeted.variables || {}).length > 0);
    assert.ok(Object.prototype.hasOwnProperty.call(targeted.features, "feature0"));

    console.log(
      `Verified ${FEATURE_COUNT} features and ${GLOBAL_VARIABLE_COUNT} global variables with a shared dependency depth of ${SHARED_DEPENDENCY_DEPTH}.`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
