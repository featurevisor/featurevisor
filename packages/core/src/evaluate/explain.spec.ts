import type { DatafileContent, ParsedVariable } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";
import type { Evaluation, FeaturevisorDiagnostic } from "@featurevisor/sdk";
import { explainEvaluation, getEvaluationValue, printExplanation } from "./explain";
import { assertExplanationMatchesEvaluation } from "./validateExplanation";

const empty: DatafileContent = { schemaVersion: "2", revision: "test", features: {}, segments: {} };

function evidence(explanation: ReturnType<typeof explainEvaluation>, title: string) {
  return explanation.evidence.find((entry) => entry.title === title)?.details;
}

function semanticOutput(log: jest.SpyInstance): string {
  return log.mock.calls
    .flat()
    .join("\n")
    .replace(/\x1b\[[0-9;]*m/g, "");
}

describe("CLI evaluation explanations", () => {
  test("names the matched rule when the bucket is above its rollout", () => {
    const datafile: DatafileContent = {
      ...empty,
      features: {
        showWishlist: {
          bucketBy: "userId",
          traffic: [{ key: "everyone", conditions: "*", percentage: 5000, allocation: [] }],
        },
      },
    } as DatafileContent;
    const evaluation: Evaluation = {
      type: "flag",
      featureKey: "showWishlist",
      reason: "no_match",
      bucketKey: "9b30.showWishlist",
      bucketValue: 73980,
      enabled: false,
    };
    const rule = {
      scope: "rule" as const,
      key: "everyone",
      index: 0,
      passed: true,
      reliable: true,
      expression: {
        kind: "leaf" as const,
        leafKind: "wildcard" as const,
        passed: true,
        reliable: true,
      },
    };
    const options = { feature: "showWishlist", selectionProbes: [rule] };
    const explanation = explainEvaluation(evaluation, datafile, [], options);

    expect(evidence(explanation, "Rollout boundary (supplementary CLI probe)")).toEqual({
      rule: "everyone",
      percentage: 5000,
      bucketValue: 73980,
    });
    expect(explanation.summary).toContain("does not fall through to later rules");
    expect(() =>
      assertExplanationMatchesEvaluation(evaluation, explanation, datafile, options),
    ).not.toThrow();

    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      printExplanation(explanation, false);
      const output = semanticOutput(log);
      expect(output).toContain(
        "Rollout: rule everyone matched, but bucket 73.98 is above its 5% rollout",
      );
      expect(output).toContain("PASS * matches every context");
    } finally {
      log.mockRestore();
    }

    const noRule = explainEvaluation(evaluation, datafile, [], {
      ...options,
      selectionProbes: [{ ...rule, passed: false }],
    });
    expect(evidence(noRule, "Rollout boundary (supplementary CLI probe)")).toBeUndefined();

    const unreliable = explainEvaluation(evaluation, datafile, [], {
      ...options,
      selectionProbes: [{ ...rule, key: "first", passed: false, reliable: false }, rule],
    });
    expect(evidence(unreliable, "Rollout boundary (supplementary CLI probe)")).toBeUndefined();
  });

  test("prints feature leaves as expected and actual results", () => {
    const explanation = explainEvaluation(
      { type: "variable", variableKey: "banner", reason: "conditions_unmet", variableValue: null },
      empty,
      [],
      {
        conditionsProbe: {
          scope: "root",
          passed: false,
          reliable: true,
          expression: {
            kind: "leaf",
            leafKind: "feature",
            feature: "checkout",
            passed: false,
            reliable: true,
            operandPresent: true,
            operand: { enabled: false },
            expectedPresent: true,
            expected: { enabled: true },
          },
        },
      },
    );
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      printExplanation(explanation, false);
      expect(semanticOutput(log)).toContain(
        "FAIL feature checkout: enabled false, expected enabled true",
      );
    } finally {
      log.mockRestore();
    }
  });

  test("marks errored NOT probe leaves and ancestors inconclusive in human output", () => {
    const leaf = {
      kind: "leaf" as const,
      passed: false,
      reliable: false,
      variable: "text",
      operandPresent: true,
      operand: "abc",
      operator: "matches",
      expectedPresent: true,
      expected: "[",
      error: "Invalid regular expression",
    };
    const expression = {
      kind: "not" as const,
      passed: true,
      reliable: false,
      children: [leaf],
    };
    const explanation = explainEvaluation(
      { type: "variable", variableKey: "text", reason: "variable_default", variableValue: "abc" },
      empty,
      [],
      { conditionsProbe: { scope: "root", passed: true, reliable: false, expression } },
    );
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      printExplanation(explanation, false);
      const output = semanticOutput(log);
      expect(output).toContain("CLI probe, root: INCONCLUSIVE (UNRELIABLE)");
      expect(output).toContain("INCONCLUSIVE NOT");
      expect(output).toContain("Invalid regular expression");
    } finally {
      log.mockRestore();
    }
  });
  test("prints nested prerequisite logic without claiming a full trace", () => {
    const datafile: DatafileContent = {
      ...empty,
      features: {
        checkout: {
          bucketBy: "userId",
          traffic: [],
          conditions: [{ or: [{ feature: "a" }, { not: [{ feature: "b" }, { feature: "c" }] }] }],
        },
      },
    };
    const result = explainEvaluation(
      { type: "flag", featureKey: "checkout", reason: "conditions_unmet", enabled: false },
      datafile,
      [],
      {},
    );
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      printExplanation(result, false);
      expect(semanticOutput(log)).toContain("(a enabled OR NOT (b enabled AND c enabled))");
    } finally {
      log.mockRestore();
    }
  });

  test("explains the shared unmet feature reason according to the evaluated entity", () => {
    const flag = explainEvaluation(
      { type: "flag", featureKey: "checkout", reason: "conditions_unmet", enabled: false },
      empty,
      [],
      {},
    );
    const variable = explainEvaluation(
      {
        type: "variable",
        variableKey: "message",
        reason: "conditions_unmet",
        variableValue: "blocked",
      },
      empty,
      [],
      {},
    );
    expect(flag.summary).toBe("The feature's root conditions were not satisfied.");
    expect(variable.summary).toContain("The global variable's root conditions were not satisfied.");
    expect(JSON.parse(JSON.stringify(flag)).result.reason).toBe("conditions_unmet");
    expect(JSON.parse(JSON.stringify(variable)).result.reason).toBe("conditions_unmet");
  });
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
    "no_variations",
    "variation_disabled",
    "variable_not_found",
    "variable_default",
    "variable_disabled",
    "variable_override_variation",
    "variable_override_rule",
    "conditions_unmet",
    "conditions_unmet",
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

  test("presents grouped required variables as declaration metadata", () => {
    const evaluation = {
      type: "flag",
      featureKey: "checkout",
      reason: "conditions_unmet",
      enabled: false,
      conditions: [
        {
          or: [
            { variable: "maintenance", operator: "equals", value: false },
            {
              feature: "account",
              variable: "policy",
              path: ["limits.v2", 0],
              operator: "notNull",
            },
          ],
        },
      ],
    } as Evaluation;
    const explanation = explainEvaluation(evaluation, empty, [], {});
    expect(
      evidence(explanation, "Declared root conditions (not an execution trace)"),
    ).toMatchObject({ conditions: evaluation.conditions });
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      printExplanation(explanation, false);
      const output = semanticOutput(log);
      expect(output).toContain("global maintenance equals false");
      expect(output).toContain("account.policy at limits.v2.0 notNull");
      expect(output).toContain(" OR ");
    } finally {
      log.mockRestore();
    }
  });

  test("prints emptiness selectors and variable requirements without operands", () => {
    const evaluation = {
      type: "flag",
      featureKey: "checkout",
      reason: "conditions_unmet",
      enabled: false,
      conditions: [{ variable: "items", operator: "notEmpty" }],
      traffic: {
        key: "empty-label",
        percentage: 0,
        conditions: { attribute: "label", operator: "empty" },
      },
    } as Evaluation;
    const explanation = explainEvaluation(
      evaluation,
      { ...empty, features: { checkout: { bucketBy: "userId", traffic: [] } } },
      [],
      {},
    );
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      printExplanation(explanation, false);
      const output = semanticOutput(log);
      expect(output).toContain("label is empty");
      expect(output).toContain("global items notEmpty");
    } finally {
      log.mockRestore();
    }
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
      traffic: { key: "off", percentage: 0, conditions: '{"and":["nl","missing"]}' },
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
      conditions: { and: ["nl", "missing"] },
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
    const conditions = [{ feature: "pricing", enabled: false, variation: "control" }];
    const result = explainEvaluation(
      { type: "flag", reason: "conditions_unmet", conditions },
      empty,
      [],
      {},
    );
    expect(evidence(result, "Declared root conditions (not an execution trace)")).toEqual({
      conditions,
    });
    expect(JSON.stringify(result)).not.toContain('"matched":');
  });

  test("retains related diagnostic observations and warnings but omits initialization noise", () => {
    const evaluation: Evaluation = {
      type: "flag",
      featureKey: "checkout",
      reason: "conditions_unmet",
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
      {
        level: "debug",
        code: "conditions_unmet",
        message: "Result",
        details: { evaluation },
      },
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
              conditions: "mobile",
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
            conditions: [{ attribute: "country", operator: "equals", value: "nl" }, "mobile"],
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
      overrides: [{ key: "empty", conditions: "*", value: null }],
    };
    const file: DatafileContent = {
      ...empty,
      variables: {
        config: {
          type: "json",
          defaultValue: {},
          overrides: [{ key: "empty", conditions: "*", value: null }],
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
      { path: ["empty"], conditions: "*", value: null },
    ]);
    expect(result.source.environment).toBe(false);
  });

  test.each([false, true])(
    "preserves repeated authored mutation paths in JSON and human output (list=%s)",
    (list) => {
      const mutations = list
        ? [{ "items:append": "a" }, { "items:append": "b" }]
        : { "items:append": "a" };
      const authored: ParsedVariable = {
        type: "object",
        defaultValue: { items: [] },
        overrides: [
          {
            key: "parent",
            conditions: "*",
            mutate: mutations,
            overrides: [{ key: "child", conditions: "*", mutate: { "items:append": "c" } }],
          },
        ],
      };
      const evaluation: Evaluation = {
        type: "variable",
        variableKey: "config",
        reason: "variable_override_rule",
        variableOverrideIndex: 0,
        variableOverrideKey: "child",
        variableOverridePath: ["parent", "child"],
        variableValue: { items: list ? ["a", "b", "c"] : ["a", "c"] },
      };
      const file: DatafileContent = {
        ...empty,
        variables: {
          config: {
            type: "object",
            defaultValue: authored.defaultValue,
            overrides: [
              {
                key: "child",
                keyPath: ["parent", "child"],
                conditions: "*",
                value: evaluation.variableValue,
              },
            ],
          },
        },
      };
      const result = explainEvaluation(evaluation, file, [], { authoredVariable: authored });
      expect(evidence(result, "Authored value construction (build time)")?.overrides).toEqual([
        { path: ["parent"], conditions: "*", mutate: mutations },
        { path: ["parent", "child"], conditions: "*", mutate: { "items:append": "c" } },
      ]);
      const log = jest.spyOn(console, "log").mockImplementation(() => {});
      try {
        printExplanation(result);
        expect(semanticOutput(log)).toContain(
          `mutations to ${Array(list ? 3 : 2)
            .fill("items:append")
            .join(", ")}`,
        );
      } finally {
        log.mockRestore();
      }
    },
  );

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

  test("explains every applied accumulating override with its runtime operations", () => {
    const accumulating: DatafileContent = {
      ...empty,
      variables: {
        config: {
          type: "object",
          defaultValue: { colour: "blue", labels: [] },
          overrideProgram: [
            {
              key: "nl",
              keyPath: ["nl"],
              conditions: { attribute: "country", operator: "equals", value: "nl" },
              operations: [{ op: "set", path: ["colour"], value: "orange" }],
              onMatch: 1,
              onMiss: 2,
            },
            {
              key: "mobile",
              keyPath: ["nl", "mobile"],
              conditions: { attribute: "device", operator: "equals", value: "mobile" },
              operations: [{ op: "append", path: ["labels"], value: "mobile" }],
              onMatch: 2,
              onMiss: 2,
            },
            {
              key: "experiment",
              keyPath: ["experiment"],
              conditions: "*",
              operations: [{ op: "append", path: ["labels"], value: "experiment" }],
              onMatch: 3,
              onMiss: 3,
            },
          ],
        },
      },
    };
    const f = createFeaturevisor({ datafile: accumulating, logLevel: "error" });
    try {
      const evaluation = f.evaluateVariable("config", { country: "nl", device: "mobile" });
      const result = explainEvaluation(evaluation, accumulating, [], {});
      expect(evaluation).toMatchObject({
        variableValue: { colour: "orange", labels: ["mobile", "experiment"] },
        variableOverrideIndex: 2,
        variableOverrideKey: "experiment",
        variableOverridePath: ["experiment"],
        variableOverridePaths: [["nl"], ["nl", "mobile"], ["experiment"]],
      });
      expect(evidence(result, "Applied runtime global variable overrides")).toEqual({
        paths: [["nl"], ["nl", "mobile"], ["experiment"]],
        steps: [
          expect.objectContaining({
            key: "nl",
            path: ["nl"],
            operations: [{ op: "set", path: ["colour"], value: "orange" }],
            onMatch: 1,
            onMiss: 2,
          }),
          expect.objectContaining({
            key: "mobile",
            path: ["nl", "mobile"],
            operations: [{ op: "append", path: ["labels"], value: "mobile" }],
          }),
          expect.objectContaining({
            key: "experiment",
            path: ["experiment"],
            operations: [{ op: "append", path: ["labels"], value: "experiment" }],
          }),
        ],
      });
      expect(evidence(result, "Authored value construction (build time)")).toBeUndefined();
      expect(evidence(result, "Global override selection policy")?.policy).toContain(
        "runtime facts",
      );
      expect(result.summary).toBe("Global variable overrides supplied the value.");

      const log = jest.spyOn(console, "log").mockImplementation(() => {});
      try {
        printExplanation(result);
        const compactOutput = semanticOutput(log);
        expect(compactOutput).toContain("Last override:");
        expect(compactOutput).toContain("Operations: 3 compiled mutations");
        expect(compactOutput).toContain("details: --explain --json");
        expect(compactOutput).not.toContain('append ["labels"]');

        log.mockClear();
        const expandedPaths = {
          ...result,
          evidence: result.evidence.map((entry) =>
            entry.title === "Applied runtime global variable overrides"
              ? {
                  ...entry,
                  details: {
                    ...entry.details,
                    paths: [["nl"], ["nl", "mobile"], ["experiment"], ["rollout"]],
                  },
                }
              : entry,
          ),
        };
        printExplanation(expandedPaths);
        const expandedOutput = semanticOutput(log);
        expect(expandedOutput).toContain("Applied overrides: 4 matched paths");
        expect(expandedOutput).toContain("    nl → mobile");
        expect(expandedOutput).toContain("    rollout");
      } finally {
        log.mockRestore();
      }
    } finally {
      f.close();
    }
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
          conditions: "*",
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
      const output = semanticOutput(log);
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
          traffic: { key: "some", percentage: 12500, conditions: { not: ["nl", "de"] } },
        },
        empty,
        [],
        {},
      );
      printExplanation(explanation, false);
      const output = semanticOutput(log);
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
      const output = semanticOutput(log);
      expect(output).toContain("No value returned");
      expect(output).toContain('"a": true');
      expect(output).not.toContain("[Object]");
      expect(output).toContain("not a complete execution trace");
    } finally {
      log.mockRestore();
    }
  });
});
