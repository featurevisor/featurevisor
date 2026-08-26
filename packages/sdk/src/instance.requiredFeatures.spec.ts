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
