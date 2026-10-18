import type { Condition, Context, DatafileContent } from "@featurevisor/types";
import { allConditionsAreMatched, allSegmentsAreMatched, valueIsMatched } from "./conditions";
import { createFeaturevisor } from "./instance";

const cases: Array<[string, unknown, unknown, boolean, boolean]> = [
  ["first match", ["owner", "member"], ["owner", "admin"], true, false],
  ["last match", ["member", "owner"], ["admin", "owner"], true, false],
  ["no match", ["member"], ["owner", "admin"], false, true],
  ["duplicates", ["owner", "owner"], ["owner", "owner"], true, false],
  ["empty actual", [], ["owner"], false, true],
  ["empty candidates", ["owner"], [], false, true],
  ["both empty", [], [], false, true],
  ["numeric equality", [1, 1.5, 0], [1.0], true, false],
  ["string is not a number", [1], ["1"], false, true],
  ["boolean is not a number", [true, false], [1, 0], false, true],
  ["null element", [null], [null], true, false],
  ["null is not text", [null], ["null"], false, true],
  ["case sensitive", ["Owner"], ["owner"], false, true],
  ["objects in context do not match", [{ role: "owner" }], ["owner"], false, true],
  ["mixed context", [{ role: "owner" }, "owner"], ["owner"], true, false],
  ["missing actual", undefined, ["owner"], false, false],
  ["null actual", null, ["owner"], false, false],
  ["string actual", "owner", ["owner"], false, false],
  ["number actual", 1, [1], false, false],
  ["boolean actual", true, [true], false, false],
  ["object actual", {}, ["owner"], false, false],
  ["missing candidates", ["owner"], undefined, false, false],
  ["null candidates", ["owner"], null, false, false],
  ["scalar candidates", ["owner"], "owner", false, false],
  ["object candidates", ["owner"], {}, false, false],
  ["nested array candidates", ["owner"], [["owner"]], false, false],
  ["invalid after a match", ["owner"], ["owner", {}], false, false],
  ["invalid before a match", ["owner"], [[], "owner"], false, false],
  ["sparse candidates", ["owner"], new Array(1), false, false],
  ["undefined candidate", [undefined], [undefined], false, false],
  ["function candidate", ["owner"], ["owner", () => "owner"], false, false],
  ["symbol candidate", ["owner"], ["owner", Symbol("owner")], false, false],
];

describe("includesAny and notIncludesAny", () => {
  test.each(["includes", "notIncludes"] as const)(
    "preserves scalar membership validation for %s",
    (operator) => {
      for (const value of [undefined, {}, [], new Date(0), () => "owner", Symbol("owner")])
        expect(valueIsMatched([value], { operator, value } as any, jest.fn())).toBe(false);
      expect(valueIsMatched([null], { operator, value: null }, jest.fn())).toBe(
        operator === "includes",
      );
      expect(valueIsMatched([], { operator, value: "owner" }, jest.fn())).toBe(
        operator === "notIncludes",
      );
    },
  );
  test.each(cases)("%s", (_name, actual, candidates, any, none) => {
    const getRegex = jest.fn();
    for (const [operator, expected] of [
      ["includesAny", any],
      ["notIncludesAny", none],
    ] as const) {
      const condition = {
        attribute: "account.permissions",
        operator,
        value: candidates,
      } as Condition;
      expect(valueIsMatched(actual, { operator, value: candidates } as any, getRegex)).toBe(
        expected,
      );
      const context = { account: { permissions: actual } } as Context;
      expect(allConditionsAreMatched(condition, context, getRegex)).toBe(expected);
      expect(allConditionsAreMatched({ and: [condition] }, context, getRegex)).toBe(expected);
      expect(allConditionsAreMatched({ not: [condition] }, context, getRegex)).toBe(!expected);
      expect(
        allSegmentsAreMatched(
          "permissions",
          context,
          () => ({ key: "permissions", conditions: condition }),
          getRegex,
        ),
      ).toBe(expected);
    }
    expect(getRegex).not.toHaveBeenCalled();
  });

  test("does not mutate frozen arrays", () => {
    const actual = Object.freeze(["member", "owner"]);
    const candidates = Object.freeze(["admin", "owner"]);
    expect(
      valueIsMatched(actual, { operator: "includesAny", value: candidates } as any, jest.fn()),
    ).toBe(true);
    expect(actual).toEqual(["member", "owner"]);
    expect(candidates).toEqual(["admin", "owner"]);
  });

  test.each(["includesAny", "notIncludesAny"] as const)(
    "short circuits groups with %s",
    (operator) => {
      const getRegex = jest.fn(() => {
        throw new Error("Skipped branch");
      });
      const condition = {
        attribute: "roles",
        operator,
        value: operator === "includesAny" ? ["owner"] : ["admin"],
      };
      expect(
        allConditionsAreMatched(
          { or: [condition, { attribute: "userId", operator: "matches", value: "[" }] },
          { roles: ["owner"], userId: "123" },
          getRegex,
        ),
      ).toBe(true);
      expect(getRegex).not.toHaveBeenCalled();
    },
  );

  test.each(["includesAny", "notIncludesAny"] as const)(
    "evaluates feature and global variable prerequisites with %s",
    (operator) => {
      const required = { variable: "source", operator, value: ["owner"] };
      const datafile = {
        schemaVersion: "2",
        revision: "membership",
        segments: {},
        features: {
          gated: {
            bucketBy: ["userId"],
            conditions: [required],
            traffic: [{ key: "all", segments: "*", percentage: 100000 }],
          },
          featureOverride: {
            bucketBy: ["userId"],
            variablesSchema: { message: { type: "string", defaultValue: "default" } },
            traffic: [
              {
                key: "all",
                segments: "*",
                percentage: 100000,
                variableOverrides: {
                  message: [{ key: "permission", conditions: [required], value: "matched" }],
                },
              },
            ],
          },
        },
        variables: {
          source: { type: "array", defaultValue: ["owner"] },
          gated: {
            type: "string",
            defaultValue: "matched",
            disabledValue: "disabled",
            conditions: [required],
          },
          variableOverride: {
            type: "string",
            defaultValue: "default",
            overrides: [{ key: "permission", conditions: [required], value: "matched" }],
          },
        },
      } as DatafileContent;
      const f = createFeaturevisor({ datafile, logLevel: "fatal" });
      try {
        for (const actual of [["owner"], ["member"], [], null]) {
          f.setStickyVariables({ source: actual });
          const matched =
            actual !== null &&
            (operator === "includesAny"
              ? actual.indexOf("owner") !== -1
              : actual.indexOf("owner") === -1);
          expect(f.isEnabled("gated")).toBe(matched);
          expect(f.getVariable("gated")).toBe(matched ? "matched" : "disabled");
          expect(f.getVariable("variableOverride")).toBe(matched ? "matched" : "default");
          expect(f.getVariable("featureOverride", "message")).toBe(matched ? "matched" : "default");
          const child = f.spawn({ userId: "child" }, { stickyVariables: { source: actual } });
          try {
            expect(child.isEnabled("gated")).toBe(matched);
            expect(child.getVariable("gated")).toBe(matched ? "matched" : "disabled");
          } finally {
            child.close();
          }
        }
      } finally {
        f.close();
      }
    },
  );
});
