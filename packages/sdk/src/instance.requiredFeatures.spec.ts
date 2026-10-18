import type { DatafileContent } from "@featurevisor/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createFeaturevisor } from "./instance";
import type { Evaluation } from "./evaluate";
import { createDatafile, createFeature } from "./instance.test-fixtures";

const conformance = JSON.parse(
  readFileSync(resolve(__dirname, "../../../conformance/sdk-v3.json"), "utf8"),
);

interface RequiredFeaturesConformanceCase {
  name: string;
  feature: string;
  expectedEnabled: boolean;
}

interface RequiredFeaturesEvaluationCase {
  name: string;
  type: "flag" | "variation" | "variable";
  feature?: string;
  variable?: string;
  expected: Partial<Evaluation>;
}

const requiredFeaturesConformanceCases = conformance.requiredFeatures
  .cases as RequiredFeaturesConformanceCase[];

describe("portable prerequisite evaluation reasons", () => {
  it("requires the complete versioned reason contract", () => {
    expect(conformance.version).toBe(15);
    expect(conformance.requiredFeatures.evaluationCases).toHaveLength(9);
  });

  it.each(conformance.requiredFeatures.evaluationCases as RequiredFeaturesEvaluationCase[])(
    "$name",
    async (testCase) => {
      const sdk = createFeaturevisor({
        datafile: JSON.parse(JSON.stringify(conformance.requiredFeatures.datafile)),
        logLevel: "fatal",
      });
      try {
        for (let repetition = 0; repetition < 2; repetition++) {
          const evaluation =
            testCase.type === "flag"
              ? sdk.evaluateFlag(testCase.feature!)
              : testCase.type === "variation"
                ? sdk.evaluateVariation(testCase.feature!)
                : testCase.feature
                  ? sdk.evaluateVariable(testCase.feature, testCase.variable!)
                  : sdk.evaluateVariable(testCase.variable!);
          expect(evaluation).toMatchObject(testCase.expected);
        }
      } finally {
        await sdk.close();
      }
    },
  );
});

describe("prerequisite evaluation reason names", () => {
  it("distinguishes feature and variable gates without changing disabled result policies", async () => {
    const diagnostics: Array<{ code: string; details: Record<string, unknown> }> = [];
    const sdk = createFeaturevisor({
      logLevel: "debug",
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      datafile: createDatafile({
        features: {
          prerequisite: createFeature({ traffic: [] }),
          byFeature: createFeature({
            requiredFeatures: ["prerequisite"],
            variablesSchema: { message: { type: "string", defaultValue: "ready" } },
          }),
          byVariable: createFeature({
            conditions: [{ variable: "gate", operator: "equals", value: true }],
            variablesSchema: { message: { type: "string", defaultValue: "ready" } },
          }),
          disabledValues: createFeature({
            requiredFeatures: ["prerequisite"],
            disabledVariationValue: "off",
            variablesSchema: {
              message: { type: "string", defaultValue: "ready", disabledValue: "blocked" },
              fallback: { type: "string", defaultValue: "fallback", useDefaultWhenDisabled: true },
            },
          }),
        },
        variables: {
          gate: { type: "boolean", defaultValue: false },
          byFeature: {
            type: "string",
            defaultValue: "ready",
            disabledValue: "blocked",
            requiredFeatures: ["prerequisite"],
          },
          byVariable: {
            type: "string",
            defaultValue: "ready",
            disabledValue: "blocked",
            conditions: [{ variable: "gate", operator: "equals", value: true }],
          },
        },
      }),
    });
    try {
      for (const [key, reason] of [
        ["byFeature", "conditions_unmet"],
        ["byVariable", "conditions_unmet"],
      ]) {
        expect(sdk.isEnabled(key)).toBe(false);
        expect(sdk.evaluateFlag(key)).toMatchObject({ reason, enabled: false });
        expect(sdk.evaluateVariation(key)).toMatchObject({ type: "variation", reason: "disabled" });
        expect(sdk.evaluateVariable(key, "message")).toMatchObject({
          type: "variable",
          reason: "disabled",
        });
        expect(sdk.evaluateVariable(key)).toMatchObject({ reason, variableValue: "blocked" });
        expect(sdk.getVariable(key)).toBe("blocked");
        expect(sdk.getVariation(key)).toBeNull();
        expect(sdk.getVariable(key, "message")).toBeNull();
      }
      expect(sdk.evaluateVariation("disabledValues")).toMatchObject({
        reason: "variation_disabled",
        variationValue: "off",
      });
      expect(sdk.evaluateVariable("disabledValues", "message")).toMatchObject({
        reason: "variable_disabled",
        variableValue: "blocked",
      });
      expect(sdk.evaluateVariable("disabledValues", "fallback")).toMatchObject({
        reason: "variable_default",
        variableValue: "fallback",
      });
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          details: expect.objectContaining({
            featureKey: "byFeature",
            reason: "conditions_unmet",
            evaluation: expect.objectContaining({ reason: "conditions_unmet" }),
          }),
        }),
      );
    } finally {
      await sdk.close();
    }
  });
});

function requiredFeaturesDatafile(): DatafileContent {
  return createDatafile({
    features: {
      enabled: createFeature({
        variations: [{ value: "control" }, { value: "treatment" }],
        force: [{ segments: "*", enabled: true, variation: "treatment" }],
      }),
      disabled: createFeature({
        disabledVariationValue: "control",
        variations: [{ value: "control" }, { value: "treatment" }],
        traffic: [{ key: "off", segments: "*", percentage: 0, allocation: [] }],
      }),
      disabledWithoutVariation: createFeature({
        variations: [{ value: "control" }, { value: "treatment" }],
        traffic: [{ key: "off", segments: "*", percentage: 0, allocation: [] }],
      }),
      stringRequirement: createFeature({ requiredFeatures: ["enabled"] }),
      enabledRequirement: createFeature({
        requiredFeatures: [{ feature: "enabled", enabled: true }],
      }),
      variationRequirement: createFeature({
        requiredFeatures: [{ feature: "enabled", variation: "treatment" }],
      }),
      disabledRequirement: createFeature({
        requiredFeatures: [{ feature: "disabled", enabled: false }],
      }),
      disabledVariationRequirement: createFeature({
        requiredFeatures: [{ feature: "disabled", enabled: false, variation: "control" }],
      }),
      wrongDisabledVariation: createFeature({
        requiredFeatures: [{ feature: "disabled", enabled: false, variation: "treatment" }],
      }),
      missingDisabledRequirement: createFeature({
        requiredFeatures: [{ feature: "missing", enabled: false }],
      }),
      missingDisabledVariation: createFeature({
        requiredFeatures: [{ feature: "missing", enabled: false, variation: "control" }],
      }),
      mixedRequirements: createFeature({
        requiredFeatures: [
          "enabled",
          { feature: "disabled", enabled: false, variation: "control" },
        ],
      }),
      canonicalRequirement: createFeature({ requiredFeatures: ["enabled"] }),
      featureOverrides: createFeature({
        variablesSchema: {
          message: { type: "string", defaultValue: "default" },
        },
        traffic: [
          {
            key: "all",
            segments: "*",
            percentage: 100000,
            variableOverrides: {
              message: [
                {
                  key: "conditions-and-required",
                  conditions: { attribute: "country", operator: "equals", value: "nl" },
                  requiredFeatures: [{ feature: "disabled", enabled: false }],
                  value: "conditions",
                },
                {
                  key: "segments-and-required",
                  segments: "europe",
                  requiredFeatures: ["enabled"],
                  value: "segments",
                },
                {
                  key: "required-only",
                  requiredFeatures: [{ feature: "disabled", enabled: false }],
                  value: "required",
                },
              ],
            },
          },
        ],
      }),
      variationOverrides: createFeature({
        variablesSchema: {
          message: { type: "string", defaultValue: "default" },
        },
        variations: [
          {
            value: "treatment",
            variableOverrides: {
              message: [
                {
                  key: "variation-required",
                  conditions: { attribute: "country", operator: "equals", value: "nl" },
                  requiredFeatures: [{ feature: "disabled", enabled: false, variation: "control" }],
                  value: "variation",
                },
              ],
            },
          },
        ],
        force: [{ segments: "*", enabled: true, variation: "treatment" }],
      }),
    },
    variables: {
      enabledVariable: {
        type: "string",
        defaultValue: "available",
        disabledValue: "unavailable",
        requiredFeatures: ["enabled"],
      },
      disabledVariable: {
        type: "string",
        defaultValue: "available",
        disabledValue: "unavailable",
        requiredFeatures: [{ feature: "disabled", enabled: false }],
      },
      disabledVariationVariable: {
        type: "string",
        defaultValue: "available",
        disabledValue: "unavailable",
        requiredFeatures: [{ feature: "disabled", enabled: false, variation: "control" }],
      },
      missingDisabledVariable: {
        type: "string",
        defaultValue: "available",
        disabledValue: "unavailable",
        requiredFeatures: [{ feature: "missing", enabled: false }],
      },
      disabledWithoutVariationVariable: {
        type: "string",
        defaultValue: "available",
        disabledValue: "unavailable",
        requiredFeatures: [
          { feature: "disabledWithoutVariation", enabled: false, variation: "control" },
        ],
      },
      overrides: {
        type: "string",
        defaultValue: "default",
        overrides: [
          {
            key: "conditions-and-required",
            conditions: { attribute: "country", operator: "equals", value: "nl" },
            requiredFeatures: [{ feature: "disabled", enabled: false }],
            value: "conditions",
          },
          {
            key: "segments-and-required",
            segments: "europe",
            requiredFeatures: ["enabled"],
            value: "segments",
          },
          {
            key: "required-only",
            requiredFeatures: [{ feature: "disabled", enabled: false }],
            value: "required",
          },
        ],
      },
    },
    segments: {
      europe: {
        conditions: { attribute: "continent", operator: "equals", value: "eu" },
      },
    },
  });
}

describe("requiredFeatures", () => {
  const f = createFeaturevisor({ datafile: requiredFeaturesDatafile(), logLevel: "fatal" });

  it.each([
    "stringRequirement",
    "enabledRequirement",
    "variationRequirement",
    "disabledRequirement",
    "disabledVariationRequirement",
    "missingDisabledRequirement",
    "mixedRequirements",
    "canonicalRequirement",
  ])("enables %s when every requirement matches", (featureKey) => {
    expect(f.isEnabled(featureKey)).toBe(true);
  });

  it.each(["wrongDisabledVariation", "missingDisabledVariation"])(
    "disables %s when a requirement differs",
    (featureKey) => {
      expect(f.isEnabled(featureKey)).toBe(false);
      expect(f.evaluateFlag(featureKey)).toEqual(
        expect.objectContaining({ reason: "conditions_unmet", enabled: false }),
      );
    },
  );

  it("uses the same enabled and variation semantics for global variables", () => {
    expect(f.getVariable("enabledVariable")).toBe("available");
    expect(f.getVariable("disabledVariable")).toBe("available");
    expect(f.getVariable("disabledVariationVariable")).toBe("available");
    expect(f.getVariable("missingDisabledVariable")).toBe("available");
  });

  it("does not pass a global variable caller default into required feature evaluations", () => {
    expect(
      f.evaluateVariable(
        "disabledWithoutVariationVariable",
        {},
        {
          defaultVariationValue: "control",
        },
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "conditions_unmet",
        variableValue: "unavailable",
      }),
    );
  });

  it("honours a required variation produced by the normal module pipeline", () => {
    expect(conformance.modulePipeline.requiredFeaturesUseModules).toBe(true);
    const withModule = createFeaturevisor({
      datafile: requiredFeaturesDatafile(),
      logLevel: "fatal",
      modules: [
        {
          name: "supply-disabled-variation",
          afterEvaluation: (evaluation) =>
            evaluation.type === "variation" && evaluation.featureKey === "disabledWithoutVariation"
              ? { ...evaluation, variation: { value: "control" } }
              : evaluation,
        },
      ],
    });

    expect(withModule.getVariable("disabledWithoutVariationVariable")).toBe("available");
  });

  it("matches requiredFeatures alone or with exactly one context selector", () => {
    expect(f.getVariable("overrides", { country: "nl" })).toBe("conditions");
    expect(f.getVariable("overrides", { continent: "eu" })).toBe("segments");
    expect(f.getVariable("overrides")).toBe("required");
  });

  it("uses the same selector combinations for feature variable overrides", () => {
    expect(f.getVariable("featureOverrides", "message", { country: "nl" })).toBe("conditions");
    expect(f.getVariable("featureOverrides", "message", { continent: "eu" })).toBe("segments");
    expect(f.getVariable("featureOverrides", "message")).toBe("required");
  });

  it("reports stable keys for keyed rule and variation overrides", () => {
    expect(f.evaluateVariable("featureOverrides", "message", { country: "nl" })).toEqual(
      expect.objectContaining({
        reason: "variable_override_rule",
        variableOverrideIndex: 0,
        variableOverrideKey: "conditions-and-required",
      }),
    );
    expect(f.evaluateVariable("variationOverrides", "message", { country: "nl" })).toEqual(
      expect.objectContaining({
        reason: "variable_override_variation",
        variableOverrideIndex: 0,
        variableOverrideKey: "variation-required",
      }),
    );
  });

  it("skips a feature variable override when its required features do not match", () => {
    const withModule = createFeaturevisor({
      datafile: requiredFeaturesDatafile(),
      logLevel: "fatal",
      modules: [
        {
          name: "enable-disabled-feature",
          afterEvaluation: (evaluation) =>
            evaluation.type === "flag" && evaluation.featureKey === "disabled"
              ? { ...evaluation, enabled: true }
              : evaluation,
        },
      ],
    });

    expect(withModule.getVariable("featureOverrides", "message", { country: "nl" })).toBe(
      "default",
    );
  });

  it("honours the enabled result produced by the normal module pipeline", () => {
    const withModule = createFeaturevisor({
      datafile: requiredFeaturesDatafile(),
      logLevel: "fatal",
      modules: [
        {
          name: "enable-disabled-feature",
          afterEvaluation: (evaluation) =>
            evaluation.type === "flag" && evaluation.featureKey === "disabled"
              ? { ...evaluation, enabled: true }
              : evaluation,
        },
      ],
    });

    expect(withModule.isEnabled("disabled")).toBe(true);
    expect(withModule.isEnabled("disabledRequirement")).toBe(false);
    expect(withModule.getVariable("disabledVariable")).toBe("unavailable");
  });

  it.each(requiredFeaturesConformanceCases)("conformance: $name", (testCase) => {
    expect(conformance.version).toBe(15);
    const sdk = createFeaturevisor({
      datafile: conformance.requiredFeatures.datafile,
      logLevel: "fatal",
    });

    expect(sdk.isEnabled(testCase.feature)).toBe(testCase.expectedEnabled);
  });

  it("conformance: applies requiredFeatures to feature variable overrides", () => {
    const testCase = conformance.requiredFeatures.featureVariableCase;
    const sdk = createFeaturevisor({
      datafile: conformance.requiredFeatures.datafile,
      logLevel: "fatal",
    });
    const evaluation = sdk.evaluateVariable(testCase.feature, testCase.variable);

    expect(evaluation.variableValue).toBe(testCase.expectedValue);
    expect(evaluation.variableOverrideKey).toBe(testCase.expectedOverrideKey);
  });
});
