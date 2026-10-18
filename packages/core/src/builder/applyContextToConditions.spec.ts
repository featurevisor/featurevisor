import type { Condition, Conditions, Context, DatafileContent } from "@featurevisor/types";
import { allConditionsAreMatched, createFeaturevisor } from "@featurevisor/sdk";
import {
  applyContextToCondition,
  applyContextToConditions,
  removeRedundantConditions,
} from "./applyContextToConditions";
import { applyContextToDatafile } from "./applyContextToDatafile";

const known: Condition = { attribute: "known", operator: "equals", value: true };
const unknown: Condition = { attribute: "unknown", operator: "equals", value: true };
const flag: Condition = { feature: "flag" };
const variable: Condition = { variable: "value", operator: "equals", value: true };
const datafile: DatafileContent = {
  schemaVersion: "4",
  revision: "conditions",
  segments: { audience: { conditions: unknown } },
  features: {},
};
const featurevisor = createFeaturevisor({ datafile, logLevel: "fatal" });

describe("three valued context specialization", () => {
  it("keeps every dependency leaf and unresolved attribute unchanged", () => {
    const input: Conditions = [flag, variable, "audience", unknown];
    expect(applyContextToConditions(featurevisor, input, { known: true })).toEqual(input);
    expect(applyContextToCondition).toBe(applyContextToConditions);
  });
  it("removes a true child of NOT but preserves the unknown expression", () => {
    expect(
      applyContextToConditions(
        featurevisor,
        { not: [known, flag, variable, "audience"] },
        { known: true },
      ),
    ).toEqual({ not: [flag, variable, "audience"] });
    expect(applyContextToConditions(featurevisor, { not: [known, flag] }, { known: false })).toBe(
      "*",
    );
    expect(applyContextToConditions(featurevisor, { not: [known] }, { known: true })).toEqual({
      or: [],
    });
    expect(
      applyContextToConditions(featurevisor, { not: [{ not: [known] }] }, { known: true }),
    ).toBe("*");
  });
  it.each([[], { and: [] }, { or: [] }, { not: [] }])(
    "keeps empty expressions false: %j",
    (expression) => {
      const result = applyContextToConditions(featurevisor, expression as Conditions, {});
      expect(result).toEqual({ or: [] });
      expect(allConditionsAreMatched(result, {})).toBe(false);
    },
  );
  it.each(["includesAny", "notIncludesAny"] as const)(
    "specializes %s using nested context",
    (operator) => {
      const input: Condition = {
        attribute: "account.permissions",
        operator,
        value: ["write", "admin"],
      };
      const context = {
        account: { permissions: operator === "includesAny" ? ["write"] : ["read"] },
      };
      expect(applyContextToConditions(featurevisor, input, context)).toBe("*");
      expect(applyContextToConditions(featurevisor, input, { account: {} })).toEqual(input);
      expect(applyContextToConditions(featurevisor, { not: [input] }, context)).toEqual({ or: [] });
    },
  );
  it.each([
    [{ attribute: "label", operator: "empty" }, { label: "" }],
    [{ attribute: "items", operator: "notEmpty" }, { items: [null] }],
    [{ attribute: "metadata", operator: "empty" }, { metadata: {} }],
    [{ attribute: "nullable", operator: "isNull" }, { nullable: null }],
    [{ attribute: "missing", operator: "notExists" }, { missing: undefined }],
  ])("specializes present attribute paths: %j", (input, context) => {
    expect(applyContextToConditions(featurevisor, input as Condition, context as Context)).toBe(
      "*",
    );
  });
  it("does not infer absence from a partially supplied Target context", () => {
    const input: Condition = { attribute: "missing", operator: "notExists" };
    expect(applyContextToConditions(featurevisor, input, {})).toEqual(input);
  });
  it("simplifies constants without broadening unknown NOT branches", () => {
    expect(removeRedundantConditions({ not: ["*", flag] })).toEqual({ not: [flag] });
    expect(removeRedundantConditions({ or: [{ or: [] }, flag] })).toEqual({ or: [flag] });
    expect(removeRedundantConditions({ and: [{ or: [] }, flag] })).toEqual({ or: [] });
    expect(removeRedundantConditions({ not: ["*"] })).toEqual({ or: [] });
  });

  const orderCases = (["array", "and", "or", "not"] as const).flatMap((group) =>
    [false, true].flatMap((before) => [false, true].map((segment) => ({ group, before, segment }))),
  );
  it.each(orderCases)(
    "preserves callback order for $group, dependency first=$before, segment=$segment",
    ({ group, before, segment }) => {
      const dependencyValue = group !== "or";
      const decisive: Condition = { attribute: "known", operator: "equals", value: group === "or" };
      const entries: Condition[] = before
        ? [flag, variable, decisive, { feature: "skipped" }]
        : [decisive, flag, variable, { feature: "skipped" }];
      const expression: Conditions =
        group === "array"
          ? entries
          : group === "and"
            ? { and: entries }
            : group === "or"
              ? { or: entries }
              : { not: entries };
      const input: DatafileContent = {
        schemaVersion: "4",
        revision: "ordered",
        segments: segment ? { effectful: { conditions: expression } } : {},
        features: {
          root: {
            bucketBy: "id",
            conditions: segment ? "effectful" : expression,
            traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
          },
          flag: {
            bucketBy: "id",
            traffic: [{ key: "all", conditions: "*", percentage: dependencyValue ? 100000 : 0 }],
          },
          skipped: {
            bucketBy: "id",
            traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
          },
        },
        variables: { value: { type: "boolean", defaultValue: dependencyValue } },
      };
      const specialised = applyContextToDatafile(input, { known: true });
      const evaluate = (datafile: DatafileContent) => {
        const reads: string[] = [];
        const f = createFeaturevisor({
          datafile,
          logLevel: "fatal",
          modules: [
            {
              beforeEvaluation(options) {
                if (options.dependencyPurpose)
                  reads.push("featureKey" in options ? options.featureKey! : options.variableKey!);
                return options;
              },
            },
          ],
        });
        return { enabled: f.isEnabled("root", { known: true }), reads };
      };
      expect(evaluate(specialised)).toEqual(evaluate(input));
      expect(evaluate(specialised).reads).toEqual(before ? ["flag", "value"] : []);
      if (segment && before) {
        expect(specialised.features.root.conditions).toBe("effectful");
        expect(specialised.segments.effectful).toBeDefined();
      }
    },
  );

  const leaves: Condition[] = [known, unknown, flag, variable, "audience"];
  const rows = leaves.flatMap((left, a) =>
    leaves.flatMap((right, b) =>
      (["array", "and", "or", "not"] as const).map((group) => ({
        left,
        right,
        group,
        name: `${group} ${a},${b}`,
      })),
    ),
  );
  it.each(rows)("preserves runtime truth for $name", ({ left, right, group }) => {
    const original: Conditions =
      group === "array"
        ? [left, right]
        : group === "and"
          ? { and: [left, right] }
          : group === "or"
            ? { or: [left, right] }
            : { not: [left, right] };
    for (const knownValue of [false, true]) {
      const specialised = applyContextToConditions(featurevisor, original, { known: knownValue });
      for (const unknownValue of [false, true])
        for (const dependencyValue of [false, true]) {
          const context = { known: knownValue, unknown: unknownValue };
          const evaluate = (conditions: Conditions) =>
            createFeaturevisor({
              logLevel: "fatal",
              datafile: {
                ...datafile,
                features: {
                  root: {
                    bucketBy: "id",
                    conditions,
                    traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
                  },
                  flag: {
                    bucketBy: "id",
                    traffic: [
                      { key: "all", conditions: "*", percentage: dependencyValue ? 100000 : 0 },
                    ],
                  },
                },
                variables: { value: { type: "boolean", defaultValue: dependencyValue } },
              },
            }).isEnabled("root", context);
          expect(evaluate(specialised)).toBe(evaluate(original));
        }
    }
  });
});
