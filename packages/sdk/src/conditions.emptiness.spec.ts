import type { Context, Operator } from "@featurevisor/types";
import { allConditionsAreMatched, valueIsMatched } from "./conditions";

const values: Array<[string, unknown, boolean, boolean]> = [
  ["empty string", "", true, false],
  ["whitespace is content", " \t\n", false, true],
  ["ordinary string", "hello", false, true],
  ["empty array", [], true, false],
  ["null array item", [null], false, true],
  ["empty nested array", [[]], false, true],
  ["sparse array slots", new Array(2), false, true],
  ["empty object", {}, true, false],
  ["null property", { value: null }, false, true],
  ["empty nested object", { value: {} }, false, true],
  ["own numeric property", { 0: false }, false, true],
  ["inherited properties do not count", Object.create({ inherited: true }), true, false],
  ["null prototype object", Object.create(null), true, false],
  ["null prototype own property", Object.assign(Object.create(null), { x: null }), false, true],
  [
    "nonenumerable properties do not count",
    Object.defineProperty({}, "hidden", { value: 1 }),
    true,
    false,
  ],
  ["symbol properties do not count", { [Symbol("hidden")]: 1 }, true, false],
  ["null", null, false, false],
  ["missing", undefined, false, false],
  ["zero", 0, false, false],
  ["nonzero number", 12, false, false],
  ["false", false, false, false],
  ["true", true, false, false],
  ["date", new Date("2026-01-01T00:00:00Z"), false, false],
  ["map", new Map(), false, false],
  ["set", new Set(), false, false],
  ["function", () => {}, false, false],
];

describe("empty and notEmpty operators", () => {
  test.each(values)("%s", (_name, value, empty, notEmpty) => {
    const getRegex = jest.fn();
    expect(valueIsMatched(value, { operator: "empty" }, getRegex)).toBe(empty);
    expect(valueIsMatched(value, { operator: "notEmpty" }, getRegex)).toBe(notEmpty);
    expect(getRegex).not.toHaveBeenCalled();
    for (const [operator, expected] of [
      ["empty", empty],
      ["notEmpty", notEmpty],
    ] as const) {
      expect(
        allConditionsAreMatched({ attribute: "nested.value", operator }, {
          nested: { value },
        } as Context),
      ).toBe(expected);
    }
  });

  test("does not read property values or mutate objects", () => {
    const getter = jest.fn(() => {
      throw new Error("Do not read values");
    });
    const value = Object.freeze(Object.defineProperty({}, "x", { enumerable: true, get: getter }));
    expect(valueIsMatched(value, { operator: "notEmpty" }, jest.fn())).toBe(true);
    expect(getter).not.toHaveBeenCalled();
    expect(Object.keys(value)).toEqual(["x"]);
  });

  test.each([null, undefined])("notEmpty is not the negation of empty for %p", (value) => {
    const context = { value };
    expect(allConditionsAreMatched({ attribute: "value", operator: "notEmpty" }, context)).toBe(
      false,
    );
    expect(
      allConditionsAreMatched({ not: [{ attribute: "value", operator: "empty" }] }, context),
    ).toBe(true);
  });

  test.each(["empty", "notEmpty"] as Operator[])("short circuits groups using %s", (operator) => {
    const getRegex = jest.fn(() => {
      throw new Error("Skipped branch");
    });
    const context = { value: operator === "empty" ? "" : "content" };
    expect(
      allConditionsAreMatched(
        {
          or: [
            { attribute: "value", operator },
            { attribute: "value", operator: "matches", value: "[" },
          ],
        },
        context,
        getRegex,
      ),
    ).toBe(true);
    expect(getRegex).not.toHaveBeenCalled();
  });
});
