import type { EvaluationOptions, FeaturevisorDiagnostic } from "./index";
import { createFeaturevisor } from "./instance";
import { createDatafile, createFeature } from "./instance.test-fixtures";

describe("shared evaluation plumbing", () => {
  it("uses the evaluated prerequisite variation, including an empty string, everywhere", () => {
    const requirement = { feature: "dependency", variation: "" };
    const f = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        features: {
          dependency: createFeature({ variations: [{ value: "original" }] }),
          dependent: createFeature({ requiredFeatures: [requirement] }),
          owner: createFeature({
            variablesSchema: { copy: { type: "string", defaultValue: "default" } },
            traffic: [
              {
                key: "all",
                segments: "*",
                percentage: 100000,
                variableOverrides: {
                  copy: [{ requiredFeatures: [requirement], value: "matched" }],
                },
              },
            ],
          }),
        },
        variables: {
          dependent: { type: "string", requiredFeatures: [requirement], defaultValue: "available" },
          overridden: {
            type: "string",
            defaultValue: "default",
            overrides: [{ key: "eligible", requiredFeatures: [requirement], value: "matched" }],
          },
        },
      }),
      modules: [
        {
          afterEvaluation(evaluation) {
            return evaluation.featureKey === "dependency" && evaluation.type === "variation"
              ? { ...evaluation, variationValue: "", variation: { value: "not-the-result" } }
              : evaluation;
          },
        },
      ],
    });

    expect(f.getVariation("dependency")).toBe("");
    expect(f.isEnabled("dependent")).toBe(true);
    expect(f.getVariable("owner", "copy")).toBe("matched");
    expect(f.getVariable("dependent")).toBe("available");
    expect(f.getVariable("overridden")).toBe("matched");
  });

  it("applies caller defaults before afterEvaluation for both variable namespaces", () => {
    const seen: unknown[] = [];
    const f = createFeaturevisor({
      logLevel: "fatal",
      modules: [
        {
          afterEvaluation(evaluation) {
            seen.push(evaluation.variableValue);
            return evaluation;
          },
        },
      ],
    });
    expect(f.getVariable("missing", {}, { defaultVariableValue: false })).toBe(false);
    expect(f.getVariable("missing", "copy", {}, { defaultVariableValue: 0 })).toBe(0);
    expect(seen).toEqual([false, 0]);
  });

  it("retains captured feature identity when a bucketing module changes its retained options then throws", () => {
    let options: EvaluationOptions;
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const f = createFeaturevisor({
      datafile: createDatafile({ features: { checkout: createFeature() } }),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      modules: [
        {
          beforeEvaluation(value) {
            options = value;
            return value;
          },
          bucketValue() {
            if ("featureKey" in options) options.featureKey = "changed";
            throw "bucketing failed";
          },
        },
      ],
    });
    const evaluation = f.evaluateFlag("checkout");
    expect(evaluation).toMatchObject({ type: "flag", featureKey: "checkout", reason: "error" });
    expect(evaluation.error?.message).toBe("bucketing failed");
    expect(
      diagnostics.find((diagnostic) => diagnostic.code === "evaluation_error")?.details,
    ).toMatchObject({ featureKey: "checkout", evaluation });
  });
});
