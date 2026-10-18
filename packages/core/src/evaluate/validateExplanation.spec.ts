import type { DatafileContent } from "@featurevisor/types";
import type { Evaluation } from "@featurevisor/sdk";
import { FeaturevisorCLIError, formatFeaturevisorCLIError } from "../error";
import { explainEvaluation } from "./explain";
import type { EvaluationExplanation, ExplanationOptions } from "./explain";
import { assertExplanationMatchesEvaluation } from "./validateExplanation";
import { probeConditions } from "./probeConditions";

const empty: DatafileContent = { schemaVersion: "2", revision: "test", features: {}, segments: {} };
const check = (evaluation: Evaluation, datafile = empty, options: ExplanationOptions = {}) => {
  const explanation = explainEvaluation(evaluation, datafile, [], options);
  assertExplanationMatchesEvaluation(evaluation, explanation, datafile, options);
  return explanation;
};

describe("explanation consistency", () => {
  test("rejects a probe contradicting a passed root without asserting skipped roots", () => {
    const probe = probeConditions(empty, {}, [{ variable: "absent", operator: "notNull" }]);
    const options = { conditionsProbe: probe };
    expect(() =>
      check({ type: "flag", featureKey: "gate", reason: "rule", enabled: true }, empty, options),
    ).toThrow("evidence.cliProbe.reachedRootSuccess");
    for (const reason of ["forced", "sticky", "conditions_unmet", "error"] as const) {
      expect(() =>
        check({ type: "flag", featureKey: "gate", reason }, empty, options),
      ).not.toThrow();
    }
    expect(() =>
      check({ type: "flag", featureKey: "gate", reason: "rule", enabled: true }, empty, {
        conditionsProbe: { ...probe, reliable: false },
      }),
    ).not.toThrow();
  });
  test("rejects tampered probe evidence and a reached root failure contradicted by a reliable probe", () => {
    const datafile: DatafileContent = {
      ...empty,
      variables: {
        gate: {
          type: "boolean",
          defaultValue: true,
          conditions: [{ variable: "gateSource", operator: "equals", value: true }],
        },
        gateSource: { type: "boolean", defaultValue: true },
      },
    };
    const probe = probeConditions(datafile, {}, datafile.variables!.gate.conditions!);
    const sdk: Evaluation = {
      type: "variable",
      variableKey: "gate",
      reason: "conditions_unmet",
    };
    const options = { conditionsProbe: probe };
    const explanation = explainEvaluation(sdk, datafile, [], options);
    expect(() => assertExplanationMatchesEvaluation(sdk, explanation, datafile, options)).toThrow(
      "evidence.cliProbe.reachedRootFailure",
    );
    sdk.reason = "variable_default";
    const ordinary = explainEvaluation(sdk, datafile, [], options);
    ordinary.evidence.find((entry) => entry.basis === "cli-probe")!.details.passed = false;
    expect(() => assertExplanationMatchesEvaluation(sdk, ordinary, datafile, options)).toThrow(
      "evidence.cliProbe.details",
    );
  });
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
          {
            key: "mobile",
            keyPath: ["nl", "mobile"],
            conditions: "*",
            value: { text: "selected" },
          },
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

  const accumulatingFile: DatafileContent = {
    ...empty,
    variables: {
      config: {
        type: "object",
        defaultValue: { colour: "blue", labels: [] },
        overrideProgram: [
          {
            key: "nl",
            keyPath: ["nl"],
            operations: [{ op: "set", path: ["colour"], value: "orange" }],
            onMatch: 1,
            onMiss: 2,
          },
          {
            key: "mobile",
            keyPath: ["nl", "mobile"],
            operations: [{ op: "append", path: ["labels"], value: "mobile" }],
            onMatch: 2,
            onMiss: 2,
          },
          {
            key: "experiment",
            keyPath: ["experiment"],
            operations: [{ op: "append", path: ["labels"], value: "experiment" }],
            onMatch: 3,
            onMiss: 3,
          },
        ],
      },
    },
  };
  const accumulatingEvaluation: Evaluation = {
    type: "variable",
    variableKey: "config",
    reason: "variable_override_rule",
    variableOverrideIndex: 2,
    variableOverrideKey: "experiment",
    variableOverridePath: ["experiment"],
    variableOverridePaths: [["nl"], ["nl", "mobile"], ["experiment"]],
    variableValue: { colour: "orange", labels: ["mobile", "experiment"] },
  };

  test("replays every recorded accumulating override from the default value", () => {
    expect(() => check(accumulatingEvaluation, accumulatingFile)).not.toThrow();
  });

  test("rejects a tampered accumulating final value through the normal mismatch error", () => {
    expect(() =>
      check(
        {
          ...accumulatingEvaluation,
          variableValue: { colour: "blue", labels: ["mobile", "experiment"] },
        },
        accumulatingFile,
      ),
    ).toThrow("definition.overrideProgram.finalValue");
  });

  test("rejects out of order, missing, and inconsistent accumulating override paths", () => {
    expect(() =>
      check(
        {
          ...accumulatingEvaluation,
          variableOverridePaths: [["nl", "mobile"], ["nl"], ["experiment"]],
        },
        accumulatingFile,
      ),
    ).toThrow("definition.overrideProgram.jump.0");
    expect(() =>
      check(
        {
          ...accumulatingEvaluation,
          variableOverridePaths: [["nl"], ["missing"]],
        },
        accumulatingFile,
      ),
    ).toThrow("definition.overrideProgram.path.1");
    expect(() =>
      check(
        { ...accumulatingEvaluation, variableOverridePath: ["nl", "mobile"] },
        accumulatingFile,
      ),
    ).toThrow("definition.overrideProgram.lastPath");
  });

  test("rejects tampered accumulating runtime-operation evidence", () => {
    const explanation = check(accumulatingEvaluation, accumulatingFile);
    const details = explanation.evidence.find(
      (entry) => entry.title === "Applied runtime global variable overrides",
    )!.details;
    (details.steps as Array<Record<string, unknown>>)[1].operations = [
      { op: "append", path: ["labels"], value: "tampered" },
    ];
    expect(() =>
      assertExplanationMatchesEvaluation(accumulatingEvaluation, explanation, accumulatingFile, {}),
    ).toThrow("evidence.accumulatingOverride.steps");
  });

  test.each(["variable_default", "conditions_unmet"] as const)(
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
        conditions: "*",
        variableOverrides: { config: [{ key: "nl", conditions: "*", value: "right" }] },
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
    ["Matched rule", "conditions", "wrong-segment"],
    ["Selected compiled override selectors", "conditions", "wrong-segment"],
    ["Variable value policy", "defaultValue", "wrong-default"],
    ["Selected variable override", "path", ["wrong"]],
    ["Authored value construction (build time)", "compiledValue", "wrong"],
  ])("checks displayed evidence: %s.%s", (title, field, value) => {
    const sdk: Evaluation = {
      ...selected,
      bucketValue: 10,
      ruleKey: "all",
      traffic: { key: "all", conditions: "*", percentage: 100000 },
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
