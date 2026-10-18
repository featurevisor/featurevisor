import type {
  DatafileContent,
  Condition,
  Operator,
  VariableValue,
  ConditionValue,
} from "@featurevisor/types";
import { createFeaturevisor } from "./instance";
import { createDatafile, createFeature } from "./instance.test-fixtures";
import { allConditionsAreMatched } from "./conditions";

function datafile(conditions: Condition[], value: VariableValue = null): DatafileContent {
  const override = { key: "matched", conditions, value: "matched" };
  return createDatafile({
    features: {
      sourceFeature: createFeature({
        variablesSchema: { source: { type: "object", defaultValue: value, disabledValue: value } },
      }),
      gated: createFeature({ conditions }),
      rule: createFeature({
        variablesSchema: { message: { type: "string", defaultValue: "default" } },
        traffic: [
          {
            key: "all",
            segments: "*",
            percentage: 100000,
            allocation: [],
            variableOverrides: { message: [override] },
          },
        ],
      }),
      variation: createFeature({
        variablesSchema: { message: { type: "string", defaultValue: "default" } },
        variations: [{ value: "control", variableOverrides: { message: [override] } }],
        force: [{ segments: "*", enabled: true, variation: "control" }],
      }),
    },
    variables: {
      source: { type: "object", defaultValue: value },
      root: {
        type: "string",
        defaultValue: "matched",
        disabledValue: "default",
        conditions,
      },
      override: { type: "string", defaultValue: "default", overrides: [override] },
      program: {
        type: "string",
        defaultValue: "default",
        overrideProgram: [
          {
            key: "matched",
            keyPath: ["matched"],
            conditions,
            operations: [{ op: "set", path: [], value: "matched" }],
            onMatch: 1,
            onMiss: 1,
          },
        ],
      },
    },
  });
}

describe("evaluated variable requirements", () => {
  const comparisons: [Operator, VariableValue, ConditionValue, boolean][] = [
    ["equals", false, false, true],
    ["equals", 0, 0, true],
    ["equals", "", "", true],
    ["equals", null, null, true],
    ["notEquals", null, 0, true],
    ["equals", 3, "3", false],
    ["greaterThan", 3, 2, true],
    ["greaterThanOrEquals", 3, 3, true],
    ["lessThan", 3, 4, true],
    ["lessThanOrEquals", 3, 3, true],
    ["greaterThan", "3", 2, false],
    ["contains", "hello", "ell", true],
    ["notContains", "hello", "x", true],
    ["startsWith", "hello", "he", true],
    ["endsWith", "hello", "lo", true],
    ["matches", "hello", "^he", true],
    ["notMatches", "hello", "^no", true],
    ["semverEquals", "2.0.0", "2.0.0", true],
    ["semverNotEquals", "2.0.0", "1.0.0", true],
    ["semverGreaterThan", "2.0.0", "1.0.0", true],
    ["semverGreaterThanOrEquals", "2.0.0", "2.0.0", true],
    ["semverLessThan", "1.0.0", "2.0.0", true],
    ["semverLessThanOrEquals", "2.0.0", "2.0.0", true],
    ["before", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", true],
    ["after", "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z", true],
    ["includes", [false, 0, null] as unknown as VariableValue, null, true],
    ["notIncludes", ["a"], "b", true],
    ["in", "a", ["a", "b"], true],
    ["notIn", 2, [0, 1], true],
    ["exists", null, undefined, true],
    ["notExists", null, undefined, false],
    ["isNull", null, undefined, true],
    ["notNull", null, undefined, false],
    ["isNull", false, undefined, false],
    ["notNull", false, undefined, true],
    ["empty", "", undefined, true],
    ["notEmpty", "", undefined, false],
    ["empty", " ", undefined, false],
    ["notEmpty", " ", undefined, true],
    ["empty", [], undefined, true],
    ["notEmpty", [null] as unknown as VariableValue, undefined, true],
    ["empty", {}, undefined, true],
    ["notEmpty", { x: null } as unknown as VariableValue, undefined, true],
    ["empty", null, undefined, false],
    ["notEmpty", null, undefined, false],
    ["empty", false, undefined, false],
    ["notEmpty", false, undefined, false],
    ["empty", 0, undefined, false],
    ["notEmpty", 0, undefined, false],
  ];
  for (const feature of [undefined, "sourceFeature"]) {
    test.each(comparisons)(
      `${feature || "global"}: %s actual=%j expected=%j`,
      (operator, actual, value, matched) => {
        const f = createFeaturevisor({
          datafile: datafile([{ feature, variable: "source", operator, value }], actual),
        });
        expect(f.isEnabled("gated")).toBe(matched);
        const expected = matched ? "matched" : "default";
        expect(f.getVariable("rule", "message")).toBe(expected);
        expect(f.getVariable("variation", "message")).toBe(expected);
        for (const key of ["root", "override", "program"])
          expect(f.getVariable(key)).toBe(expected);
      },
    );
  }

  test.each(["missing", "source"])("uses literal null from getVariable(%s)", (variable) => {
    const f = createFeaturevisor({ datafile: datafile([{ variable, operator: "isNull" }]) });
    expect(f.getVariable(variable)).toBeNull();
    expect(f.isEnabled("gated")).toBe(true);
    expect(f.getVariable("root")).toBe("matched");
  });

  test.each([
    [["nested", "limit"], "equals", 3, true],
    [["nested.limit"], "equals", 4, true],
    [["items", 0, "enabled"], "equals", false, true],
    [["items", 1], "notExists", undefined, true],
    [["missing"], "isNull", undefined, false],
    [["missing"], "notNull", undefined, false],
    [["nil"], "isNull", undefined, true],
    [["nil", "child"], "notExists", undefined, true],
    [["toString"], "notExists", undefined, true],
    [["zero", 0], "notExists", undefined, true],
    [[], "exists", undefined, true],
  ] as [(string | number)[], Operator, ConditionValue, boolean][])(
    "traverses compiled path %j with %s",
    (path, operator, value, expected) => {
      const f = createFeaturevisor({
        datafile: datafile([{ variable: "source", path, operator, value }], {
          nested: { limit: 3 },
          "nested.limit": 4,
          items: [{ enabled: false }],
          nil: null,
          zero: { "0": "object key" },
        } as unknown as VariableValue),
      });
      expect(f.isEnabled("gated")).toBe(expected);
    },
  );

  test("never splits namespaced entity keys", () => {
    const d = datafile([
      {
        feature: "shop.checkout",
        variable: "some.value",
        path: ["tax.rate"],
        operator: "equals",
        value: 5,
      },
    ]);
    d.features["shop.checkout"] = createFeature({
      variablesSchema: { "some.value": { type: "object", defaultValue: { "tax.rate": 5 } } },
    });
    expect(createFeaturevisor({ datafile: d }).isEnabled("gated")).toBe(true);
  });

  test("parses json through the ordinary getter but not arbitrary strings", () => {
    const d = datafile(
      [{ variable: "source", path: ["value"], operator: "equals", value: 1 }],
      '{"value":1}',
    );
    d.variables!.source.type = "json";
    expect(createFeaturevisor({ datafile: d }).isEnabled("gated")).toBe(true);
    d.variables!.source.type = "string";
    expect(createFeaturevisor({ datafile: d }).isEnabled("gated")).toBe(false);
  });

  test("uses disabled feature variable values without adding an enabled check", () => {
    const f = createFeaturevisor({
      datafile: datafile(
        [{ feature: "sourceFeature", variable: "source", operator: "equals", value: 3 }],
        3,
      ),
      stickyFeatures: { sourceFeature: { enabled: false } },
    });
    expect(f.getVariable("sourceFeature", "source")).toBe(3);
    expect(f.isEnabled("gated")).toBe(true);
  });

  test("invalid JSON honours the null returned by the getter", () => {
    const d = datafile([{ variable: "source", operator: "isNull" }], "not json");
    d.variables!.source.type = "json";
    const f = createFeaturevisor({ datafile: d, logLevel: "fatal" });
    expect(f.getVariable("source")).toBeNull();
    expect(f.isEnabled("gated")).toBe(true);
  });

  test("a feature variable can require a different variable in the same feature", () => {
    const d = datafile([]);
    d.features.rule.variablesSchema!.source = { type: "integer", defaultValue: 3 };
    d.features.rule.traffic[0].variableOverrides!.message[0].conditions = [
      { feature: "rule", variable: "source", operator: "equals", value: 3 },
    ];
    expect(createFeaturevisor({ datafile: d }).getVariable("rule", "message")).toBe("matched");
  });

  test.each(["conditions", "segments"])(
    "combines both requirements with %s in overrides",
    (selector) => {
      const d = datafile([{ variable: "source", operator: "equals", value: 3 }], 3);
      const condition = { attribute: "country", operator: "equals" as const, value: "nl" };
      d.segments = { dutch: { conditions: condition } };
      d.features.dependency = createFeature({});
      const selectors = {
        requiredFeatures: ["dependency"],
        ...(selector === "conditions" ? { conditions: condition } : { segments: ["dutch"] }),
      };
      Object.assign(d.features.rule.traffic[0].variableOverrides!.message[0], selectors);
      Object.assign(d.features.variation.variations![0].variableOverrides!.message[0], selectors);
      Object.assign(d.variables!.override.overrides![0], selectors);
      Object.assign(d.variables!.program.overrideProgram![0], selectors);
      const f = createFeaturevisor({ datafile: d });
      for (const [country, expected] of [
        ["nl", "matched"],
        ["de", "default"],
      ]) {
        expect(f.getVariable("rule", "message", { country })).toBe(expected);
        expect(f.getVariable("variation", "message", { country })).toBe(expected);
        expect(f.getVariable("override", { country })).toBe(expected);
        expect(f.getVariable("program", { country })).toBe(expected);
      }
      f.setStickyFeatures({ dependency: { enabled: false } });
      expect(f.getVariable("rule", "message", { country: "nl" })).toBe("default");
      expect(f.getVariable("override", { country: "nl" })).toBe("default");
    },
  );

  test("resets cached regex state between variable checks", () => {
    const f = createFeaturevisor({
      datafile: datafile(
        [{ variable: "source", operator: "matches", regexFlags: "gi", value: "^yes$" }],
        "YES",
      ),
    });
    expect(f.isEnabled("gated")).toBe(true);
    expect(f.isEnabled("gated")).toBe(true);
  });

  test("does not leak the caller fallback into a required variable", () => {
    const f = createFeaturevisor({
      datafile: datafile([{ variable: "missing", operator: "equals", value: "outer" }]),
    });
    expect(f.getVariable("root", {}, { defaultVariableValue: "outer" })).toBe("default");
  });

  test("honours child sticky feature and global variable values", () => {
    const d = datafile(
      [
        { variable: "source", operator: "equals", value: 3 },
        { feature: "sourceFeature", variable: "source", operator: "equals", value: 4 },
      ],
      0,
    );
    const f = createFeaturevisor({ datafile: d });
    const child = f.spawn(
      {},
      {
        stickyVariables: { source: 3 },
        stickyFeatures: { sourceFeature: { enabled: true, variables: { source: 4 } } },
      },
    );
    expect(f.isEnabled("gated")).toBe(false);
    expect(child.isEnabled("gated")).toBe(true);
    expect(child.getVariable("root")).toBe("matched");
  });

  for (const a of [false, true])
    for (const b of [false, true]) {
      const A = { variable: "a", operator: "equals" as const, value: true };
      const B = { variable: "b", operator: "equals" as const, value: true };
      test.each([
        [[A, B], a && b],
        [[{ and: [A, B] }], a && b],
        [[{ or: [A, B] }], a || b],
        [[{ not: [A, B] }], !(a && b)],
        [[{ not: [{ or: [A, B] }] }], !(a || b)],
        [[{ not: [] }], false],
      ] as [Condition[], boolean][])(`groups for ${a},${b}: %j`, (requirements, matched) => {
        const f = createFeaturevisor({
          datafile: datafile(requirements),
          stickyVariables: { a, b },
        });
        expect(f.isEnabled("gated")).toBe(matched);
      });
    }

  test("short circuits and preserves module transformations without caching", () => {
    const seen: string[] = [];
    const f = createFeaturevisor({
      datafile: datafile(
        [
          {
            or: [
              { variable: "source", operator: "equals", value: 2 },
              { variable: "skipped", operator: "isNull" },
            ],
          },
        ],
        0,
      ),
      modules: [
        {
          name: "source",
          afterEvaluation(e) {
            if (e.type === "variable" && !e.featureKey) {
              seen.push(e.variableKey!);
              if (e.variableKey === "source") return { ...e, variableValue: 2 };
            }
            return e;
          },
        },
      ],
    });
    expect(f.isEnabled("gated")).toBe(true);
    expect(f.isEnabled("gated")).toBe(true);
    expect(seen).toEqual(["source", "source"]);
  });

  test("cycles cannot be turned into a successful null check or NOT", () => {
    const d = datafile([{ variable: "cycle", operator: "isNull" }]);
    d.variables!.cycle = {
      type: "string",
      defaultValue: "cycle",
      conditions: [{ not: [{ variable: "cycle", operator: "notNull" }] }],
    };
    const diagnostics: string[] = [];
    const f = createFeaturevisor({
      datafile: d,
      logLevel: "error",
      onDiagnostic: (d) => diagnostics.push(d.code),
    });
    expect(f.evaluateFlag("gated").reason).toBe("error");
    expect(diagnostics).toContain("evaluation_error");
    f.setDatafile(createDatafile({ variables: { cycle: { type: "string", defaultValue: null } } }));
    expect(f.isEnabled("gated")).toBe(true);
  });

  test.each(["__proto__", "constructor", "prototype"])("rejects unsafe path %s", (path) => {
    const f = createFeaturevisor({
      logLevel: "fatal",
      datafile: datafile([{ variable: "source", path: [path], operator: "notExists" }], {}),
    });
    expect(f.evaluateFlag("gated").reason).toBe("error");
  });

  test.each([
    { variable: "source", operator: "matches" as const, value: "[" },
    { variable: "source", operator: "semverGreaterThan" as const, value: "1.0.0" },
  ])("comparison errors cannot satisfy NOT or be hidden by OR: %j", (requirement) => {
    for (const group of [
      { not: [requirement] },
      { or: [requirement, { variable: "missing", operator: "isNull" as const }] },
    ]) {
      const f = createFeaturevisor({
        logLevel: "fatal",
        datafile: datafile([group], "not semver"),
      });
      expect(f.evaluateFlag("gated").reason).toBe("error");
      expect(f.isEnabled("gated")).toBe(false);
    }
  });

  test.each([null, false, 0, "", undefined])(
    "null operators are shared with conditions for %j",
    (value) => {
      expect(allConditionsAreMatched({ attribute: "value", operator: "isNull" }, { value })).toBe(
        value === null,
      );
      expect(allConditionsAreMatched({ attribute: "value", operator: "notNull" }, { value })).toBe(
        value !== undefined && value !== null,
      );
    },
  );
});
