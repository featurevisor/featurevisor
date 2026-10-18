import { getTestDatafileKey } from "./datafileKey";
import type { DatafileContent, TestFeature } from "@featurevisor/types";

import { getFeatureAssertionsFromMatrix } from "../list/matrix";
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
  it("does not fall back to the base datafile when a target datafile is missing", async () => {
    const result = await testFeature(
      createDatasource(),
      {} as any,
      {
        feature: featureKey,
        assertions: [
          {
            description: "target",
            environment: "production",
            target: "web",
            at: 50,
            expectedToBeEnabled: true,
          },
        ],
      },
      { quiet: true },
      new Map([[getTestDatafileKey("production"), createDatafile()]]),
    );

    expect(result.passed).toBe(false);
    expect(result.assertions[0].errors).toEqual([
      expect.objectContaining({
        message: 'datafile not found for environment "production" and target "web"',
      }),
    ]);
  });

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
                flag: {
                  enabled: true,
                  reason: "forced",
                  force: {
                    conditions: [{ attribute: "country", operator: "equals", value: "child" }],
                    enabled: true,
                    variation: "control",
                    variables: { count: 2 },
                  },
                },
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
      new Map([[getTestDatafileKey(false), createDatafile()]]),
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
      new Map([[getTestDatafileKey(false), createDatafile()]]),
    );

    expect(result.passed).toBe(true);
    expect(result.assertions[0].errors).toEqual([]);
  });

  it("does not evaluate a variation when an optional parsed field is undefined", async () => {
    const test = {
      key: featureKey,
      feature: featureKey,
      assertions: [
        {
          description: "flag only",
          context: {},
          expectedToBeEnabled: false,
          expectedVariation: undefined,
        },
      ],
    } as unknown as TestFeature;

    const result = await testFeature(
      createDatasource(),
      {} as any,
      test,
      { quiet: true },
      new Map([[getTestDatafileKey(false), createDatafile()]]),
    );

    expect(result.passed).toBe(true);
    expect(result.assertions[0].errors).toEqual([]);
  });

  it("does not compare the flag when a matrix assertion only expects a variation", async () => {
    const test = {
      key: featureKey,
      feature: featureKey,
      assertions: getFeatureAssertionsFromMatrix(0, {
        description: "variation only",
        matrix: { country: ["child"] },
        at: 50,
        context: { country: "${{ country }}" },
        expectedVariation: "control",
      }),
    } as unknown as TestFeature;

    const result = await testFeature(
      createDatasource(),
      {} as any,
      test,
      { quiet: true },
      new Map([[getTestDatafileKey(false), createDatafile()]]),
    );

    expect(result.assertions[0].errors).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("applies sticky global variables to a feature gated on a variable", async () => {
    const datafile = {
      schemaVersion: "4",
      revision: "test",
      segments: {},
      variables: { maintenanceMode: { type: "boolean", defaultValue: false } },
      features: {
        [featureKey]: {
          bucketBy: "userId",
          conditions: [{ variable: "maintenanceMode", operator: "equals", value: false }],
          traffic: [{ key: "everyone", conditions: "*", percentage: 100000, allocation: [] }],
        },
      },
    } as unknown as DatafileContent;
    const test = {
      key: featureKey,
      feature: featureKey,
      assertions: [
        {
          description: "maintenance",
          at: 50,
          stickyVariables: { maintenanceMode: true },
          expectedToBeEnabled: false,
          children: [
            {
              description: "normal",
              stickyVariables: { maintenanceMode: false },
              expectedToBeEnabled: true,
            },
          ],
        },
        { description: "normal", at: 50, expectedToBeEnabled: true },
      ],
    } as unknown as TestFeature;

    const result = await testFeature(
      createDatasource(),
      {} as any,
      test,
      { quiet: true },
      new Map([[getTestDatafileKey(false), datafile]]),
    );

    expect(result.assertions.flatMap((assertion) => assertion.errors)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});
