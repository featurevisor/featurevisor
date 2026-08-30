import type { DatafileContent, TestVariable } from "@featurevisor/types";
import * as featurevisorSdk from "@featurevisor/sdk";

import { testVariable } from "./testVariable";

function datafile(value: unknown): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "test",
    segments: {},
    features: {},
    variables: {
      settings: {
        type: "object",
        defaultValue: value as any,
      },
    },
  };
}

function requiredFeatureDatafile(): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "required-feature-test",
    segments: {},
    features: {
      checkout: {
        bucketBy: ["userId"],
        variations: [{ value: "control" }, { value: "treatment" }],
        traffic: [
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
      },
    },
    variables: {
      settings: {
        type: "string",
        defaultValue: "control settings",
        requiredFeatures: ["checkout"],
        overrides: [
          {
            key: "treatment",
            segments: "*",
            requiredFeatures: [{ feature: "checkout", variation: "treatment" }],
            value: "treatment settings",
          },
        ],
      },
    },
  };
}

function requiredFeatureChainDatafile(): DatafileContent {
  const result = requiredFeatureDatafile();
  result.features.gate = {
    bucketBy: ["userId"],
    traffic: [
      {
        key: "everyone",
        segments: "*",
        percentage: 50000,
      },
    ],
  };
  result.features.checkout.requiredFeatures = [{ feature: "gate", enabled: true }];
  result.variables!.settings = {
    type: "string",
    defaultValue: "chain matched",
    disabledValue: "chain blocked",
    requiredFeatures: [{ feature: "checkout", enabled: true }],
  };
  return result;
}

function multipleRequiredFeaturesDatafile(): DatafileContent {
  const result = requiredFeatureDatafile();
  result.features.recommendations = {
    bucketBy: ["userId"],
    variations: [{ value: "control" }, { value: "treatment" }],
    traffic: [
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
  };
  result.variables!.settings = {
    type: "string",
    defaultValue: "default",
    requiredFeatures: ["checkout", "recommendations"],
    overrides: [
      {
        key: "mixed",
        segments: "*",
        requiredFeatures: [
          { feature: "checkout", variation: "treatment" },
          { feature: "recommendations", variation: "control" },
        ],
        value: "mixed",
      },
    ],
  };
  return result;
}

function contextualDatafile(): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "child-test",
    segments: {},
    features: {},
    variables: {
      settings: {
        type: "string",
        defaultValue: "base",
        overrides: [
          {
            key: "amsterdam",
            conditions: [
              { attribute: "country", operator: "equals", value: "nl" },
              { attribute: "city", operator: "equals", value: "amsterdam" },
            ],
            value: "amsterdam",
          },
          {
            key: "netherlands",
            conditions: { attribute: "country", operator: "equals", value: "nl" },
            value: "netherlands",
          },
        ],
      },
    },
  };
}

describe("core: test global variable", () => {
  it("can assert evaluation details without pinning the value", async () => {
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            expectedEvaluation: { reason: "variable_default" },
          },
        ],
      },
      { quiet: true } as any,
      new Map([["production", datafile({ changing: "value" })]]),
    );

    expect(result.passed).toBe(true);
  });

  it("compares nested values, evaluation fields, sticky values, and target datafiles", async () => {
    const test: TestVariable = {
      variable: "settings",
      assertions: [
        {
          description: "base",
          environment: "production",
          expectedValue: { items: ["one", { enabled: true }] },
          expectedEvaluation: {
            reason: "variable_default",
            variable: {
              type: "object",
              defaultValue: { items: ["one", { enabled: true }] },
            },
          },
        },
        {
          description: "sticky",
          environment: "production",
          stickyVariables: { settings: { items: ["sticky"] } },
          expectedValue: { items: ["sticky"] },
          expectedEvaluation: { reason: "sticky" },
        },
        {
          description: "target",
          environment: "production",
          target: "web",
          expectedValue: { target: true },
        },
      ],
    };
    const result = await testVariable(
      test,
      { quiet: true } as any,
      new Map([
        ["production", datafile({ items: ["one", { enabled: true }] })],
        ["production-target-web", datafile({ target: true })],
      ]),
    );

    expect(result.passed).toBe(true);
    expect(result.assertions).toHaveLength(3);
    expect(result.assertions.every((assertion) => assertion.passed)).toBe(true);
  });

  it("reports value and evaluation mismatches", async () => {
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            expectedValue: { expected: true },
            expectedEvaluation: { reason: "variable_override_rule" },
          },
        ],
      },
      { quiet: true } as any,
      new Map([["production", datafile({ actual: true })]]),
    );

    expect(result.passed).toBe(false);
    expect(result.assertions[0].errors).toEqual([
      expect.objectContaining({ type: "variable" }),
      expect.objectContaining({ type: "evaluation" }),
    ]);
  });

  it("uses at for required feature bucketing and stickyFeatures for fixed dependencies", async () => {
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          {
            description: "control bucket",
            environment: "production",
            at: 25,
            expectedValue: "control settings",
            expectedEvaluation: { reason: "variable_default" },
          },
          {
            description: "treatment bucket",
            environment: "production",
            at: 75,
            expectedValue: "treatment settings",
            expectedEvaluation: {
              reason: "variable_override_rule",
              variableOverrideKey: "treatment",
            },
          },
          {
            description: "sticky treatment",
            environment: "production",
            at: 25,
            stickyFeatures: {
              checkout: { enabled: true, variation: "treatment" },
            },
            expectedValue: "treatment settings",
            expectedEvaluation: { variableOverrideKey: "treatment" },
          },
        ],
      },
      { quiet: true } as any,
      new Map([["production", requiredFeatureDatafile()]]),
    );

    expect(result.passed).toBe(true);
    expect(result.assertions).toHaveLength(3);
    expect(result.assertions.every((assertion) => assertion.passed)).toBe(true);
  });

  it("supports bucket boundaries and decimals without bucketing the global variable itself", async () => {
    const requiredResult = await testVariable(
      {
        variable: "settings",
        assertions: [
          { environment: "production", at: 0, expectedValue: "control settings" },
          { environment: "production", at: 37.5, expectedValue: "control settings" },
          { environment: "production", at: 100, expectedValue: "treatment settings" },
        ],
      },
      { quiet: true } as any,
      new Map([["production", requiredFeatureDatafile()]]),
    );
    const directResult = await testVariable(
      {
        variable: "settings",
        assertions: [
          { environment: "production", at: 0, expectedValue: "unchanged" },
          { environment: "production", at: 100, expectedValue: "unchanged" },
        ],
      },
      { quiet: true } as any,
      new Map([["production", datafile("unchanged")]]),
    );

    expect(requiredResult.passed).toBe(true);
    expect(directResult.passed).toBe(true);
  });

  it("uses sticky results per feature while at controls other required features", async () => {
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            at: 25,
            stickyFeatures: {
              checkout: { enabled: true, variation: "treatment" },
            },
            expectedValue: "mixed",
            expectedEvaluation: { variableOverrideKey: "mixed" },
          },
        ],
      },
      { quiet: true } as any,
      new Map([["production", multipleRequiredFeaturesDatafile()]]),
    );

    expect(result.passed).toBe(true);
  });

  it("applies at throughout required feature dependency chains", async () => {
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          { environment: "production", at: 25, expectedValue: "chain matched" },
          {
            environment: "production",
            at: 75,
            expectedValue: "chain blocked",
            expectedEvaluation: { reason: "required_features_unmet" },
          },
        ],
      },
      { quiet: true } as any,
      new Map([["production", requiredFeatureChainDatafile()]]),
    );

    expect(result.passed).toBe(true);
  });

  it.each([false, 0, "", [], {}, null])("compares the falsey or empty value %p", async (value) => {
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [{ environment: "production", expectedValue: value as any }],
      },
      { quiet: true } as any,
      new Map([["production", datafile(value)]]),
    );

    expect(result.passed).toBe(true);
  });

  it("preserves a falsey caller default", async () => {
    const required = requiredFeatureDatafile();
    required.features.checkout.traffic![0].percentage = 0;
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            at: 50,
            defaultVariableValue: false,
            expectedValue: false,
            expectedEvaluation: { reason: "required_features_unmet" },
          },
        ],
      },
      { quiet: true } as any,
      new Map([["production", required]]),
    );

    expect(result.passed).toBe(true);
  });

  it("supports child context inheritance and isolated sticky state", async () => {
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            context: { country: "nl" },
            stickyVariables: { settings: "parent sticky" },
            expectedValue: "parent sticky",
            children: [
              {
                context: { city: "amsterdam" },
                expectedValue: "amsterdam",
                expectedEvaluation: { variableOverrideKey: "amsterdam" },
              },
              {
                stickyVariables: { settings: "child sticky" },
                expectedValue: "child sticky",
                expectedEvaluation: { reason: "sticky" },
              },
            ],
          },
          {
            environment: "production",
            context: { country: "nl" },
            children: [
              {
                context: { city: "amsterdam" },
                expectedValue: "amsterdam",
              },
            ],
          },
        ],
      },
      { quiet: true } as any,
      new Map([["production", contextualDatafile()]]),
    );

    expect(result.passed).toBe(true);
    expect(result.assertions).toHaveLength(2);
  });

  it("prints the selected datafile when requested", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await testVariable(
        {
          variable: "settings",
          assertions: [{ environment: "production", expectedValue: "shown" }],
        },
        { quiet: true, showDatafile: true } as any,
        new Map([["production", datafile("shown")]]),
      );
      expect(log.mock.calls.flat().join("\n")).toContain('"revision": "test"');
    } finally {
      log.mockRestore();
    }
  });

  it("does not fall back to the base datafile when a target datafile is missing", async () => {
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            target: "web",
            expectedValue: "base",
          },
        ],
      },
      { quiet: true } as any,
      new Map([["production", datafile("base")]]),
    );

    expect(result.passed).toBe(false);
    expect(result.assertions[0].errors).toEqual([
      expect.objectContaining({
        message: 'datafile not found for environment "production" and target "web"',
      }),
    ]);
  });

  it("closes parent and child instances after successful assertions", async () => {
    const createFeaturevisor = featurevisorSdk.createFeaturevisor;
    const parentClose = jest.fn();
    const childClose = jest.fn();
    const createSpy = jest
      .spyOn(featurevisorSdk, "createFeaturevisor")
      .mockImplementation((options) => {
        const f = createFeaturevisor(options);
        const originalParentClose = f.close.bind(f);
        const originalSpawn = f.spawn.bind(f);
        jest.spyOn(f, "close").mockImplementation(async () => {
          parentClose();
          await originalParentClose();
        });
        jest.spyOn(f, "spawn").mockImplementation((context, spawnOptions) => {
          const child = originalSpawn(context, spawnOptions);
          const originalChildClose = child.close.bind(child);
          jest.spyOn(child, "close").mockImplementation(() => {
            childClose();
            originalChildClose();
          });
          return child;
        });
        return f;
      });

    try {
      const result = await testVariable(
        {
          variable: "settings",
          assertions: [
            {
              environment: "production",
              expectedValue: "base",
              children: [{ expectedValue: "base" }],
            },
          ],
        },
        { quiet: true } as any,
        new Map([["production", datafile("base")]]),
      );

      expect(result.passed).toBe(true);
      expect(parentClose).toHaveBeenCalledTimes(1);
      expect(childClose).toHaveBeenCalledTimes(1);
    } finally {
      createSpy.mockRestore();
    }
  });

  it("closes parent and child instances when child evaluation throws", async () => {
    const createFeaturevisor = featurevisorSdk.createFeaturevisor;
    const parentClose = jest.fn();
    const childClose = jest.fn();
    const createSpy = jest
      .spyOn(featurevisorSdk, "createFeaturevisor")
      .mockImplementation((options) => {
        const f = createFeaturevisor(options);
        const originalParentClose = f.close.bind(f);
        const originalSpawn = f.spawn.bind(f);
        jest.spyOn(f, "close").mockImplementation(async () => {
          parentClose();
          await originalParentClose();
        });
        jest.spyOn(f, "spawn").mockImplementation((context, spawnOptions) => {
          const child = originalSpawn(context, spawnOptions);
          const originalChildClose = child.close.bind(child);
          jest.spyOn(child, "close").mockImplementation(() => {
            childClose();
            originalChildClose();
          });
          jest.spyOn(child, "evaluateVariable").mockImplementation(() => {
            throw new Error("evaluation failed");
          });
          return child;
        });
        return f;
      });

    try {
      await expect(
        testVariable(
          {
            variable: "settings",
            assertions: [
              {
                environment: "production",
                expectedValue: "base",
                children: [{ expectedValue: "base" }],
              },
            ],
          },
          { quiet: true } as any,
          new Map([["production", datafile("base")]]),
        ),
      ).rejects.toThrow("evaluation failed");
      expect(parentClose).toHaveBeenCalledTimes(1);
      expect(childClose).toHaveBeenCalledTimes(1);
    } finally {
      createSpy.mockRestore();
    }
  });
});
