import { getTestDatafileKey } from "./datafileKey";
import type { DatafileContent, TestScenario, TestVariable } from "@featurevisor/types";
import * as featurevisorSdk from "@featurevisor/sdk";

import { testVariable } from "./testVariable";

// Copy source exports so failure and cleanup tests can replace the factory.
jest.mock("@featurevisor/sdk", () => ({
  __esModule: true,
  ...jest.requireActual("@featurevisor/sdk"),
}));

describe("segment checks preserve compiled definitions and restore missing authored segments", () => {
  it.each(["scenario", "variable"])(
    "evaluates %s segments through selected Target definitions without using variable stickies as segment results",
    async (kind) => {
      const selected = datafile({});
      selected.segments.audience = {
        conditions: [{ attribute: "plan", operator: "equals", value: "premium" }],
      };
      const spec: TestScenario | TestVariable = {
        ...(kind === "variable" ? { variable: "settings" } : { scenario: "journeys.audience" }),
        _segments: {
          audience: {
            description: "Audience",
            conditions: [
              { attribute: "country", operator: "equals", value: "nl" },
              { attribute: "plan", operator: "equals", value: "premium" },
            ],
          },
        },
        assertions: [
          {
            target: "web",
            at: 100,
            context: { country: "nl", plan: "premium" },
            stickyVariables: { audience: false },
            checks: [{ segment: "audience", matches: true }],
            children: [
              { context: { plan: "basic" }, checks: [{ segment: "audience", matches: false }] },
              { context: {}, checks: [{ segment: "audience", matches: true }] },
            ],
          },
        ],
      };
      const before = JSON.stringify(spec);
      expect(
        (await testVariable(spec, {}, new Map([[getTestDatafileKey(false, "web"), selected]])))
          .passed,
      ).toBe(true);
      expect(JSON.stringify(spec)).toBe(before);
      delete selected.segments.audience;
      expect(
        (await testVariable(spec, {}, new Map([[getTestDatafileKey(false, "web"), selected]])))
          .passed,
      ).toBe(true);
    },
  );
  it("fails missing definitions and negative expectations with segment evidence", async () => {
    const spec: TestScenario = {
      scenario: "audience",
      assertions: [{ checks: [{ segment: "missing", matches: false }] }],
    };
    const result = await testVariable(
      spec,
      {},
      new Map([[getTestDatafileKey(false), datafile({})]]),
    );
    expect(result.passed).toBe(false);
    expect(result.assertions[0].errors![0].actual).toContain('Segment "missing"');
    expect(result.assertions[0].errors![0].expected).toBe("valid check references");
  });
});

describe("check reference preflight", () => {
  it.each(["and", "or", "not"])(
    "rejects unknown references in skipped %s branches before evaluation",
    async (group) => {
      const onEvaluation = jest.fn();
      const first = {
        variable: "settings",
        operator: "equals",
        value: group === "or" ? "ok" : "different",
      };
      const invalidReferences = [
        { variable: "missing", operator: "equals", value: "ok" },
        { feature: "missing", enabled: false },
        { feature: "checkout", variable: "missing", operator: "isNull" },
        { variable: "settings", operator: "equals", compareTo: { variable: "missing" } },
        { segment: "missing", matches: false },
      ];
      for (const invalid of invalidReferences) {
        for (const child of [false, true]) {
          const checks = [{ [group]: [first, invalid] }];
          const spec = {
            scenario: "preflight",
            assertions: [
              {
                target: "web",
                ...(child ? { checks: [first], children: [{ checks }] } : { checks }),
              },
            ],
          } as unknown as TestScenario;
          const selected = datafile("ok");
          selected.features.checkout = { bucketBy: "userId", traffic: [] };
          const result = await testVariable(
            spec,
            { onEvaluation },
            new Map([[getTestDatafileKey(false, "web"), selected]]),
          );
          expect(result.passed).toBe(false);
          expect(result.assertions[0].errors![0].expected).toBe("valid check references");
          expect(onEvaluation).not.toHaveBeenCalled();
        }
      }
    },
  );
});

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

function checksDatafile(): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "checks-test",
    segments: {},
    features: {
      checkout: {
        bucketBy: ["userId"],
        variablesSchema: {
          limit: { type: "integer", defaultValue: 5 },
          malformed: { type: "json", defaultValue: "{" },
        },
        traffic: [
          {
            key: "everyone",
            segments: "*",
            percentage: 100000,
          },
        ],
      },
    },
    variables: {
      settings: {
        type: "object",
        defaultValue: {
          region: "default",
          nested: { nullable: null, "dot.key": 7 },
          items: [{ limit: 4 }],
        },
        overrides: [
          {
            key: "netherlands",
            conditions: { attribute: "country", operator: "equals", value: "nl" },
            value: {
              region: "nl",
              nested: { nullable: null, "dot.key": 7 },
              items: [{ limit: 4 }],
            },
          },
          {
            key: "great-britain",
            conditions: { attribute: "country", operator: "equals", value: "gb" },
            value: {
              region: "gb",
              nested: { nullable: null, "dot.key": 8 },
              items: [{ limit: 6 }],
            },
          },
        ],
      },
      limit: { type: "integer", defaultValue: 12 },
      malformed: { type: "json", defaultValue: "{" },
    },
  };
}

describe("core: test global variable", () => {
  it("checks flags and variations with at using both scenario and variable specs", async () => {
    for (const owner of [{ scenario: "checkout" }, { variable: "settings" }]) {
      const result = await testVariable(
        {
          ...owner,
          assertions: [
            {
              environment: "production",
              at: 25,
              checks: [{ feature: "checkout", enabled: true, variation: "control" }],
            },
            {
              environment: "production",
              at: 75,
              checks: [{ feature: "checkout", variation: "treatment" }],
            },
          ],
        },
        { quiet: true } as any,
        new Map([[getTestDatafileKey("production"), requiredFeatureDatafile()]]),
      );
      expect(result.passed).toBe(true);
      expect(result.assertions).toHaveLength(2);
    }
  });

  it("uses child contexts and isolated sticky assignments for feature checks", async () => {
    const df = requiredFeatureDatafile();
    df.segments.allowed = {
      conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
    };
    df.features.checkout.traffic[0].segments = ["allowed"];
    df.features.checkout.disabledVariationValue = "control";
    const result = await testVariable(
      {
        scenario: "child feature checks",
        assertions: [
          {
            environment: "production",
            at: 75,
            context: { country: "nl" },
            stickyFeatures: { checkout: { enabled: false, variation: "control" } },
            checks: [{ feature: "checkout", enabled: false, variation: "control" }],
            children: [
              { checks: [{ feature: "checkout", enabled: true, variation: "treatment" }] },
              {
                context: { country: "gb" },
                checks: [{ feature: "checkout", enabled: false, variation: "control" }],
              },
              {
                stickyFeatures: { checkout: { enabled: true, variation: "control" } },
                checks: [{ feature: "checkout", enabled: true, variation: "control" }],
              },
            ],
          },
        ],
      },
      { quiet: true } as any,
      new Map([[getTestDatafileKey("production"), df]]),
    );
    expect(result.passed).toBe(true);
  });

  it("does not resolve missing feature checks from the base datafile or sticky assignments", async () => {
    const result = await testVariable(
      {
        scenario: "target feature checks",
        assertions: [
          {
            environment: "production",
            target: "web",
            stickyFeatures: { checkout: { enabled: false, variation: "control" } },
            checks: [
              { feature: "checkout", enabled: false },
              { feature: "checkout", variation: null },
            ],
          },
        ],
      },
      { quiet: true } as any,
      new Map([
        [getTestDatafileKey("production"), requiredFeatureDatafile()],
        [getTestDatafileKey("production", "web"), datafile("target")],
      ]),
    );
    expect(result.passed).toBe(false);
    expect(result.assertions[0].errors).toHaveLength(1);
    for (const error of result.assertions[0].errors!) {
      expect(error.expected).toBe("valid check references");
      expect(error.actual).toContain('Feature "checkout" is absent from the selected datafile');
    }
  });

  it.each(["isEnabled", "getVariation"] as const)(
    "does not hide %s exceptions under NOT",
    async (method) => {
      const create = featurevisorSdk.createFeaturevisor;
      const spy = jest
        .spyOn(featurevisorSdk, "createFeaturevisor")
        .mockImplementation((options) => {
          const f = create(options);
          jest.spyOn(f, method).mockImplementation(() => {
            throw new Error("getter failed");
          });
          return f;
        });
      try {
        const check =
          method === "isEnabled"
            ? { feature: "checkout", enabled: false }
            : { feature: "checkout", variation: null };
        const result = await testVariable(
          {
            scenario: "errors",
            assertions: [{ environment: "production", checks: [{ not: [check] }] }],
          },
          { quiet: true } as any,
          new Map([[getTestDatafileKey("production"), requiredFeatureDatafile()]]),
        );
        expect(result.passed).toBe(false);
        expect(result.assertions[0].errors![0].actual).toContain("getter failed");
      } finally {
        spy.mockRestore();
      }
    },
  );

  it.each(["isEnabled", "getVariation"] as const)(
    "observes %s error diagnostics independently of quiet logging",
    async (method) => {
      const create = featurevisorSdk.createFeaturevisor;
      const spy = jest.spyOn(featurevisorSdk, "createFeaturevisor").mockImplementation((options) =>
        create({
          ...options,
          modules: [
            {
              name: "test-error",
              beforeEvaluation: () => {
                throw new Error("module failed");
              },
            },
          ],
        }),
      );
      try {
        const check =
          method === "isEnabled"
            ? { feature: "checkout", enabled: false }
            : { feature: "checkout", variation: null };
        const result = await testVariable(
          { scenario: "diagnostics", assertions: [{ environment: "production", checks: [check] }] },
          { quiet: true } as any,
          new Map([[getTestDatafileKey("production"), requiredFeatureDatafile()]]),
        );
        expect(result.passed).toBe(false);
        expect(result.assertions[0].errors![0].expected).toBe("successful comparison");
      } finally {
        spy.mockRestore();
      }
    },
  );

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
      new Map([[getTestDatafileKey("production"), datafile({ changing: "value" })]]),
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
        [getTestDatafileKey("production"), datafile({ items: ["one", { enabled: true }] })],
        [getTestDatafileKey("production", "web"), datafile({ target: true })],
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
      new Map([[getTestDatafileKey("production"), datafile({ actual: true })]]),
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
      new Map([[getTestDatafileKey("production"), requiredFeatureDatafile()]]),
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
      new Map([[getTestDatafileKey("production"), requiredFeatureDatafile()]]),
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
      new Map([[getTestDatafileKey("production"), datafile("unchanged")]]),
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
      new Map([[getTestDatafileKey("production"), multipleRequiredFeaturesDatafile()]]),
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
            expectedEvaluation: { reason: "conditions_unmet" },
          },
        ],
      },
      { quiet: true } as any,
      new Map([[getTestDatafileKey("production"), requiredFeatureChainDatafile()]]),
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
      new Map([[getTestDatafileKey("production"), datafile(value)]]),
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
            expectedEvaluation: { reason: "conditions_unmet" },
          },
        ],
      },
      { quiet: true } as any,
      new Map([[getTestDatafileKey("production"), required]]),
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
      new Map([[getTestDatafileKey("production"), contextualDatafile()]]),
    );

    expect(result.passed).toBe(true);
    expect(result.assertions).toHaveLength(2);
  });

  it("combines owner checks, references, feature variables, groups, and old expectations", async () => {
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            context: { country: "nl" },
            expectedValue: {
              region: "nl",
              nested: { nullable: null, "dot.key": 7 },
              items: [{ limit: 4 }],
            },
            expectedEvaluation: { variableOverrideKey: "netherlands" },
            checks: [
              { path: "region", operator: "equals", value: "nl" },
              { path: "items.0.limit", operator: "equals", value: 4 },
              { path: ["nested", "dot.key"], operator: "equals", value: 7 },
              { path: "nested.nullable", operator: "isNull" },
              {
                variable: "limit",
                operator: "greaterThan",
                compareTo: { feature: "checkout", variable: "limit" },
              },
              {
                not: [
                  { variable: "limit", operator: "lessThan", value: 10 },
                  { variable: "limit", operator: "greaterThan", value: 20 },
                ],
              },
            ],
          },
        ],
      },
      { quiet: true } as any,
      new Map([[getTestDatafileKey("production"), checksDatafile()]]),
    );

    expect(result).toEqual(
      expect.objectContaining({
        type: "variable",
        key: "settings",
        passed: true,
      }),
    );
    expect(result.assertions[0].errors).toEqual([]);
  });

  it("does not pass the owning assertion default to check getters", async () => {
    const blocked = requiredFeatureDatafile();
    blocked.features.checkout.traffic![0].percentage = 0;

    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            defaultVariableValue: "assertion fallback",
            expectedValue: "assertion fallback",
            checks: [{ operator: "isNull" }],
          },
        ],
      },
      { quiet: true } as any,
      new Map([[getTestDatafileKey("production"), blocked]]),
    );

    expect(result.passed).toBe(true);
  });

  it("uses child context and sticky state for every check operand", async () => {
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            context: { country: "nl", inherited: true },
            checks: [{ path: "region", operator: "equals", value: "nl" }],
            children: [
              {
                context: { country: "gb" },
                stickyVariables: { limit: 99 },
                checks: [
                  { path: "region", operator: "equals", value: "gb" },
                  { variable: "limit", operator: "equals", value: 99 },
                ],
              },
            ],
          },
        ],
      },
      { quiet: true } as any,
      new Map([[getTestDatafileKey("production"), checksDatafile()]]),
    );

    expect(result.passed).toBe(true);
    expect(result.assertions[0].errors).toEqual([]);
  });

  it("collects independent top level check failures with child provenance", async () => {
    const result = await testVariable(
      {
        variable: "settings",
        assertions: [
          {
            environment: "production",
            checks: [
              { path: "region", operator: "equals", value: "nl" },
              { variable: "limit", operator: "equals", value: 0 },
            ],
            children: [
              {
                checks: [{ path: "items.0.limit", operator: "equals", value: 0 }],
              },
            ],
          },
        ],
      },
      { quiet: true } as any,
      new Map([[getTestDatafileKey("production"), checksDatafile()]]),
    );

    expect(result.passed).toBe(false);
    expect(result.assertions[0].errors).toHaveLength(3);
    expect(result.assertions[0].errors).toEqual([
      expect.objectContaining({
        type: "check",
        details: expect.objectContaining({ checkIndex: 0 }),
      }),
      expect.objectContaining({
        type: "check",
        details: expect.objectContaining({ checkIndex: 1 }),
      }),
      expect.objectContaining({
        type: "check",
        details: expect.objectContaining({ checkIndex: 0, childIndex: 0 }),
      }),
    ]);
  });

  it("fails checks when global and feature getters emit SDK errors", async () => {
    const result = await testVariable(
      {
        scenario: "malformed JSON getters",
        assertions: [
          {
            environment: "production",
            checks: [
              {
                or: [
                  { variable: "malformed", operator: "isNull" },
                  { variable: "limit", operator: "equals", value: 12 },
                ],
              },
              {
                not: [
                  {
                    feature: "checkout",
                    variable: "malformed",
                    operator: "isNull",
                  },
                ],
              },
            ],
          },
        ],
      },
      { quiet: true } as any,
      new Map([[getTestDatafileKey("production"), checksDatafile()]]),
    );

    expect(result.passed).toBe(false);
    expect(result.assertions[0].errors).toHaveLength(2);
    expect(result.assertions[0].errors).toEqual([
      expect.objectContaining({
        type: "check",
        expected: "successful comparison",
        actual: expect.stringContaining("getVariable failed"),
        details: expect.objectContaining({
          checkIndex: 0,
          evaluated: [
            expect.objectContaining({
              path: [0, "or", 0],
              reference: {
                variable: "malformed",
                feature: undefined,
                path: undefined,
              },
              actual: "<unresolved>",
            }),
          ],
        }),
      }),
      expect.objectContaining({
        type: "check",
        expected: "successful comparison",
        actual: expect.stringContaining("getVariable failed"),
        details: expect.objectContaining({
          checkIndex: 1,
          evaluated: [
            expect.objectContaining({
              path: [1, "not", 0],
              reference: {
                variable: "malformed",
                feature: "checkout",
                path: undefined,
              },
              actual: "<unresolved>",
            }),
          ],
        }),
      }),
    ]);
  });

  it("fails resolution when a referenced entity is absent from the selected datafile", async () => {
    const result = await testVariable(
      {
        scenario: "selected target contents",
        assertions: [
          {
            environment: "production",
            target: "web",
            checks: [{ variable: "limit", operator: "equals", value: 12 }],
          },
        ],
      },
      { quiet: true } as any,
      new Map([
        [getTestDatafileKey("production"), checksDatafile()],
        [getTestDatafileKey("production", "web"), datafile("target only")],
      ]),
    );

    expect(result.passed).toBe(false);
    expect(result.assertions[0].errors).toEqual([
      expect.objectContaining({
        type: "check",
        expected: "valid check references",
        actual: expect.stringContaining(
          'Global variable "limit" is absent from the selected datafile',
        ),
      }),
    ]);
  });

  it("runs parent and child scenario checks and reports the scenario result kind", async () => {
    const scenario: TestScenario = {
      scenario: "regional checkout",
      assertions: [
        {
          description: "parent and child",
          environment: "production",
          context: { country: "nl" },
          checks: [
            { variable: "settings", path: "region", operator: "equals", value: "nl" },
            {
              feature: "checkout",
              variable: "limit",
              operator: "equals",
              value: 5,
            },
          ],
          children: [
            {
              context: { country: "gb" },
              checks: [
                {
                  variable: "settings",
                  path: "region",
                  operator: "equals",
                  value: "gb",
                },
              ],
            },
          ],
        },
      ],
    };

    const result = await testVariable(
      scenario,
      { quiet: true } as any,
      new Map([[getTestDatafileKey("production"), checksDatafile()]]),
    );

    expect(result).toEqual(
      expect.objectContaining({
        type: "scenario",
        key: "regional checkout",
        passed: true,
      }),
    );
    expect(result.assertions).toEqual([
      expect.objectContaining({ description: "parent and child", passed: true, errors: [] }),
    ]);
  });

  it("allows a scenario parent with children but no parent checks", async () => {
    const result = await testVariable(
      {
        scenario: "children only",
        assertions: [
          {
            environment: "production",
            children: [
              {
                checks: [{ variable: "limit", operator: "equals", value: 12 }],
              },
            ],
          },
        ],
      },
      { quiet: true } as any,
      new Map([[getTestDatafileKey("production"), checksDatafile()]]),
    );

    expect(result.passed).toBe(true);
  });

  it("fails malformed scenarios with no assertions when linting is bypassed", async () => {
    const result = await testVariable(
      { scenario: "empty", assertions: [] },
      { quiet: true } as any,
      new Map([[getTestDatafileKey("production"), checksDatafile()]]),
    );

    expect(result.passed).toBe(false);
    expect(result.assertions).toEqual([
      expect.objectContaining({
        passed: false,
        errors: [
          expect.objectContaining({
            type: "check",
            message: "Scenario specs require at least one assertion",
          }),
        ],
      }),
    ]);
  });

  it.each([
    ["variable", { variable: "settings" }],
    ["feature", { feature: "checkout" }],
    ["segment", { segment: "desktop" }],
  ])(
    "rejects hybrid scenario and %s discriminators when linting is bypassed",
    async (discriminator, extra) => {
      const result = await testVariable(
        {
          ...extra,
          scenario: "hybrid",
          assertions: [
            {
              environment: "production",
              checks: [{ operator: "exists" }],
            },
          ],
        } as unknown as TestScenario,
        { quiet: true } as any,
        new Map([[getTestDatafileKey("production"), checksDatafile()]]),
      );

      expect(result.passed).toBe(false);
      expect(result.assertions).toEqual([
        expect.objectContaining({
          passed: false,
          errors: [
            expect.objectContaining({
              expected: "exactly one discriminator",
              actual: {
                feature: discriminator === "feature",
                segment: discriminator === "segment",
                variable: discriminator === "variable",
                scenario: true,
              },
              message:
                'Test specs require exactly one of "feature", "segment", "variable", or "scenario"',
            }),
          ],
        }),
      ]);
    },
  );

  it("fails malformed scenario assertions and children when linting is bypassed", async () => {
    const result = await testVariable(
      {
        scenario: "missing checks",
        assertions: [
          { environment: "production" },
          {
            environment: "production",
            children: [{}],
          },
        ],
      } as TestScenario,
      { quiet: true } as any,
      new Map([[getTestDatafileKey("production"), checksDatafile()]]),
    );

    expect(result.passed).toBe(false);
    expect(result.assertions).toHaveLength(2);
    expect(result.assertions[0].errors).toEqual([
      expect.objectContaining({
        type: "check",
        message: "Scenario assertions require checks or children",
      }),
    ]);
    expect(result.assertions[1].errors).toEqual([
      expect.objectContaining({
        type: "check",
        message: "Scenario assertions require checks or children",
        details: { childIndex: 0 },
      }),
    ]);
  });

  it("reports a missing scenario datafile", async () => {
    const result = await testVariable(
      {
        scenario: "missing datafile",
        assertions: [
          {
            environment: "production",
            target: "web",
            checks: [{ variable: "settings", operator: "exists" }],
          },
        ],
      },
      { quiet: true } as any,
      new Map(),
    );

    expect(result.passed).toBe(false);
    expect(result.assertions[0].errors).toEqual([
      expect.objectContaining({
        message: 'datafile not found for environment "production" and target "web"',
      }),
    ]);
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
        new Map([[getTestDatafileKey("production"), datafile("shown")]]),
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
      new Map([[getTestDatafileKey("production"), datafile("base")]]),
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
        new Map([[getTestDatafileKey("production"), datafile("base")]]),
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
          new Map([[getTestDatafileKey("production"), datafile("base")]]),
        ),
      ).rejects.toThrow("evaluation failed");
      expect(parentClose).toHaveBeenCalledTimes(1);
      expect(childClose).toHaveBeenCalledTimes(1);
    } finally {
      createSpy.mockRestore();
    }
  });
});
