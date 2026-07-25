import type { DatafileContent, TestFeature } from "@featurevisor/types";

import { testFeature } from "./testFeature";

const featureKey = "checkout";

function createDatafile(): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "test",
    segments: {},
    features: {
      [featureKey]: {
        key: featureKey,
        bucketBy: "userId",
        variablesSchema: {
          count: { key: "count", type: "integer", defaultValue: 1 },
          enabled: { key: "enabled", type: "boolean", defaultValue: true },
          label: { key: "label", type: "string", defaultValue: "default" },
          nullable: { key: "nullable", type: "json", defaultValue: "fallback" },
        },
        variations: [{ value: "control" }],
        force: [
          {
            conditions: [{ attribute: "country", operator: "equals", value: "child" }],
            enabled: true,
            variation: "control",
            variables: {
              count: 2,
            },
          },
        ],
        traffic: [],
      },
    },
  };
}

function createDatasource() {
  return {
    readFeature: jest.fn(async () => ({ key: featureKey })),
  } as any;
}

describe("core: feature tester behavior", () => {
  it("lets child context override root context for values and detailed evaluations", async () => {
    const test = {
      key: featureKey,
      feature: featureKey,
      assertions: [
        {
          description: "child override",
          context: { country: "parent", userId: "root" },
          expectedToBeEnabled: false,
          children: [
            {
              context: { country: "child" },
              expectedToBeEnabled: true,
              expectedVariation: "control",
              expectedVariables: { count: 2 },
              expectedEvaluations: {
                flag: { enabled: true, reason: "forced" },
                variation: { reason: "forced" },
                variables: {
                  count: { variableValue: 2, reason: "forced" },
                },
              },
            },
          ],
        },
      ],
    } as unknown as TestFeature;

    const result = await testFeature(
      createDatasource(),
      {} as any,
      test,
      { quiet: true },
      new Map([[false, createDatafile()]]),
    );

    expect(result).toEqual(expect.objectContaining({ passed: true }));
    expect(result.assertions[0].errors).toEqual([]);
  });

  it("honors falsey and null default values by property presence", async () => {
    const test = {
      key: featureKey,
      feature: featureKey,
      assertions: [
        {
          description: "falsey defaults",
          context: {},
          expectedVariation: "",
          defaultVariationValue: "",
          expectedVariables: {
            count: 0,
            enabled: false,
            label: "",
            nullable: null,
          },
          defaultVariableValues: {
            count: 0,
            enabled: false,
            label: "",
            nullable: null,
          },
        },
      ],
    } as unknown as TestFeature;

    const result = await testFeature(
      createDatasource(),
      {} as any,
      test,
      { quiet: true },
      new Map([[false, createDatafile()]]),
    );

    expect(result.passed).toBe(true);
    expect(result.assertions[0].errors).toEqual([]);
  });
});
