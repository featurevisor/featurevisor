import type { DatafileContent } from "@featurevisor/types";
import type { Evaluation } from "@featurevisor/sdk";
import { FeaturevisorCLIError, formatFeaturevisorCLIError } from "../error";
import { explainEvaluation } from "./explain";
import type { EvaluationExplanation, ExplanationOptions } from "./explain";
import { assertExplanationMatchesEvaluation } from "./validateExplanation";

const empty: DatafileContent = { schemaVersion: "2", revision: "test", features: {}, segments: {} };
const check = (evaluation: Evaluation, datafile = empty, options: ExplanationOptions = {}) => {
  const explanation = explainEvaluation(evaluation, datafile, [], options);
  assertExplanationMatchesEvaluation(evaluation, explanation, datafile, options);
  return explanation;
};

describe("explanation consistency", () => {
  test.each([false, 0, "", null, { a: [1, { b: false }] }, undefined])(
    "accepts unchanged SDK value %j",
    (value) => {
      expect(() =>
        check({ type: "variable", variableKey: "config", reason: "sticky", variableValue: value }),
      ).not.toThrow();
    },
  );

  test.each([
    ["type", "flag"],
    ["featureKey", "wrong"],
    ["variableKey", "wrong"],
    ["reason", "error"],
    ["hasValue", false],
    ["value", "wrong"],
  ])("rejects a conflicting result.%s", (field, value) => {
    const sdk: Evaluation = {
      type: "variable",
      variableKey: "config",
      reason: "sticky",
      variableValue: "right",
    };
    const explanation = explainEvaluation(sdk, empty, [], {});
    Object.assign(explanation.result, { [field]: value });
    expect(() => assertExplanationMatchesEvaluation(sdk, explanation, empty, {})).toThrow(
      `result.${field}`,
    );
  });

  test("rejects changed prose rather than allowing contradictory summaries", () => {
    const sdk: Evaluation = { type: "flag", reason: "rule", enabled: false };
    const explanation = explainEvaluation(sdk, empty, [], {});
    explanation.summary = "The flag is enabled.";
    expect(() => assertExplanationMatchesEvaluation(sdk, explanation, empty, {})).toThrow(
      "summary",
    );
  });

  test("compares nested values independent of object key order", () => {
    const sdk: Evaluation = {
      type: "variable",
      reason: "sticky",
      variableValue: { a: 1, b: [false, null] },
    };
    const explanation = explainEvaluation(sdk, empty, [], {});
    explanation.result.value = { b: [false, null], a: 1 };
    expect(() => assertExplanationMatchesEvaluation(sdk, explanation, empty, {})).not.toThrow();
    explanation.result.value = { a: 1, b: [null, false] };
    expect(() => assertExplanationMatchesEvaluation(sdk, explanation, empty, {})).toThrow(
      "result.value",
    );
  });

  test("distinguishes absent values from null in structured errors", () => {
    const sdk: Evaluation = {
      type: "variable",
      variableKey: "missing",
      reason: "variable_not_found",
    };
    const explanation = explainEvaluation(sdk, empty, [], {});
    explanation.result.value = null;
    let caught: unknown;
    try {
      assertExplanationMatchesEvaluation(sdk, explanation, empty, {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FeaturevisorCLIError);
    const output = JSON.parse(formatFeaturevisorCLIError(caught, { json: true }));
    expect(output.error.code).toBe("evaluation_explanation_mismatch");
    expect(output.error.details.mismatches).toContainEqual({
      field: "result.value",
      expected: { available: false },
      actual: { available: true, value: null },
    });
    expect(formatFeaturevisorCLIError(caught)).toContain('global variable "missing"');
  });

  test("rejects mismatched environment, set and Target provenance", () => {
    const sdk: Evaluation = { type: "flag", reason: "rule", enabled: true };
    const options = { environment: "production", set: "eu", target: "web" };
    const explanation = explainEvaluation(sdk, empty, [], options);
    explanation.source = {
      kind: "local-project",
      environment: "staging",
      set: "us",
      target: "server",
    };
    expect(() => assertExplanationMatchesEvaluation(sdk, explanation, empty, options)).toThrow(
      "source.environment, source.set, source.target",
    );
  });

  const file: DatafileContent = {
    ...empty,
    variables: {
      config: {
        type: "object",
        defaultValue: { text: "default" },
        disabledValue: { text: "disabled" },
        overrides: [
          { key: "mobile", keyPath: ["nl", "mobile"], segments: "*", value: { text: "selected" } },
        ],
      },
    },
  };
  const selected: Evaluation = {
    type: "variable",
    variableKey: "config",
    reason: "variable_override_rule",
    variableOverrideIndex: 0,
    variableOverrideKey: "mobile",
    variableOverridePath: ["nl", "mobile"],
    variableValue: { text: "selected" },
  };

  test("checks compiled override values and identity against SDK output", () => {
    expect(() => check(selected, file)).not.toThrow();
    expect(() => check({ ...selected, variableValue: { text: "different" } }, file)).toThrow(
      "definition.override.value",
    );
    expect(() => check({ ...selected, variableOverrideKey: "wrong" }, file)).toThrow(
      "definition.override.key",
    );
    expect(() => check({ ...selected, variableOverridePath: ["wrong"] }, file)).toThrow(
      "definition.override.path",
    );
    expect(() => check({ ...selected, variableOverrideIndex: 9 }, file)).toThrow(
      "definition.overrideExists",
    );
  });

  test.each(["variable_default", "required_features_unmet"] as const)(
    "checks global value policy for %s",
    (reason) => {
      expect(() =>
        check({ type: "variable", variableKey: "config", reason, variableValue: "wrong" }, file),
      ).toThrow("definition.");
    },
  );

  test("checks disabled variation values", () => {
    const datafile: DatafileContent = {
      ...empty,
      features: {
        checkout: { bucketBy: "userId", traffic: [], disabledVariationValue: "control" },
      },
    };
    expect(() =>
      check(
        {
          type: "variation",
          featureKey: "checkout",
          reason: "variation_disabled",
          variationValue: "control",
        },
        datafile,
      ),
    ).not.toThrow();
    expect(() =>
      check(
        {
          type: "variation",
          featureKey: "checkout",
          reason: "variation_disabled",
          variationValue: "wrong",
        },
        datafile,
      ),
    ).toThrow("disabledVariationValue");
  });

  test("checks feature variable defaults, disabled values, and rule overrides", () => {
    const sdk: Evaluation = {
      type: "variable",
      featureKey: "checkout",
      variableKey: "config",
      reason: "variable_default",
      variableValue: "different",
      variableSchema: { type: "string", defaultValue: "default", disabledValue: "disabled" },
    };
    expect(() => check(sdk)).toThrow("defaultValue");
    expect(() => check({ ...sdk, reason: "variable_disabled" })).toThrow("disabledValue");
    const overridden: Evaluation = {
      ...sdk,
      reason: "variable_override_rule",
      ruleKey: "all",
      variableOverrideIndex: 0,
      variableOverrideKey: "nl",
      traffic: {
        key: "all",
        percentage: 100000,
        segments: "*",
        variableOverrides: { config: [{ key: "nl", segments: "*", value: "right" }] },
      },
    };
    expect(() => check(overridden)).toThrow("definition.override.value");
    expect(() => check({ ...overridden, variableValue: "right" })).not.toThrow();
  });

  test.each([
    { type: "flag", enabled: false, force: { enabled: true } },
    { type: "variation", variationValue: "wrong", force: { variation: "right" } },
    {
      type: "variable",
      variableKey: "config",
      variableValue: false,
      force: { variables: { config: true } },
    },
  ] as const)("checks the force value for $type", (fields) => {
    expect(() => check({ reason: "forced", ...fields })).toThrow("definition.force.");
  });

  test.each([
    ["Bucketing reported by the SDK", "bucketValue", 100],
    ["Matched rule", "key", "wrong"],
    ["Matched rule", "percentage", 0],
    ["Matched rule", "segments", "wrong-segment"],
    ["Selected compiled override selectors", "segments", "wrong-segment"],
    ["Variable value policy", "defaultValue", "wrong-default"],
    ["Selected variable override", "path", ["wrong"]],
    ["Authored value construction (build time)", "compiledValue", "wrong"],
  ])("checks displayed evidence: %s.%s", (title, field, value) => {
    const sdk: Evaluation = {
      ...selected,
      bucketValue: 10,
      ruleKey: "all",
      traffic: { key: "all", segments: "*", percentage: 100000 },
    };
    const explanation = explainEvaluation(sdk, file, [], {});
    explanation.evidence.push({
      basis: "sdk-result",
      title: String(title),
      details: { [String(field)]: value },
    });
    expect(() => assertExplanationMatchesEvaluation(sdk, explanation, file, {})).toThrow(
      "evidence.",
    );
  });

  test("incomplete diagnostics and unknown variation provenance remain limitations", () => {
    const sdk: Evaluation = {
      type: "variable",
      featureKey: "checkout",
      variableKey: "config",
      reason: "variable_override_variation",
      variableValue: "yes",
    };
    expect(() => check(sdk)).not.toThrow();
    const missing: EvaluationExplanation = check({
      type: "flag",
      featureKey: "absent",
      reason: "feature_not_found",
    });
    expect(missing.result.hasValue).toBe(false);
  });
});
