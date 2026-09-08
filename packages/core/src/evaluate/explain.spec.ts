import type { DatafileContent, ParsedVariable } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";
import type { Evaluation, FeaturevisorDiagnostic } from "@featurevisor/sdk";
import { explainEvaluation, getEvaluationValue, printExplanation } from "./explain";

const empty: DatafileContent = { schemaVersion: "2", revision: "test", features: {}, segments: {} };

function evidence(explanation: ReturnType<typeof explainEvaluation>, title: string) {
  return explanation.evidence.find((entry) => entry.title === title)?.details;
}

describe("CLI evaluation explanations", () => {
  test.each([false, 0, "", null, { nested: { value: [1, 2] } }])(
    "preserves value %j without truthiness coercion",
    (value) => {
      const evaluation: Evaluation = {
        type: "variable",
        variableKey: "config",
        reason: "variable_default",
        variableValue: value,
      };
      const explanation = explainEvaluation(evaluation, empty, [], {});
      expect(explanation.result).toMatchObject({ hasValue: true, value });
      expect(JSON.parse(JSON.stringify(explanation)).result).toHaveProperty("value", value);
    },
  );

  test("distinguishes an unavailable value from null in JSON", () => {
    const result = explainEvaluation(
      { type: "variable", reason: "variable_not_found" },
      empty,
      [],
      { variable: "missing" },
    );
    expect(result.result).toMatchObject({ variableKey: "missing", hasValue: false });
    expect(JSON.parse(JSON.stringify(result)).result).not.toHaveProperty("value");
  });

  test("uses direct variation values including empty strings before variation objects", () => {
    expect(
      getEvaluationValue({
        type: "variation",
        reason: "variation_disabled",
        variationValue: "control",
      }),
    ).toBe("control");
    expect(
      getEvaluationValue({
        type: "variation",
        reason: "sticky",
        variationValue: "",
        variation: { value: "other" },
      }),
    ).toBe("");
    expect(
      getEvaluationValue({
        type: "variation",
        reason: "allocated",
        variation: { value: "treatment" },
      }),
    ).toBe("treatment");
    expect(getEvaluationValue({ type: "flag", reason: "rule", enabled: false })).toBe(false);
  });

  test.each([
    "feature_not_found",
    "disabled",
    "required",
    "out_of_range",
    "no_variations",
    "variation_disabled",
    "variable_not_found",
    "variable_default",
    "variable_disabled",
    "variable_override_variation",
    "variable_override_rule",
    "required_features_unmet",
    "no_match",
    "forced",
    "sticky",
    "rule",
    "allocated",
    "error",
  ] as const)("has an explanation for SDK reason %s", (reason) => {
    const result = explainEvaluation({ type: "variable", reason }, empty, [], {});
    expect(result.summary.length).toBeGreaterThan(15);
    expect(result.mode).toBe("outcome");
    expect(result.limitations.join(" ")).toContain("not a complete execution trace");
  });

  test("distinguishes disabled defaults and explicitly disabled values", () => {
    expect(
      explainEvaluation(
        { type: "variable", reason: "variable_default", enabled: false },
        empty,
        [],
        {},
      ).summary,
    ).toContain("useDefaultWhenDisabled");
    expect(
      explainEvaluation({ type: "variable", reason: "variable_disabled" }, empty, [], {}).summary,
    ).toContain("disabledValue");
  });

  test("explains SDK rule evidence without matching conditions or modifying inputs", () => {
    const datafile: DatafileContent = {
      ...empty,
      segments: {
        nl: { conditions: '[{"attribute":"country","operator":"equals","value":"nl"}]' },
      },
      features: { checkout: { bucketBy: "userId", traffic: [] } },
    };
    const evaluation: Evaluation = {
      type: "flag",
      featureKey: "checkout",
      reason: "rule",
      enabled: false,
      bucketKey: "user.checkout",
      bucketValue: 0,
      ruleKey: "off",
      traffic: { key: "off", percentage: 0, segments: '{"and":["nl","missing","*"]}' },
    };
    const before = JSON.stringify({ datafile, evaluation });
    const result = explainEvaluation(evaluation, datafile, [], {
      environment: "production",
      target: "web",
      set: "default",
    });
    expect(result.summary).toContain("percentage of 0");
    expect(result.source).toEqual({
      kind: "local-project",
      environment: "production",
      target: "web",
      set: "default",
    });
    expect(evidence(result, "Bucketing reported by the SDK")?.bucketValue).toBe(0);
    expect(evidence(result, "Matched rule")).toMatchObject({
      key: "off",
      segments: { and: ["nl", "missing", "*"] },
      segmentDefinitions: [
        {
          key: "nl",
          present: true,
          conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
        },
        { key: "missing", present: false },
      ],
    });
    expect(JSON.stringify({ datafile, evaluation })).toBe(before);
  });

  test("preserves malformed selector text for presentation", () => {
    const result = explainEvaluation(
      {
        type: "flag",
        reason: "forced",
        forceIndex: 0,
        force: { conditions: "{broken", enabled: true },
      },
      empty,
      [],
      {},
    );
    expect(evidence(result, "Selected force")).toMatchObject({ index: 0, conditions: "{broken" });
  });

  test("shows root requirements as definitions, not fabricated dependency checks", () => {
    const requiredFeatures = [{ feature: "pricing", enabled: false, variation: "control" }];
    const result = explainEvaluation(
      { type: "flag", reason: "required", requiredFeatures },
      empty,
      [],
      {},
    );
    expect(evidence(result, "Declared root requirements (not a per requirement trace)")).toEqual({
      requiredFeatures,
    });
    expect(JSON.stringify(result)).not.toContain('"matched":');
  });

  test("retains related diagnostic observations and warnings but omits initialization noise", () => {
    const evaluation: Evaluation = {
      type: "flag",
      featureKey: "checkout",
      reason: "required",
      enabled: false,
    };
    const nested: Evaluation = {
      type: "flag",
      featureKey: "pricing",
      reason: "rule",
      enabled: false,
    };
    const diagnostics: FeaturevisorDiagnostic[] = [
      {
        level: "info",
        code: "datafile_set",
        message: "Datafile set",
        details: { features: ["unrelated"] },
      },
      { level: "debug", code: "rule", message: "Result", details: { evaluation: nested } },
      { level: "debug", code: "rule", message: "Result", details: { evaluation: nested } },
      { level: "debug", code: "required", message: "Result", details: { evaluation } },
      { level: "warn", code: "deprecated_feature", message: "Deprecated feature", details: {} },
    ];
    const result = explainEvaluation(evaluation, empty, diagnostics, {});
    expect(evidence(result, "Related evaluations observed during this call")?.observations).toEqual(
      [
        expect.objectContaining({ featureKey: "pricing", value: false }),
        expect.objectContaining({ featureKey: "pricing", value: false }),
      ],
    );
    expect(evidence(result, "Warnings and errors")?.issues).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("unrelated");
  });

  const source: ParsedVariable = {
    type: "object",
    defaultValue: { text: "Hello", count: 0 },
    overrides: {
      production: [
        {
          key: "nl",
          conditions: { attribute: "country", operator: "equals", value: "nl" },
          mutate: { text: "Hallo" },
          overrides: [
            {
              key: "mobile",
              segments: "mobile",
              mutate: { count: 1 },
            },
          ],
        },
      ],
    },
  };
  const datafile: DatafileContent = {
    ...empty,
    segments: {
      mobile: { conditions: { attribute: "device", operator: "equals", value: "mobile" } },
    },
    variables: {
      greeting: {
        type: "object",
        defaultValue: source.defaultValue,
        overrides: [
          {
            key: "mobile",
            keyPath: ["nl", "mobile"],
            conditions: { attribute: "country", operator: "equals", value: "nl" },
            segments: "mobile",
            value: { text: "Hallo", count: 1 },
          },
        ],
      },
    },
  };

  test("explains nested authored mutations without repeating SDK callbacks or changing results", () => {
    const beforeEvaluation = jest.fn((options) => options);
    const afterEvaluation = jest.fn((evaluation) => evaluation);
    const f = createFeaturevisor({
      datafile,
      logLevel: "error",
      modules: [{ name: "observer", beforeEvaluation, afterEvaluation }],
    });
    const evaluation = f.evaluateVariable("greeting", { country: "nl", device: "mobile" });
    const original = JSON.stringify(evaluation);
    const result = explainEvaluation(evaluation, datafile, [], {
      authoredVariable: source,
      environment: "production",
    });
    expect(result.result.value).toEqual({ text: "Hallo", count: 1 });
    expect(evidence(result, "Authored value construction (build time)")).toMatchObject({
      defaultValue: source.defaultValue,
      overrides: [
        { path: ["nl"], mutate: { text: "Hallo" } },
        { path: ["nl", "mobile"], mutate: { count: 1 } },
      ],
      compiledValue: evaluation.variableValue,
    });
    expect(beforeEvaluation).toHaveBeenCalledTimes(1);
    expect(afterEvaluation).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(evaluation)).toBe(original);
    f.close();
  });

  test("supports flat overrides without an environment and explicit null replacement", () => {
    const flat: ParsedVariable = {
      type: "json",
      defaultValue: {},
      overrides: [{ key: "empty", segments: "*", value: null }],
    };
    const file: DatafileContent = {
      ...empty,
      variables: {
        config: {
          type: "json",
          defaultValue: {},
          overrides: [{ key: "empty", segments: "*", value: null }],
        },
      },
    };
    const evaluation: Evaluation = {
      type: "variable",
      variableKey: "config",
      reason: "variable_override_rule",
      variableOverrideIndex: 0,
      variableOverrideKey: "empty",
      variableValue: null,
    };
    const result = explainEvaluation(evaluation, file, [], { authoredVariable: flat });
    expect(evidence(result, "Authored value construction (build time)")?.overrides).toEqual([
      { path: ["empty"], segments: "*", value: null },
    ]);
    expect(result.source.environment).toBe(false);
  });

  test("does not invent provenance when an authored path is unavailable", () => {
    const f = createFeaturevisor({ datafile, logLevel: "error" });
    const evaluation = f.evaluateVariable("greeting", { country: "nl", device: "mobile" });
    const result = explainEvaluation(evaluation, datafile, [], {
      authoredVariable: source,
      environment: "staging",
    });
    expect(evidence(result, "Authored value construction (build time)")).toBeUndefined();
    expect(result.limitations.join(" ")).toContain("could not be mapped");
    f.close();
  });

  test("describes a selected feature rule override without asserting mutation history", () => {
    const result = explainEvaluation(
      {
        type: "variable",
        featureKey: "checkout",
        variableKey: "config",
        reason: "variable_override_rule",
        variableOverrideIndex: 0,
        traffic: {
          key: "all",
          segments: "*",
          percentage: 100000,
          variableOverrides: {
            config: [
              {
                key: "nl",
                conditions: { attribute: "country", operator: "equals", value: "nl" },
                value: "yes",
              },
            ],
          },
        },
        variableValue: "yes",
      },
      empty,
      [],
      {},
    );
    expect(evidence(result, "Selected compiled override selectors")?.conditions).toEqual({
      attribute: "country",
      operator: "equals",
      value: "nl",
    });
    expect(result.summary).toContain("feature rule");
    expect(result.limitations.join(" ")).toContain("does not contain a mutation history");
  });

  test("reports availability without guessing an exclusion cause", () => {
    const result = explainEvaluation(
      { type: "variable", variableKey: "greeting", reason: "variable_not_found" },
      empty,
      [],
      { definitionExists: true, target: "web" },
    );
    expect(evidence(result, "Entity availability")).toMatchObject({
      definedInProject: true,
      presentInDatafile: false,
    });
    expect(evidence(result, "Entity availability")?.note).toContain("No specific exclusion cause");
  });

  test("renders a concise nested override summary without changing JSON evidence", () => {
    const f = createFeaturevisor({ datafile, logLevel: "error" });
    const evaluation = f.evaluateVariable("greeting", { country: "nl", device: "mobile" });
    const explanation = explainEvaluation(evaluation, datafile, [], {
      authoredVariable: source,
      environment: "production",
    });
    const original = JSON.stringify(explanation);
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      printExplanation(explanation);
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain("nl → mobile");
      expect(output).toContain("country =");
      expect(output).toContain("mutations to text, count");
      expect(output).not.toContain("compiledIndex");
      expect(output).not.toContain("[sdk-result]");
      expect(output.match(/Value:/g)).toHaveLength(1);
      expect(output.split("\n").length).toBeLessThan(35);
      expect(JSON.stringify(explanation)).toBe(original);
    } finally {
      log.mockRestore();
      f.close();
    }
  });

  test("colours successful values, unavailable values and errors, respecting NO_COLOR", () => {
    const env = process.env;
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      process.env = { ...env, FORCE_COLOR: "1" };
      delete process.env.NO_COLOR;
      const success = explainEvaluation(
        { type: "flag", reason: "rule", enabled: true },
        empty,
        [],
        {},
      );
      const disabled = explainEvaluation(
        { type: "flag", reason: "rule", enabled: false },
        empty,
        [],
        {},
      );
      const error = explainEvaluation({ type: "variable", reason: "error" }, empty, [], {});
      printExplanation(success);
      printExplanation(disabled);
      printExplanation(error);
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain("\x1b[32mValue: true");
      expect(output).toContain("\x1b[33mValue: false");
      expect(output).toContain("\x1b[31mValue: No value returned");
      for (const setting of [{ NO_COLOR: "1" }, { FORCE_COLOR: "0" }]) {
        process.env = { ...env, ...setting };
        log.mockClear();
        printExplanation(success);
        expect(log.mock.calls.flat().join("\n")).not.toContain("\x1b[");
      }
    } finally {
      process.env = env;
      log.mockRestore();
    }
  });

  test("renders NOT as negated AND and scales datafile rollout units for humans", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const explanation = explainEvaluation(
        {
          type: "flag",
          reason: "rule",
          enabled: true,
          traffic: { key: "some", percentage: 12500, segments: { not: ["nl", "de"] } },
        },
        empty,
        [],
        {},
      );
      printExplanation(explanation, false);
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain("12.5% rollout");
      expect(output).toContain("NOT (nl AND de)");
      expect(output).not.toContain("Full evidence");
    } finally {
      log.mockRestore();
    }
  });

  test("serializes errors explicitly and renders nested objects without inspector placeholders", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = explainEvaluation(
        { type: "variable", reason: "error", error: new Error("broken") },
        empty,
        [],
        {},
      );
      expect(evidence(result, "Evaluation error")).toEqual({ name: "Error", message: "broken" });
      printExplanation(result);
      const withValue = explainEvaluation(
        {
          type: "variable",
          reason: "variable_default",
          variableValue: { deep: { items: [{ a: true }] } },
        },
        empty,
        [],
        {},
      );
      printExplanation(withValue);
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain("No value returned");
      expect(output).toContain('"a": true');
      expect(output).not.toContain("[Object]");
      expect(output).toContain("not a complete execution trace");
    } finally {
      log.mockRestore();
    }
  });
});
