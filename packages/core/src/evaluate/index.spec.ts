import type { DatafileContent, DatafileVariable, VariableValue } from "@featurevisor/types";
import type { Dependencies } from "../dependencies";
import { buildRuntimeDatafiles } from "../builder/buildRuntimeDatafiles";
import { evaluateFeature } from "./index";
import { explainEvaluation } from "./explain";

jest.mock("../builder/buildRuntimeDatafiles", () => ({ buildRuntimeDatafiles: jest.fn() }));
jest.mock("./explain", () => {
  const actual = jest.requireActual("./explain");
  return { ...actual, explainEvaluation: jest.fn(actual.explainEvaluation) };
});

// Keep this v3 datafile shape to verify SDK legacy reading before CLI presentation.
const file: DatafileContent = {
  schemaVersion: "2",
  revision: "test",
  segments: {},
  features: {
    pricing: {
      bucketBy: "userId",
      disabledVariationValue: "control",
      variations: [{ value: "control" }, { value: "treatment" }],
      variablesSchema: {
        message: { type: "string", defaultValue: "Hi", useDefaultWhenDisabled: true },
      },
      traffic: [{ key: "off", segments: "*", percentage: 0 }],
    },
  },
  variables: { supportEmail: { type: "string", defaultValue: "support@example.com" } },
};

describe("evaluate --explain", () => {
  const aliasSources: Array<{ source: DatafileVariable; expected: VariableValue }> = [
    { source: { type: "boolean", defaultValue: false }, expected: false },
    { source: { type: "integer", defaultValue: 0 }, expected: 0 },
    { source: { type: "number", defaultValue: 1.5 }, expected: 1.5 },
    { source: { type: "string", defaultValue: "" }, expected: "" },
    { source: { type: "string", defaultValue: "1.0.0" }, expected: "1.0.0" },
    { source: { type: "array", defaultValue: ["source"] }, expected: ["source"] },
    { source: { type: "object", defaultValue: { count: 1 } }, expected: { count: 1 } },
    { source: { type: "json", defaultValue: '"decoded"' }, expected: "decoded" },
    { source: { type: "json", defaultValue: '[{"count":1}]' }, expected: [{ count: 1 }] },
    { source: { type: "json", defaultValue: "null" }, expected: null },
  ];
  test.each(aliasSources)(
    "evaluates alias datafile $source.type without a member wrapper",
    async ({ source, expected }) => {
      const datafile: DatafileContent = {
        ...file,
        variables: {
          "policy/eu.current": source,
          alias: { type: source.type, compose: "policy/eu.current" },
        },
      };
      jest.mocked(buildRuntimeDatafiles).mockResolvedValue([{ datafile }]);
      for (const explain of [false, true]) {
        await evaluateFeature(deps, { variable: "alias", context: {}, json: true, explain });
        const result = output();
        expect(result.variableValue).toEqual(expected);
        expect(result.reason).toBe("variable_composed");
        if (explain) {
          expect(result.explanation.evidence).toContainEqual({
            basis: "sdk-result",
            title: "Composition source",
            details: {
              afterOverrides: false,
              source: { variable: "policy/eu.current" },
              sourceKind: "global variable",
              hasValue: true,
              value: expected,
            },
          });
        }
        log.mockClear();
        await evaluateFeature(deps, { variable: "alias", context: {}, explain });
        const text = log.mock.calls
          .flat()
          .join("\n")
          .replace(/\x1b\[[0-9;]*m/g, "");
        expect(text).toContain("Alias source: policy/eu.current");
        expect(text).toContain(`SDK result: ${JSON.stringify(expected)}`);
        expect(text).not.toContain("Composition members");
      }
    },
  );

  test.each([false, true])(
    "explains final dynamic alias overrides without replaying the source (explain=%s)",
    async (explain) => {
      const datafile: DatafileContent = {
        ...file,
        variables: {
          "policy/eu.current": {
            type: "json",
            defaultValue: '"default"',
            overrideProgram: [
              {
                key: "source",
                keyPath: ["source"],
                conditions: { attribute: "country", operator: "equals", value: "nl" },
                operations: [{ op: "set", path: [], value: '"source override"' }],
                onMatch: 1,
                onMiss: 1,
              },
            ],
          },
          alias: {
            type: "json",
            compose: "policy/eu.current",
            overrideProgram: [
              {
                key: "alias",
                keyPath: ["alias"],
                conditions: { attribute: "country", operator: "equals", value: "nl" },
                operations: [{ op: "set", path: [], value: "alias override" }],
                onMatch: 1,
                onMiss: 1,
              },
            ],
          },
        },
      };
      jest.mocked(buildRuntimeDatafiles).mockResolvedValue([{ datafile }]);
      for (const country of ["de", "nl"]) {
        await evaluateFeature(deps, {
          variable: "alias",
          context: { country },
          json: true,
          explain,
        });
        const result = output();
        const expected = country === "nl" ? "alias override" : "default";
        expect(result.variableValue).toBe(expected);
        expect(result.reason).toBe(
          country === "nl" ? "variable_override_rule" : "variable_composed",
        );
        if (explain) {
          const evidence = result.explanation.evidence.find(
            (entry: any) => entry.title === "Composition source",
          );
          expect(evidence.details.value).toBe(expected);
          expect(evidence.details.afterOverrides).toBe(country === "nl");
        }
      }
      await evaluateFeature(deps, { variable: "alias", context: { country: "nl" }, explain });
      const text = log.mock.calls
        .flat()
        .join("\n")
        .replace(/\x1b\[[0-9;]*m/g, "");
      expect(text).toContain('SDK result after overrides: "alias override"');
    },
  );
  test.each([false, true])("shows SDK composition members with explain=%s", async (explain) => {
    const datafile: DatafileContent = {
      ...file,
      variables: {
        ...file.variables,
        config: {
          type: "object",
          compose: [
            { key: "enabled", feature: "pricing" },
            { key: "layout", feature: "pricing", variation: true as const },
            { key: "message", feature: "pricing", variable: "message" },
            { key: "email", variable: "supportEmail" },
          ],
        },
      },
    };
    jest.mocked(buildRuntimeDatafiles).mockResolvedValue([{ datafile }]);
    await evaluateFeature(deps, { variable: "config", context: {}, explain });
    const text = log.mock.calls
      .flat()
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join("\n");
    if (explain) {
      expect(text).toContain("source: pricing, flag");
      expect(text).toContain("source: pricing, variation");
      expect(text).toContain("source: pricing / message, feature variable");
      expect(text).toContain("source: supportEmail, global variable");
      expect(text).not.toContain('"feature":"pricing"');
    } else {
      expect(text).toContain('"feature":"pricing"');
      expect(text).toContain('"variable":"supportEmail"');
    }
    expect(text).toContain("enabled:");
    expect(text).toContain("layout:");
    expect(text).toContain("control");
  });
  const datasource = {
    getSet: jest.fn(() => "production"),
    featureExists: jest.fn(async () => true),
    variableExists: jest.fn(async () => true),
    listFeatures: jest.fn(async () => ["pricing"]),
    listVariables: jest.fn(async () => ["supportEmail"]),
    readVariable: jest.fn(async () => ({ type: "string", defaultValue: "support@example.com" })),
    listAttributes: jest.fn(async () => ["country", "now"]),
    readAttribute: jest.fn(async (key: string) =>
      key === "now" ? { type: "string", format: "date-time" } : { type: "string" },
    ),
    listSchemas: jest.fn(async () => []),
    readSchema: jest.fn(),
  };
  const deps = { datasource } as unknown as Dependencies;
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(buildRuntimeDatafiles).mockResolvedValue([{ datafile: structuredClone(file) }]);
    log = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  const output = () => JSON.parse(log.mock.calls[log.mock.calls.length - 1][0]);

  test("feature variable explanations never borrow a same named global variable gate", async () => {
    const datafile: DatafileContent = {
      ...file,
      features: {
        pricing: {
          ...file.features.pricing,
          traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
        },
      },
      variables: {
        message: {
          type: "boolean",
          defaultValue: false,
          conditions: { attribute: "member", operator: "equals", value: true },
        },
      },
    };
    jest.mocked(buildRuntimeDatafiles).mockResolvedValue([{ datafile }]);
    await evaluateFeature(deps, { feature: "pricing", context: {}, explain: true, json: true });
    const result = output();
    expect(result.variables.message.variableValue).toBe("Hi");
    for (const explanation of [
      result.explanation.flag,
      result.explanation.variation,
      result.explanation.variables.message,
    ]) {
      expect(
        explanation.evidence
          .filter((entry) => entry.basis === "cli-probe")
          .map((entry) => entry.details.scope),
      ).toEqual(["rule"]);
      expect(
        explanation.evidence.some(
          (entry) => entry.title === "Declared root conditions (not an execution trace)",
        ),
      ).toBe(false);
    }
    datafile.features.pricing.conditions = {
      attribute: "allowed",
      operator: "equals",
      value: true,
    };
    log.mockClear();
    await evaluateFeature(deps, {
      feature: "pricing",
      context: { allowed: true },
      explain: true,
      json: true,
    });
    const ownRoot = output().explanation.variables.message.evidence.find(
      (entry) => entry.basis === "cli-probe" && entry.details.scope === "root",
    );
    expect(ownRoot.details.expression).toMatchObject({ attribute: "allowed", passed: true });
    log.mockClear();
    await evaluateFeature(deps, { variable: "message", context: {}, explain: true, json: true });
    const globalRoot = output().explanation.evidence.find(
      (entry) => entry.basis === "cli-probe" && entry.details.scope === "root",
    );
    expect(globalRoot.details.expression).toMatchObject({ attribute: "member", passed: false });
  });

  test("presents normalized legacy SDK selectors as conditions only", async () => {
    await evaluateFeature(deps, { feature: "pricing", context: {}, explain: true, json: true });
    const matched = output().explanation.flag.evidence.find(
      (entry) => entry.title === "Matched rule",
    );
    expect(matched.details.conditions).toBe("*");
    expect(matched.details).not.toHaveProperty("segments");
    expect(matched.details).not.toHaveProperty("requiredFeatures");
  });

  test("explains root and every rule condition with evidence for all leaf kinds", async () => {
    const datafile: DatafileContent = {
      schemaVersion: "4",
      revision: "mixed",
      segments: {
        audience: { conditions: { feature: "source" } },
      },
      features: {
        source: {
          bucketBy: "userId",
          traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
        },
        pricing: {
          bucketBy: "userId",
          conditions: "audience",
          traffic: [
            {
              key: "member",
              conditions: [
                "audience",
                { attribute: "country", operator: "equals", value: "nl" },
                { variable: "plan", operator: "equals", value: "premium" },
              ],
              percentage: 100000,
            },
            { key: "visitor", conditions: "*", percentage: 100000 },
          ],
        },
      },
      variables: { plan: { type: "string", defaultValue: "basic" } },
    };
    jest.mocked(buildRuntimeDatafiles).mockResolvedValue([{ datafile }]);
    await evaluateFeature(deps, {
      feature: "pricing",
      context: { country: "nl" },
      explain: true,
      json: true,
    });
    const result = output();
    expect(result.flag.ruleKey).toBe("visitor");
    const probes = result.explanation.flag.evidence.filter((entry) => entry.basis === "cli-probe");
    expect(
      probes.map((entry) => [entry.details.scope, entry.details.key, entry.details.passed]),
    ).toEqual([
      ["root", undefined, true],
      ["rule", "member", false],
      ["rule", "visitor", true],
    ]);
    expect(probes[1].details.expression.children.map((node) => node.leafKind)).toEqual([
      "segment",
      "attribute",
      "variable",
    ]);
    expect(probes[1].details.expression.children[2]).toMatchObject({
      operand: "basic",
      expected: "premium",
      passed: false,
    });
    expect(probes[0].details.expression.children[0]).toMatchObject({
      leafKind: "feature",
      operand: { enabled: true },
    });
    for (const evaluation of [result.explanation.flag, result.explanation.variation]) {
      expect(evaluation.evidence.filter((entry) => entry.basis === "cli-probe")).toHaveLength(3);
    }
  });

  test.each([{ feature: "pricing" }, { variable: "supportEmail" }])(
    "adds warning metadata without changing evaluation or explanation for %j",
    async (selection) => {
      const context = { country: 42, now: "2026-01-01", unknown: false };
      await evaluateFeature(deps, { ...selection, context: {}, json: true, explain: true });
      const baseline = output();
      await evaluateFeature(deps, {
        ...selection,
        context,
        json: true,
        explain: true,
        pretty: true,
      });
      const { warnings, ...result } = output();
      expect(warnings).toEqual([
        {
          attribute: "country",
          message: 'Context value 42 for "country" does not match its attribute type "string".',
        },
        {
          attribute: "now",
          message:
            'Context value "2026-01-01" for "now" is not a valid date. The before and after operators do not match this value. Use YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm.',
        },
      ]);
      // Explanation describes the supplied context, but its result stays unchanged.
      if (selection.feature) {
        expect(result.flag).toEqual(baseline.flag);
        expect(result.variation).toEqual(baseline.variation);
        expect(result.variables).toEqual(baseline.variables);
        expect(result.explanation.flag.result).toEqual(baseline.explanation.flag.result);
      } else {
        expect(result.variableValue).toEqual(baseline.variableValue);
        expect(result.explanation.result).toEqual(baseline.explanation.result);
      }
      expect(context).toEqual({ country: 42, now: "2026-01-01", unknown: false });
    },
  );

  test.each([false, true])(
    "keeps global object payload warning keys intact (explain=%s)",
    async (explain) => {
      const objectFile = structuredClone(file);
      objectFile.variables!.supportEmail = {
        type: "object",
        defaultValue: { warnings: ["payload"], explanation: "payload", attribute: "payload" },
      };
      jest.mocked(buildRuntimeDatafiles).mockResolvedValue([{ datafile: objectFile }]);
      await evaluateFeature(deps, {
        variable: "supportEmail",
        context: { country: 42 },
        json: true,
        explain,
      });
      expect(output().variableValue).toEqual({
        warnings: ["payload"],
        explanation: "payload",
        attribute: "payload",
      });
      expect(output().warnings).toHaveLength(1);
    },
  );

  test("omits warnings for valid contexts and unknown attributes", async () => {
    await evaluateFeature(deps, {
      feature: "pricing",
      context: { country: "nl", now: "2026-01-01T00:00:00.123456789Z", unknown: {} },
      json: true,
    });
    expect(output()).not.toHaveProperty("warnings");
  });

  test.each([{ feature: "pricing" }, { variable: "supportEmail" }])(
    "prints a Warnings section in text for %j",
    async (selection) => {
      await evaluateFeature(deps, { ...selection, context: { country: 42 }, explain: true });
      const text = log.mock.calls
        .flat()
        .join("\n")
        .replace(/\x1b\[[0-9;]*m/g, "");
      expect(text).toContain("Warnings");
      expect(text).toContain(
        'Context value 42 for "country" does not match its attribute type "string".',
      );
      expect(text).not.toContain("Environment");
    },
  );

  test("puts warnings inside each existing Target evaluation wrapper", async () => {
    jest.mocked(buildRuntimeDatafiles).mockResolvedValue([
      { target: "all", datafile: file },
      { target: "web", datafile: { ...file, variables: {} } },
    ]);
    await evaluateFeature(deps, {
      variable: "supportEmail",
      target: ["all", "web"],
      context: { country: 42 },
      json: true,
      explain: true,
    });
    const result = output();
    expect(Array.isArray(result)).toBe(true);
    expect(result.map((entry: { target: string }) => entry.target)).toEqual(["all", "web"]);
    expect(result[0].evaluations.warnings).toEqual(result[1].evaluations.warnings);
    expect(result[1].evaluations.reason).toBe("variable_not_found");
  });

  test("loads reusable schemas for object attribute warnings", async () => {
    datasource.listAttributes.mockResolvedValueOnce(["user"]);
    datasource.readAttribute.mockResolvedValueOnce({
      type: "object",
      properties: { id: { schema: "identifier" } },
    } as any);
    datasource.listSchemas.mockResolvedValueOnce(["identifier"] as never[]);
    datasource.readSchema.mockResolvedValueOnce({ type: "integer" });
    await evaluateFeature(deps, {
      feature: "pricing",
      context: { user: { id: "invalid" } },
      json: true,
    });
    expect(output().warnings[0].attribute).toBe("user.id");
  });

  test("does not introduce an evaluation gate for unreadable warning metadata", async () => {
    datasource.readAttribute.mockRejectedValueOnce(new Error("Unreadable attribute"));
    datasource.listSchemas.mockResolvedValueOnce(["unreadable"] as never[]);
    datasource.readSchema.mockRejectedValueOnce(new Error("Unreadable schema"));
    await expect(
      evaluateFeature(deps, { feature: "pricing", context: { country: 42 }, json: true }),
    ).resolves.toBeUndefined();
    expect(output()).not.toHaveProperty("warnings");
    expect(output().flag.enabled).toBe(false);
  });

  test.each([false, true])(
    "rejects mismatched explanations before output (json=%s)",
    async (json) => {
      const real = jest.requireActual<typeof import("./explain")>("./explain").explainEvaluation;
      jest.mocked(explainEvaluation).mockImplementationOnce((...args) => {
        const result = real(...args);
        result.result.value = "wrong";
        return result;
      });
      await expect(
        evaluateFeature(deps, { variable: "supportEmail", context: {}, json, explain: true }),
      ).rejects.toMatchObject({ code: "evaluation_explanation_mismatch" });
      expect(log).not.toHaveBeenCalled();
    },
  );

  test.each([{ feature: "pricing" }, { variable: "supportEmail" }])(
    "keeps SDK JSON results unchanged for %j",
    async (selection) => {
      const options = { ...selection, context: {}, json: true };
      await evaluateFeature(deps, options);
      const plain = output();
      expect(plain).not.toHaveProperty("explanation");
      expect(datasource.getSet).not.toHaveBeenCalled();
      expect(datasource.readVariable).not.toHaveBeenCalled();
      await evaluateFeature(deps, { ...options, explain: true, pretty: true, verbose: true });
      const { explanation, ...evaluations } = output();
      expect(evaluations).toEqual(plain);
      expect(explanation).toBeDefined();
      if (selection.feature) {
        expect(explanation.variation.result.value).toBe("control");
        expect(explanation.variables.message.result.value).toBe("Hi");
      } else {
        expect(explanation.result.value).toBe("support@example.com");
      }
      expect(log.mock.calls).toHaveLength(2);
    },
  );

  test("preserves repeated Target wrappers and adds target specific explanations", async () => {
    jest.mocked(buildRuntimeDatafiles).mockResolvedValue([
      { target: "all", datafile: file },
      { target: "web", datafile: { ...file, variables: {} } },
    ]);
    await evaluateFeature(deps, {
      variable: "supportEmail",
      target: ["all", "web"],
      context: {},
      json: true,
      explain: true,
    });
    const result = output();
    expect(result.map((entry: { target: string }) => entry.target)).toEqual(["all", "web"]);
    expect(result[0].evaluations.explanation.source).toMatchObject({
      set: "production",
      target: "all",
    });
    expect(result[1].evaluations.explanation.result).toMatchObject({
      reason: "variable_not_found",
      hasValue: false,
    });
    expect(datasource.readVariable).toHaveBeenCalledTimes(1);
  });

  test.each([false, true])(
    "rejects unknown selections before building (explain=%s)",
    async (explain) => {
      for (const json of [false, true]) {
        datasource.variableExists.mockResolvedValueOnce(false);
        await expect(
          evaluateFeature(deps, { variable: "supportEmai", context: {}, json, explain }),
        ).rejects.toMatchObject({
          code: "unknown_variable",
          message: 'Unknown variable "supportEmai". Did you mean "supportEmail"?',
        });
        datasource.featureExists.mockResolvedValueOnce(false);
        await expect(
          evaluateFeature(deps, { feature: "pricin", context: {}, json, explain }),
        ).rejects.toMatchObject({
          code: "unknown_feature",
          message: 'Unknown feature "pricin". Did you mean "pricing"?',
        });
      }
      expect(buildRuntimeDatafiles).not.toHaveBeenCalled();
      expect(datasource.readVariable).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    },
  );

  test("omits the environment label for a flat project", async () => {
    await evaluateFeature(deps, { feature: "pricing", context: {} });
    expect(log.mock.calls.flat().join(" ")).not.toContain("Environment");
    log.mockClear();
    await evaluateFeature(deps, { variable: "supportEmail", context: {}, environment: "staging" });
    expect(log.mock.calls.flat().join(" ")).toContain("staging");
  });

  test("adds root probe evidence to JSON without changing the SDK result", async () => {
    const guarded = structuredClone(file);
    guarded.features.pricing.conditions = [
      {
        or: [
          { variable: "supportEmail", operator: "equals", value: "wrong" },
          { variable: "absent", operator: "isNull" },
        ],
      },
      { variable: "supportEmail", operator: "notEmpty" },
    ];
    jest.mocked(buildRuntimeDatafiles).mockResolvedValue([{ datafile: guarded }]);
    await evaluateFeature(deps, { feature: "pricing", context: {}, json: true, explain: true });
    const result = output();
    expect(result.flag.reason).not.toBe("conditions_unmet");
    const evidence = result.explanation.flag.evidence.find(
      (entry: { basis: string }) => entry.basis === "cli-probe",
    );
    expect(evidence.title).toContain("not an execution trace");
    expect(evidence.details).toMatchObject({ scope: "root", passed: true, reliable: true });
    expect(
      evidence.details.expression.children[0].children.map(
        (leaf: { passed: boolean }) => leaf.passed,
      ),
    ).toEqual([false, true]);
    expect(result.explanation.flag.limitations.join(" ")).toContain(
      "skipped by SDK short circuiting",
    );
  });

  test("prints root probe leaves and marks them as supplementary", async () => {
    const guarded = structuredClone(file);
    guarded.variables!.supportEmail.conditions = [{ variable: "missing", operator: "notNull" }];
    jest.mocked(buildRuntimeDatafiles).mockResolvedValue([{ datafile: guarded }]);
    await evaluateFeature(deps, { variable: "supportEmail", context: {}, explain: true });
    const text = log.mock.calls
      .flat()
      .join("\n")
      .replace(/\x1b\[[0-9;]*m/g, "");
    expect(text).toContain("CLI probe, root: FAIL");
    expect(text).toContain("global missing: null notNull");
    expect(text).toContain("not an SDK execution trace");
  });

  test("fixes the disabled variation headline with or without explanation", async () => {
    for (const explain of [false, true]) {
      log.mockClear();
      await evaluateFeature(deps, { feature: "pricing", context: {}, explain });
      const text = log.mock.calls.flat().join("\n");
      expect(text).toContain('Value: "control"');
      expect(text.includes("Explanation:")).toBe(explain);
      if (explain) {
        expect(text.match(/Full evidence and limitations/g)).toHaveLength(1);
        expect(text.match(/Value:/g)).toHaveLength(3);
      }
    }
  });

  test("rejects conflicting selectors before building", async () => {
    await expect(
      evaluateFeature(deps, {
        feature: "pricing",
        variable: "supportEmail",
        context: {},
        explain: true,
      }),
    ).rejects.toThrow("exactly one");
    expect(buildRuntimeDatafiles).not.toHaveBeenCalled();
  });
});
