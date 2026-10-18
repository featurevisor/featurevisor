import {
  findDisallowedAuthoredOperators,
  findDisallowedCheckOperators,
} from "./comparisonOperators";

describe("authored operator policy", () => {
  it("checks resolved matrix operators in assertions, scenarios and their children", () => {
    const scenario = {
      matrix: { operation: ["exists", "notNull"] },
      checks: [{ variable: "config", operator: "${{ operation }}" }],
      children: [{ checks: [{ variable: "config", operator: "${{ operation }}" }] }],
    };
    expect(findDisallowedCheckOperators(scenario, ["notNull"]).map(({ path }) => path)).toEqual([
      ["checks", 0, "operator"],
      ["children", 0, "checks", 0, "operator"],
    ]);
    expect(
      findDisallowedCheckOperators({ assertions: [scenario] }, ["notNull"]).map(({ path }) => path),
    ).toEqual([
      ["assertions", 0, "checks", 0, "operator"],
      ["assertions", 0, "children", 0, "checks", 0, "operator"],
    ]);
  });
  it("finds nested selectors with precise paths but ignores mutations and literals", () => {
    const definition = {
      conditions: { and: [{ variable: "gate", operator: "equals", value: true }] },
      rules: {
        staging: [
          {
            variableOverrides: {
              message: [
                {
                  conditions: { attribute: "id", operator: "contains", value: "x" },
                  mutate: { operator: "equals" },
                },
              ],
            },
          },
        ],
      },
      force: { production: [{ conditions: { attribute: "id", operator: "equals", value: "x" } }] },
      overrides: {
        production: [
          {
            conditions: { variable: "gate", operator: "equals", value: true },
            value: { operator: "equals" },
          },
        ],
      },
      variableOverrides: {
        conditions: [{ conditions: "*", value: { operator: "equals" } }],
      },
      variablesSchema: { message: { defaultValue: { operator: "equals" } } },
    };
    expect(
      findDisallowedAuthoredOperators(definition, ["equals", "contains"]).map((issue) =>
        issue.path.join("."),
      ),
    ).toEqual([
      "conditions.and.0.operator",
      "rules.staging.0.variableOverrides.message.0.conditions.operator",
      "force.production.0.conditions.operator",
      "overrides.production.0.conditions.operator",
    ]);
  });
});
