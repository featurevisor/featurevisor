import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { createFeaturevisor } from "../packages/sdk/cjs/index.js";

const SEGMENT_COUNT = 100;
const FEATURE_COUNT = 1_000;
const GLOBAL_VARIABLE_COUNT = 1_000;
const SET_SAMPLES = 40;
const EVALUATION_SAMPLES = 12;
const EVALUATIONS_PER_SAMPLE = 100_000;

function createSegment(index, variant = "a") {
  return {
    conditions: JSON.stringify({
      and: [
        { attribute: "country", operator: "equals", value: "nl" },
        { attribute: "segment", operator: "equals", value: `${variant}-${index}` },
      ],
    }),
  };
}

function createDatafile(variant) {
  const segments = {};
  for (let index = 0; index < SEGMENT_COUNT; index++) {
    segments[`segment${index}`] = createSegment(index);
  }

  segments.benchmark = {
    conditions: JSON.stringify({
      and: [
        { attribute: "country", operator: "equals", value: "nl" },
        { attribute: "plan", operator: "equals", value: "pro" },
        { attribute: "age", operator: "greaterThanOrEquals", value: 18 },
      ],
    }),
  };

  const features = {
    benchmarkFeature: {
      hash: `benchmark-feature-${variant}`,
      bucketBy: "userId",
      variations: [
        { value: "control", variables: { copy: "Control" } },
        { value: "treatment", variables: { copy: "Treatment" } },
      ],
      variablesSchema: {
        copy: { type: "string", defaultValue: "Default" },
      },
      traffic: [
        {
          key: "benchmark",
          segments: JSON.stringify({ and: ["benchmark", { not: ["segment99"] }] }),
          percentage: 100000,
          allocation: [{ variation: "treatment", range: [0, 100000] }],
        },
      ],
    },
  };

  for (let index = 0; index < FEATURE_COUNT; index++) {
    features[`feature${index}`] = {
      hash: `feature-${index}-${variant}`,
      bucketBy: "userId",
      required: index === 0 ? undefined : [`feature${index - 1}`],
      traffic: [
        {
          key: "eligible",
          segments: `segment${index % SEGMENT_COUNT}`,
          percentage: 100000,
          allocation: [],
        },
      ],
    };
  }

  const variables = {
    benchmarkGlobal: {
      hash: `benchmark-global-${variant}`,
      type: "string",
      defaultValue: "Default",
      requiredFeatures: ["benchmarkFeature"],
      overrides: [
        {
          key: "benchmark",
          segments: JSON.stringify({ and: ["benchmark", { not: ["segment99"] }] }),
          conditions: JSON.stringify({
            and: [
              { attribute: "locale", operator: "equals", value: "nl-NL" },
              { attribute: "active", operator: "equals", value: true },
            ],
          }),
          value: "Matched",
        },
      ],
    },
  };

  for (let index = 0; index < GLOBAL_VARIABLE_COUNT; index++) {
    variables[`variable${index}`] = {
      hash: `variable-${index}-${variant}`,
      type: "string",
      defaultValue: `value-${index}`,
      requiredFeatures: [`feature${index % FEATURE_COUNT}`],
      overrides: [
        {
          key: "eligible",
          segments: `segment${index % SEGMENT_COUNT}`,
          value: `override-${index}`,
        },
      ],
    };
  }

  return {
    schemaVersion: "2",
    revision: `revision-${variant}`,
    segments,
    features,
    variables,
  };
}

function summarize(samples, unit = "ms") {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    min: sorted[0],
    average: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
    unit,
  };
}

function measure(operation) {
  const startedAt = performance.now();
  operation();
  return performance.now() - startedAt;
}

function measureSetOperation(operation) {
  const samples = [];
  for (let index = 0; index < SET_SAMPLES; index++) {
    globalThis.gc?.();
    samples.push(measure(() => operation(index)));
  }
  return summarize(samples);
}

function measureEvaluation(operation, expected) {
  for (let index = 0; index < 10_000; index++) operation();

  const samples = [];
  let result;
  for (let sample = 0; sample < EVALUATION_SAMPLES; sample++) {
    const duration = measure(() => {
      for (let index = 0; index < EVALUATIONS_PER_SAMPLE; index++) result = operation();
    });
    samples.push((duration * 1_000_000) / EVALUATIONS_PER_SAMPLE);
  }
  assert.deepEqual(result, expected);
  return summarize(samples, "ns/evaluation");
}

function measureFirstPartialUpdate(datafile) {
  const samples = [];
  for (let index = 0; index < SET_SAMPLES; index++) {
    globalThis.gc?.();
    const instance = createFeaturevisor({ datafile, logLevel: "fatal" });
    samples.push(
      measure(() =>
        instance.setDatafile({
          schemaVersion: "2",
          revision: `partial-${index}`,
          segments: {
            segment0: createSegment(0, index % 2 === 0 ? "b" : "a"),
          },
          features: {},
        }),
      ),
    );
  }
  return summarize(samples);
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

const datafileA = createDatafile("a");
const datafileB = createDatafile("b");

const initial = measureSetOperation((index) => {
  createFeaturevisor({ datafile: index % 2 === 0 ? datafileA : datafileB, logLevel: "fatal" });
});

const replacementInstance = createFeaturevisor({ datafile: datafileA, logLevel: "fatal" });
const fullReplacement = measureSetOperation((index) => {
  replacementInstance.setDatafile(index % 2 === 0 ? datafileB : datafileA, true);
});

const firstPartialUpdate = measureFirstPartialUpdate(datafileA);

const partialInstance = createFeaturevisor({ datafile: datafileA, logLevel: "fatal" });
partialInstance.setDatafile({
  schemaVersion: "2",
  revision: "partial-warmup",
  segments: { segment0: createSegment(0, "warmup") },
  features: {},
});
const cachedPartialUpdate = measureSetOperation((index) => {
  partialInstance.setDatafile({
    schemaVersion: "2",
    revision: `partial-${index}`,
    segments: {
      segment0: createSegment(0, index % 2 === 0 ? "b" : "a"),
    },
    features: {},
  });
});

const f = createFeaturevisor({ datafile: datafileA, logLevel: "fatal" });
const context = {
  userId: "benchmark-user",
  country: "nl",
  plan: "pro",
  age: 34,
  segment: "not-matched",
  locale: "nl-NL",
  active: true,
};

printResult({
  scale: {
    segments: Object.keys(datafileA.segments).length,
    features: Object.keys(datafileA.features).length,
    globalVariables: Object.keys(datafileA.variables).length,
  },
  datafile: { initial, fullReplacement, firstPartialUpdate, cachedPartialUpdate },
  evaluation: {
    flag: measureEvaluation(() => f.isEnabled("benchmarkFeature", context), true),
    variation: measureEvaluation(() => f.getVariation("benchmarkFeature", context), "treatment"),
    featureVariable: measureEvaluation(
      () => f.getVariable("benchmarkFeature", "copy", context),
      "Treatment",
    ),
    globalVariable: measureEvaluation(() => f.getVariable("benchmarkGlobal", context), "Matched"),
  },
});
