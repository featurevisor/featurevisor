import type { DatafileContent, Feature } from "@featurevisor/types";

export function createFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    bucketBy: "userId",
    traffic: [{ key: "everyone", segments: "*", percentage: 100000, allocation: [] }],
    ...overrides,
  };
}

export function createDatafile(overrides: Partial<DatafileContent> = {}): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "revision-1",
    featurevisorVersion: "2.27.0",
    segments: {},
    features: {},
    ...overrides,
  };
}

export function createComplexDatafile(): DatafileContent {
  return createDatafile({
    revision: "complex-1",
    segments: {
      dutch: {
        conditions: { attribute: "country", operator: "equals", value: "nl" },
      },
      beta: {
        conditions: JSON.stringify({ attribute: "plan", operator: "equals", value: "beta" }),
      },
      adult: {
        conditions: { attribute: "age", operator: "greaterThanOrEquals", value: 18 },
      },
      supportedDevice: {
        conditions: {
          or: [
            { attribute: "device", operator: "equals", value: "desktop" },
            { attribute: "device", operator: "equals", value: "mobile" },
          ],
        },
      },
    },
    features: {
      experiment: createFeature({
        hash: "experiment-v1",
        variations: [
          {
            value: "control",
            variables: { greeting: "Hello", count: 1, ratio: 1.5, enabledCopy: false },
          },
          {
            value: "treatment",
            variables: { greeting: "Welcome", count: 2, ratio: 2.5, enabledCopy: true },
            variableOverrides: {
              greeting: [{ segments: "dutch", value: "Welkom" }],
            },
          },
        ],
        variablesSchema: {
          greeting: { type: "string", defaultValue: "Fallback" },
          count: { type: "integer", defaultValue: 0 },
          ratio: { type: "double", defaultValue: 0.5 },
          enabledCopy: { type: "boolean", defaultValue: false },
          items: { type: "array", defaultValue: ["default"] },
          config: { type: "object", defaultValue: { source: "default" } },
          jsonConfig: { type: "json", defaultValue: '{"source":"json"}' },
          retired: { type: "string", defaultValue: "old", deprecated: true },
        },
        force: [
          {
            conditions: { attribute: "role", operator: "equals", value: "blocked" },
            enabled: false,
          },
          {
            conditions: { attribute: "role", operator: "equals", value: "qa" },
            enabled: true,
            variation: "treatment",
            variables: { greeting: "QA", count: 99 },
          },
        ],
        traffic: [
          {
            key: "dutch-adults",
            segments: { and: ["dutch", "adult", { not: ["beta"] }] },
            percentage: 100000,
            variation: "treatment",
            variables: { items: ["nl"], config: { source: "rule" } },
          },
          {
            key: "beta-device",
            segments: { and: ["beta", "supportedDevice"] },
            percentage: 50000,
            allocation: [
              { variation: "control", range: [0, 50000] },
              { variation: "treatment", range: [50000, 100000] },
            ],
          },
          {
            key: "everyone",
            segments: "*",
            percentage: 100000,
            allocation: [
              { variation: "control", range: [0, 50000] },
              { variation: "treatment", range: [50000, 100000] },
            ],
          },
        ],
      }),
      prerequisite: createFeature({
        variations: [{ value: "off" }, { value: "ready" }],
        traffic: [
          {
            key: "everyone",
            segments: "*",
            percentage: 100000,
            allocation: [
              { variation: "off", range: [0, 50000] },
              { variation: "ready", range: [50000, 100000] },
            ],
          },
        ],
      }),
      dependent: createFeature({
        required: [{ key: "prerequisite", variation: "ready" }, "experiment"],
      }),
      disabledFallbacks: createFeature({
        disabledVariationValue: "disabled",
        variations: [{ value: "enabled" }],
        variablesSchema: {
          explicit: { type: "string", defaultValue: "default", disabledValue: "disabled-value" },
          optedIn: { type: "string", defaultValue: "default-value", useDefaultWhenDisabled: true },
          absent: { type: "string", defaultValue: "not-returned" },
        },
        traffic: [{ key: "off", segments: "*", percentage: 0, allocation: [] }],
      }),
      mutex: createFeature({
        ranges: [[20000, 40000]],
      }),
      deprecatedFeature: createFeature({ deprecated: true }),
    },
  });
}

export function deterministicBucketModule() {
  return {
    name: "deterministic-bucket",
    bucketValue: ({
      context,
      bucketValue,
    }: {
      context: Record<string, unknown>;
      bucketValue: number;
    }) => (typeof context.bucket === "number" ? context.bucket : bucketValue),
  };
}
