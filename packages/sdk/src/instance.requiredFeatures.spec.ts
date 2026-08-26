import type { DatafileContent } from "@featurevisor/types";

import { createFeaturevisor } from "./instance";
import { createDatafile, createFeature } from "./instance.test-fixtures";

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
      legacyRequirement: createFeature({ required: ["enabled"] }),
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
    "legacyRequirement",
  ])("enables %s when every requirement matches", (featureKey) => {
    expect(f.isEnabled(featureKey)).toBe(true);
  });

  it.each(["wrongDisabledVariation", "missingDisabledVariation"])(
    "disables %s when a requirement differs",
    (featureKey) => {
      expect(f.isEnabled(featureKey)).toBe(false);
      expect(f.evaluateFlag(featureKey)).toEqual(
        expect.objectContaining({ reason: "required", enabled: false }),
      );
    },
  );

  it("uses the same enabled and variation semantics for global variables", () => {
    expect(f.getVariable("enabledVariable")).toBe("available");
    expect(f.getVariable("disabledVariable")).toBe("available");
    expect(f.getVariable("disabledVariationVariable")).toBe("available");
    expect(f.getVariable("missingDisabledVariable")).toBe("available");
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
});
