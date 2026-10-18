import { readFileSync } from "fs";
import { resolve } from "path";

import { createFeaturevisor } from "@featurevisor/sdk";
import type { DatafileContent, TestResultAssertionError, VariableCheck } from "@featurevisor/types";

import {
  getCheckPath,
  getCheckReferences,
  parsePortableTimestamp,
  runVariableChecks,
} from "./checks";

interface CheckFixtureCase {
  name: string;
  owner?: string;
  checks: VariableCheck[];
  passed: boolean;
  error?: boolean;
}

interface CheckFixture {
  version: number;
  description: string;
  datafile: DatafileContent;
  cases: CheckFixtureCase[];
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../conformance/test-checks.json"), "utf8"),
) as CheckFixture;

function isComparisonError(error: TestResultAssertionError): boolean {
  return error.expected === "valid checks" || error.expected === "successful comparison";
}

describe("core: portable variable checks", () => {
  it("supports segment checks, grouped negation and typed failure evidence", () => {
    const getter = jest.fn(() => undefined);
    const segments = jest.fn((key: string) => key === "premium");
    expect(getCheckReferences([{ segment: "premium", matches: false }])).toEqual([
      { segment: "premium" },
    ]);
    expect(
      runVariableChecks(
        [
          { segment: "premium", matches: true },
          {
            not: [
              { segment: "premium", matches: true },
              { segment: "blocked", matches: true },
            ],
          },
          {
            or: [
              { segment: "blocked", matches: true },
              { segment: "premium", matches: true },
            ],
          },
        ],
        getter,
        undefined,
        undefined,
        undefined,
        segments,
      ),
    ).toEqual([]);
    const errors = runVariableChecks(
      [{ key: "audience", segment: "premium", matches: false }],
      getter,
      undefined,
      1,
      undefined,
      segments,
    );
    expect(errors[0].details).toMatchObject({
      childIndex: 1,
      checkKey: "audience",
      evaluated: [
        { reference: { segment: "premium" }, property: "matches", actual: true, expected: false },
      ],
    });
    expect(getter).not.toHaveBeenCalled();
    segments.mockClear();
    expect(
      runVariableChecks(
        [
          {
            or: [
              { segment: "premium", matches: true },
              { segment: "blocked", matches: true },
            ],
          },
        ],
        getter,
        undefined,
        undefined,
        undefined,
        segments,
      ),
    ).toEqual([]);
    expect(segments.mock.calls).toEqual([["premium"]]);
    expect(
      runVariableChecks(
        [{ not: [{ segment: "missing", matches: false }] }],
        getter,
        undefined,
        undefined,
        undefined,
        () => {
          throw new Error("Unknown segment");
        },
      ),
    ).toHaveLength(1);
    expect(runVariableChecks([{ segment: "premium", matches: true }], getter)[0].actual).toContain(
      "resolver is required",
    );
  });

  it.each([
    { segment: "premium" },
    { matches: true },
    { segment: "", matches: true },
    { segment: "premium", matches: "true" },
    { segment: "premium", matches: null },
    ...[
      "feature",
      "variable",
      "enabled",
      "variation",
      "operator",
      "value",
      "path",
      "compareTo",
      "regexFlags",
      "target",
    ].map((key) => ({ segment: "premium", matches: true, [key]: "invalid" })),
  ])("rejects malformed segment leaves even in skipped branches: %j", (invalid) => {
    expect(() =>
      getCheckReferences([{ or: [{ feature: "checkout", enabled: true }, invalid] }]),
    ).toThrow();
  });
  it("parses dot paths while preserving literal array path components", () => {
    expect(getCheckPath(undefined)).toEqual([]);
    expect(getCheckPath("items.0.limit")).toEqual(["items", 0, "limit"]);
    expect(getCheckPath(["items", 0, "dot.key", "0", ""])).toEqual([
      "items",
      0,
      "dot.key",
      "0",
      "",
    ]);
  });

  it("matches conditions traversal for string and integer path components", () => {
    const value = {
      items: [{ limit: 4 }],
      numericObject: { 0: "object zero" },
      label: "hello",
    };

    expect(
      runVariableChecks(
        [
          { path: ["items", "0", "limit"], operator: "equals", value: 4 },
          { path: ["items", "length"], operator: "equals", value: 1 },
          { path: ["items", "00"], operator: "notExists" },
          { path: ["items", "-1"], operator: "notExists" },
          { path: ["numericObject", 0], operator: "notExists" },
          { path: ["label", "length"], operator: "notExists" },
        ],
        () => value,
        "settings",
      ),
    ).toEqual([]);
  });

  it("checks shallow emptiness for strings, arrays and plain objects", () => {
    const inheritedOnly = Object.create({ inherited: true });
    const nullPrototype = Object.create(null);
    nullPrototype.present = null;
    const value = {
      emptyString: "",
      whitespace: " ",
      emptyArray: [],
      populatedArray: [null],
      emptyObject: inheritedOnly,
      populatedObject: { present: null },
      nullPrototype,
    };

    expect(
      runVariableChecks(
        [
          { path: "emptyString", operator: "empty" },
          { path: "whitespace", operator: "notEmpty" },
          { path: "emptyArray", operator: "empty" },
          { path: "populatedArray", operator: "notEmpty" },
          { path: "emptyObject", operator: "empty" },
          { path: "populatedObject", operator: "notEmpty" },
          { path: "nullPrototype", operator: "notEmpty" },
        ],
        () => value,
        "settings",
      ),
    ).toEqual([]);
  });

  it("returns false for null and missing with both emptiness operators", () => {
    const errors = runVariableChecks(
      [
        { path: "nullable", operator: "empty" },
        { path: "nullable", operator: "notEmpty" },
        { path: "missing", operator: "empty" },
        { path: "missing", operator: "notEmpty" },
      ],
      () => ({ nullable: null }),
      "settings",
    );

    expect(errors).toHaveLength(4);
    expect(errors.every((error) => !isComparisonError(error))).toBe(true);
  });

  it.each([true, false, 0, 1, new Date(0), new Map(), new Set(), () => undefined])(
    "reports unsupported emptiness operand %# as a comparison error",
    (value) => {
      const errors = runVariableChecks([{ variable: "value", operator: "empty" }], () => value);
      expect(errors).toHaveLength(1);
      expect(isComparisonError(errors[0])).toBe(true);
      expect(errors[0].actual).toContain("string, array or plain object");
    },
  );

  it("does not let NOT or OR turn reached emptiness type errors into matches", () => {
    for (const checks of [
      [{ not: [{ variable: "value", operator: "empty" }] }],
      [
        {
          or: [
            { variable: "value", operator: "empty" },
            { variable: "fallback", operator: "notEmpty" },
          ],
        },
      ],
    ] as VariableCheck[][]) {
      const errors = runVariableChecks(checks, ({ variable }) =>
        variable === "value" ? 0 : "fallback",
      );
      expect(errors).toHaveLength(1);
      expect(isComparisonError(errors[0])).toBe(true);
    }
  });

  it("does not resolve an incompatible value in a short circuited OR branch", () => {
    const getter = jest.fn(({ variable }: { variable: string }) =>
      variable === "ready" ? "configured" : false,
    );
    expect(
      runVariableChecks(
        [
          {
            or: [
              { variable: "ready", operator: "notEmpty" },
              { variable: "skippedBoolean", operator: "empty" },
            ],
          },
        ],
        getter,
      ),
    ).toEqual([]);
    expect(getter.mock.calls).toEqual([[{ feature: undefined, variable: "ready" }]]);
  });

  it("parses strict portable timestamps into equivalent UTC instants", () => {
    expect(parsePortableTimestamp("2024-02-29T12:34:56Z")).toBe(Date.UTC(2024, 1, 29, 12, 34, 56));
    expect(parsePortableTimestamp("2026-09-13T12:00:00.1Z")).toBe(
      parsePortableTimestamp("2026-09-13T14:00:00.100+02:00"),
    );
    expect(parsePortableTimestamp("2026-09-13T12:00:00+14:00")).toBe(
      parsePortableTimestamp("2026-09-12T22:00:00Z"),
    );
    expect(parsePortableTimestamp("2026-09-13T12:00:00-14:00")).toBe(
      parsePortableTimestamp("2026-09-14T02:00:00Z"),
    );
    expect(parsePortableTimestamp("0001-01-01T00:00:00Z")).toBe(-62135596800000);
    expect(parsePortableTimestamp("9999-12-31T23:59:59.999Z")).toBe(253402300799999);
  });

  it.each([
    "0000-01-01T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-09-13T24:00:00Z",
    "2026-09-13T23:60:00Z",
    "2026-09-13T23:59:60Z",
    "2026-09-13T12:00:00.1234567890Z",
    "2026-09-13T12:00:00+14:01",
    "2026-09-13T12:00:00-15:00",
    "0001-01-01T00:00:00+00:01",
    "9999-12-31T23:59:59.999-00:01",
    "2026-09-13 12:00:00Z",
    "2026-09-13T12:00Z",
    "2026-09-13T12:00:00z",
  ])("rejects the nonportable timestamp %s", (timestamp) => {
    expect(() => parsePortableTimestamp(timestamp)).toThrow(
      "Date comparisons require portable timestamps",
    );
  });

  it.each([
    ["empty dot component", "items..limit"],
    ["unsafe prototype component", ["nested", "__proto__"]],
    ["constructor component", "constructor.value"],
    ["wildcard component", ["items", "*"]],
    ["embedded wildcard", "items.foo*bar"],
    ["negative index", ["items", -1]],
    ["fractional index", ["items", 1.5]],
    ["unsafe numeric index", ["items", Number.MAX_SAFE_INTEGER + 1]],
    ["selector object", ["items", { first: true }]],
    ["non path value", { items: 0 }],
  ])("rejects the %s", (_name, path) => {
    expect(() => getCheckPath(path)).toThrow();
  });

  it("collects references in authored group order and applies the owner independently", () => {
    expect(
      getCheckReferences(
        [
          {
            and: [
              { path: "min", operator: "lessThan", compareTo: { path: "max" } },
              {
                feature: "checkout",
                variable: "limit",
                operator: "equals",
                value: 5,
              },
            ],
          },
        ],
        "settings",
      ),
    ).toEqual([{ path: "min" }, { path: "max" }, { feature: "checkout", variable: "limit" }]);
  });

  it.each([
    ["nonarray checks", {}],
    ["empty checks", []],
    ["empty group", [{ or: [] }]],
    ["mixed logical operators", [{ and: [], or: [] }]],
    ["logical operator with leaf property", [{ not: [{}], operator: "equals" }]],
    ["unknown leaf property", [{ variable: "limit", operator: "equals", value: 12, extra: true }]],
    ["unknown operator", [{ variable: "limit", operator: "future", value: 12 }]],
    ["missing scenario variable", [{ operator: "equals", value: 12 }]],
    ["missing feature variable", [{ feature: "checkout", operator: "equals", value: 12 }]],
    [
      "both operands",
      [{ variable: "limit", operator: "equals", value: 12, compareTo: { variable: "limit" } }],
    ],
    ["missing operand", [{ variable: "limit", operator: "equals" }]],
    ["operand on unary operator", [{ variable: "limit", operator: "exists", value: 12 }]],
    ["value on empty", [{ variable: "limit", operator: "empty", value: "" }]],
    [
      "comparison reference on notEmpty",
      [{ variable: "limit", operator: "notEmpty", compareTo: { variable: "other" } }],
    ],
    ["regex flags on empty", [{ variable: "limit", operator: "empty", regexFlags: "i" }]],
    [
      "flags on nonregex operator",
      [{ variable: "limit", operator: "equals", value: 12, regexFlags: "i" }],
    ],
    [
      "duplicate flags",
      [{ variable: "label", operator: "matches", value: "hello", regexFlags: "ii" }],
    ],
    [
      "nonportable flags",
      [{ variable: "label", operator: "matches", value: "hello", regexFlags: "u" }],
    ],
    ["lookaround regex", [{ variable: "label", operator: "matches", value: "(?=hello)" }]],
    ["backreference regex", [{ variable: "label", operator: "matches", value: "(h)\\1" }]],
    ["possessive regex", [{ variable: "label", operator: "matches", value: "h++" }]],
    ["backtracking regex", [{ variable: "label", operator: "matches", value: "^(h+)+$" }]],
    ["structured equality", [{ variable: "settings", operator: "equals", value: { min: 2 } }]],
    ["nonfinite number", [{ variable: "limit", operator: "greaterThan", value: Infinity }]],
    ["date without timezone", [{ variable: "timestamp", operator: "before", value: "2026-09-14" }]],
  ])("validates %s before evaluating", (_name, checks) => {
    expect(() => getCheckReferences(checks)).toThrow();
  });

  it.each([
    { variable: "skipped", operator: "empty", value: "" },
    { variable: "skipped", operator: "empty", value: false },
    { variable: "skipped", operator: "empty", value: 0 },
    { variable: "skipped", operator: "empty", value: null },
    { variable: "skipped", operator: "empty", value: [] },
    { variable: "skipped", operator: "notEmpty", compareTo: null },
    { variable: "skipped", operator: "notEmpty", compareTo: { variable: "other" } },
    { variable: "skipped", operator: "empty", regexFlags: "" },
    { variable: "skipped", operator: "empty", regexFlags: "i" },
  ])("rejects malformed emptiness leaf %# in a branch skipped at runtime", (invalid) => {
    const getter = jest.fn(() => "ready");
    const errors = runVariableChecks(
      [
        {
          or: [{ variable: "ready", operator: "notEmpty" }, invalid],
        },
      ] as VariableCheck[],
      getter,
    );

    expect(errors[0]).toEqual(expect.objectContaining({ expected: "valid checks" }));
    expect(getter).not.toHaveBeenCalled();
  });

  it("accepts named leaves and groups without changing discovered references", () => {
    expect(
      getCheckReferences(
        [
          {
            key: "limits",
            description: "Configured limits are ordered",
            and: [
              {
                key: "minimum",
                description: "Minimum exists",
                variable: "settings",
                path: "min",
                operator: "exists",
              },
              { variable: "settings", path: "max", operator: "exists" },
            ],
          },
          { variable: "fallback", operator: "notNull" },
        ],
        undefined,
      ),
    ).toEqual([
      { variable: "settings", path: "min" },
      { variable: "settings", path: "max" },
      { variable: "fallback" },
    ]);
  });

  it("requires unique nonempty keys only among siblings", () => {
    expect(() =>
      getCheckReferences([
        { key: "same", variable: "settings", operator: "exists" },
        { key: "same", variable: "fallback", operator: "exists" },
      ]),
    ).toThrow('Duplicate sibling check key "same"');
    expect(() =>
      getCheckReferences([
        {
          key: "same",
          and: [{ key: "same", variable: "settings", operator: "exists" }],
        },
        { variable: "fallback", operator: "exists" },
      ]),
    ).not.toThrow();
    expect(() =>
      getCheckReferences([{ key: "", variable: "settings", operator: "exists" }]),
    ).toThrow("Check keys must be nonempty strings");
  });

  it("short circuits groups but never turns a reached resolution error into success", () => {
    const getter = jest.fn((reference: { variable: string }) => {
      if (reference.variable === "broken") throw new Error("resolution failed");
      return 12;
    });

    expect(
      runVariableChecks(
        [
          {
            or: [
              { variable: "limit", operator: "equals", value: 12 },
              { variable: "broken", operator: "isNull" },
            ],
          },
        ],
        getter,
      ),
    ).toEqual([]);
    expect(getter).toHaveBeenCalledTimes(1);

    const errors = runVariableChecks(
      [
        {
          or: [
            { variable: "broken", operator: "isNull" },
            { variable: "limit", operator: "equals", value: 12 },
          ],
        },
        { variable: "limit", operator: "equals", value: 13 },
      ],
      getter,
    );

    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual(
      expect.objectContaining({
        type: "check",
        expected: "successful comparison",
        actual: "Error: resolution failed",
        details: expect.objectContaining({
          checkIndex: 0,
          evaluated: [
            expect.objectContaining({
              path: [0, "or", 0],
              reference: {
                variable: "broken",
                feature: undefined,
                path: undefined,
              },
              operator: "isNull",
              actual: "<unresolved>",
              expected: undefined,
            }),
          ],
        }),
      }),
    );
    expect(errors[1]).toEqual(
      expect.objectContaining({
        type: "check",
        expected: true,
        actual: false,
        details: expect.objectContaining({ checkIndex: 1 }),
      }),
    );
  });

  it("dispatches only own logical groups and rejects sparse arrays upfront", () => {
    const inheritedGroup = Object.assign(
      Object.create({
        or: [{ variable: "limit", operator: "equals", value: 12 }],
      }),
      { variable: "limit", operator: "equals", value: 13 },
    ) as VariableCheck;
    const getter = jest.fn(() => 12);

    expect(runVariableChecks([inheritedGroup], getter)).toEqual([
      expect.objectContaining({ expected: true, actual: false }),
    ]);
    expect(getter).toHaveBeenCalledTimes(1);

    const sparseChecks = new Array(1) as VariableCheck[];
    expect(() => getCheckReferences(sparseChecks)).toThrow("cannot be sparse arrays");
    expect(runVariableChecks(sparseChecks, getter)).toEqual([
      expect.objectContaining({
        expected: "valid checks",
        message: expect.stringContaining("cannot be sparse arrays"),
      }),
    ]);
  });

  it("retains the resolved left trace when the normalized comparison reference fails", () => {
    const getter = jest
      .fn()
      .mockReturnValueOnce({ min: 2, max: 10 })
      .mockImplementationOnce(() => {
        throw new Error("right resolution failed");
      });

    const errors = runVariableChecks(
      [
        {
          path: "min",
          operator: "lessThan",
          compareTo: { path: "max" },
        },
      ],
      getter,
      "settings",
    );

    expect(getter).toHaveBeenNthCalledWith(1, {
      feature: undefined,
      variable: "settings",
    });
    expect(getter).toHaveBeenNthCalledWith(2, {
      feature: undefined,
      variable: "settings",
    });
    expect(errors).toEqual([
      expect.objectContaining({
        expected: "successful comparison",
        actual: "Error: right resolution failed",
        details: expect.objectContaining({
          evaluated: [
            expect.objectContaining({
              path: [0],
              reference: {
                variable: "settings",
                feature: undefined,
                path: "min",
              },
              actual: 2,
              compareTo: { variable: "settings", path: "max" },
              expected: "<unresolved>",
            }),
          ],
        }),
      }),
    ]);
  });

  it("reports resolved references, values, group paths, and child indexes", () => {
    const errors = runVariableChecks(
      [
        {
          and: [
            {
              variable: "left",
              path: ["nested", "dot.key"],
              operator: "greaterThan",
              compareTo: { variable: "right" },
            },
          ],
        },
      ],
      ({ variable }) => (variable === "left" ? { nested: { "dot.key": 2 } } : 3),
      undefined,
      4,
    );

    expect(errors).toEqual([
      expect.objectContaining({
        type: "check",
        expected: true,
        actual: false,
        details: {
          checkIndex: 0,
          childIndex: 4,
          evaluated: [
            expect.objectContaining({
              path: [0, "and", 0],
              reference: {
                variable: "left",
                feature: undefined,
                path: ["nested", "dot.key"],
              },
              operator: "greaterThan",
              actual: 2,
              compareTo: { variable: "right" },
              expected: 3,
            }),
          ],
        },
      }),
    ]);
  });

  it("reports top level and evaluated leaf metadata on failures", () => {
    const errors = runVariableChecks(
      [
        {
          key: "ordered-limits",
          description: "Minimum remains below maximum",
          and: [
            {
              key: "minimum",
              description: "Minimum is below the threshold",
              variable: "limit",
              operator: "lessThan",
              value: 10,
            },
          ],
        },
      ],
      () => 12,
    );

    expect(errors[0].details).toEqual(
      expect.objectContaining({
        checkKey: "ordered-limits",
        checkDescription: "Minimum remains below maximum",
        evaluated: [
          expect.objectContaining({
            key: "minimum",
            description: "Minimum is below the threshold",
            path: [0, "and", 0],
          }),
        ],
      }),
    );
  });

  describe("feature checks", () => {
    it("offers typed feature expectations without changing existing variable check calls", () => {
      const accept = (check: VariableCheck) => check;
      expect(accept({ feature: "checkout", enabled: true })).toEqual({
        feature: "checkout",
        enabled: true,
      });
      accept({ feature: "checkout", variation: null });
      accept({ feature: "checkout", enabled: false, variation: "control" });
      accept({ feature: "checkout", variable: "limit", operator: "equals", value: 5 });
      accept({ operator: "equals", value: 2 });
      accept({ variable: "label", operator: "empty" });
      accept({ variable: "items", operator: "notEmpty" });
      // @ts-expect-error Emptiness checks do not accept a comparison value.
      accept({ variable: "label", operator: "empty", value: "" });
      // @ts-expect-error Emptiness checks do not accept a comparison reference.
      accept({ variable: "label", operator: "notEmpty", compareTo: { variable: "items" } });
      // @ts-expect-error A feature check must declare an expectation.
      accept({ feature: "checkout" });
      // @ts-expect-error Flags require boolean expectations.
      accept({ feature: "checkout", enabled: "true" });
      // @ts-expect-error Variations are strings or null, not numeric values.
      accept({ feature: "checkout", variation: 2 });
      // @ts-expect-error Feature expectations cannot be mixed with variable operands.
      accept({ feature: "checkout", variable: "limit", enabled: true });
      // @ts-expect-error Feature expectations cannot be mixed with comparison operators.
      accept({ feature: "checkout", enabled: true, operator: "equals", value: true });
    });

    it("calls only explicitly requested getters and never the variable resolver", () => {
      const variable = jest.fn();
      const feature = jest.fn((_key, property) => (property === "enabled" ? false : "control"));
      expect(
        runVariableChecks(
          [{ feature: "checkout", variation: "control" }],
          variable,
          "settings",
          undefined,
          feature,
        ),
      ).toEqual([]);
      expect(feature.mock.calls).toEqual([["checkout", "variation"]]);
      expect(variable).not.toHaveBeenCalled();
    });

    it("evaluates both properties and reports both mismatches", () => {
      const feature = jest.fn((_key, property) => (property === "enabled" ? false : "control"));
      const errors = runVariableChecks(
        [{ feature: "checkout", enabled: true, variation: "treatment" }],
        jest.fn(),
        undefined,
        2,
        feature,
      );
      expect(feature.mock.calls).toEqual([
        ["checkout", "enabled"],
        ["checkout", "variation"],
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0].details).toMatchObject({
        childIndex: 2,
        checkIndex: 0,
        evaluated: [
          {
            reference: { feature: "checkout" },
            property: "enabled",
            expected: true,
            actual: false,
          },
          {
            reference: { feature: "checkout" },
            property: "variation",
            expected: "treatment",
            actual: "control",
          },
        ],
      });
    });

    it("does not hide a variation error after a flag mismatch under NOT", () => {
      const errors = runVariableChecks(
        [{ not: [{ feature: "checkout", enabled: true, variation: "control" }] }],
        jest.fn(),
        undefined,
        undefined,
        (_feature, property) => {
          if (property === "enabled") return false;
          throw new Error("variation failed");
        },
      );
      expect(errors).toHaveLength(1);
      expect(isComparisonError(errors[0])).toBe(true);
      expect(errors[0].actual).toContain("variation failed");
      expect(errors[0].details?.evaluated[1]).toMatchObject({
        property: "variation",
        actual: "<unresolved>",
      });
    });

    it("collects independent failures without caching feature getter results", () => {
      const feature = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
      const errors = runVariableChecks(
        [
          { feature: "checkout", enabled: true },
          { feature: "checkout", enabled: false },
        ],
        jest.fn(),
        undefined,
        undefined,
        feature,
      );
      expect(errors).toHaveLength(2);
      expect(feature).toHaveBeenCalledTimes(2);
    });

    it("collects feature references alongside implicit owner variable references", () => {
      expect(
        getCheckReferences(
          [
            {
              and: [
                { feature: "checkout", enabled: true },
                { path: "min", operator: "equals", value: 2 },
              ],
            },
          ],
          "settings",
        ),
      ).toEqual([{ feature: "checkout" }, { path: "min" }]);
    });

    it.each([
      { feature: "checkout", enabled: undefined },
      { feature: "checkout", variation: undefined },
      { feature: "checkout", enabled: true, variation: undefined },
      Object.assign(Object.create({ feature: "checkout" }), { enabled: true }),
    ])("rejects non JSON feature expectations %# before resolving", (check) => {
      const feature = jest.fn();
      const errors = runVariableChecks([check as any], jest.fn(), undefined, undefined, feature);
      expect(errors[0].expected).toBe("valid checks");
      expect(feature).not.toHaveBeenCalled();
    });
  });

  describe("shared conformance fixture", () => {
    expect(fixture.version).toBe(3);
    expect(fixture.description).toContain("fresh instance");
    expect(fixture.cases).toHaveLength(255);

    it.each(fixture.cases)("$name", async (testCase) => {
      const sdkErrors: string[] = [];
      const f = createFeaturevisor({ datafile: fixture.datafile, logLevel: "fatal" });
      f.on("error", (event) => {
        sdkErrors.push(event.diagnostic?.message || "SDK evaluation error");
      });

      try {
        const errors = runVariableChecks(
          testCase.checks,
          (reference) => {
            const feature = reference.feature
              ? fixture.datafile.features[reference.feature]
              : undefined;
            if (reference.feature && !feature) {
              throw new Error(`Feature "${reference.feature}" is absent from the datafile`);
            }
            if (
              reference.feature &&
              !Object.prototype.hasOwnProperty.call(
                feature?.variablesSchema || {},
                reference.variable,
              )
            ) {
              throw new Error(
                `Feature variable "${reference.feature}.${reference.variable}" is absent from the datafile`,
              );
            }
            if (
              !reference.feature &&
              !Object.prototype.hasOwnProperty.call(
                fixture.datafile.variables || {},
                reference.variable,
              )
            ) {
              throw new Error(
                `Global variable "${reference.variable}" is absent from the datafile`,
              );
            }

            const errorCount = sdkErrors.length;
            const value = reference.feature
              ? f.getVariable(reference.feature, reference.variable)
              : f.getVariable(reference.variable);
            if (sdkErrors.length !== errorCount) {
              throw new Error(sdkErrors.slice(errorCount).join("; "));
            }
            return value;
          },
          testCase.owner,
          undefined,
          (feature, property) => {
            if (!Object.prototype.hasOwnProperty.call(fixture.datafile.features, feature))
              throw new Error(`Feature "${feature}" is absent from the datafile`);
            const errorCount = sdkErrors.length;
            const value = property === "enabled" ? f.isEnabled(feature) : f.getVariation(feature);
            if (sdkErrors.length !== errorCount)
              throw new Error(sdkErrors.slice(errorCount).join("; "));
            return value;
          },
        );

        expect(errors.length === 0).toBe(testCase.passed);
        expect(errors.some(isComparisonError)).toBe(testCase.error === true);
      } finally {
        await f.close();
      }
    });
  });
});
