import { allConditionsAreMatched } from "./conditions";
import type { Context, PlainCondition } from "@featurevisor/types";

describe("portable presence and null operators", () => {
  test.each([
    ["absent", {}, false, false, false],
    ["undefined", { value: undefined }, false, false, false],
    ["null", { value: null }, true, true, false],
    ["false", { value: false }, true, false, true],
    ["zero", { value: 0 }, true, false, true],
    ["empty string", { value: "" }, true, false, true],
    ["empty array", { value: [] }, true, false, true],
    ["empty object", { value: {} }, true, false, true],
    ["string", { value: "present" }, true, false, true],
  ] as [string, Context, boolean, boolean, boolean][])(
    "%s has independent presence and nullness",
    (_, context, exists, isNull, notNull) => {
      for (const [operator, expected] of [
        ["exists", exists],
        ["notExists", !exists],
        ["isNull", isNull],
        ["notNull", notNull],
      ] as [PlainCondition["operator"], boolean][]) {
        expect(allConditionsAreMatched({ attribute: "value", operator }, context)).toBe(expected);
      }
    },
  );

  test("missing nested values satisfy neither null operator", () => {
    for (const context of [{}, { value: {} }, { value: null }]) {
      expect(
        allConditionsAreMatched({ attribute: "value.missing", operator: "isNull" }, context),
      ).toBe(false);
      expect(
        allConditionsAreMatched({ attribute: "value.missing", operator: "notNull" }, context),
      ).toBe(false);
    }
  });

  test("logical negation is not a presence test", () => {
    expect(allConditionsAreMatched({ not: [{ attribute: "value", operator: "isNull" }] }, {})).toBe(
      true,
    );
    expect(allConditionsAreMatched({ attribute: "value", operator: "notNull" }, {})).toBe(false);
  });
});
