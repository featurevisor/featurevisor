import type { ParsedFeature, ParsedVariable } from "@featurevisor/types";
import { createCompositionWarningInspector } from "./compositionWarnings";

const features = {
  experiment: {
    variations: [{ value: "control" }, { value: "treatment" }],
    variablesSchema: { policy: { type: "object", defaultValue: { limit: 10 } } },
  },
  flag: {
    variablesSchema: { label: { type: "string", defaultValue: "Label", disabledValue: "Off" } },
  },
} as unknown as Record<string, ParsedFeature>;
function inputs() {
  return {
    policy: { type: "object", defaultValue: { limit: 10 } },
    gated: { type: "object", defaultValue: { limit: 10 }, conditions: { feature: "flag" } },
    list: {
      type: "array",
      items: { type: "string" },
      defaultValue: [],
      conditions: { feature: "flag" },
    },
    json: { type: "json", defaultValue: " null " },
    nested: {
      compose: {
        treatment: { feature: "experiment", variation: true },
        policy: { variable: "gated" },
      },
    },
  } as Record<string, ParsedVariable>;
}
const compose = {
  assignment: { feature: "experiment", variation: true as const },
  experimentPolicy: { feature: "experiment", variable: "policy" },
  enabled: { feature: "experiment" },
  policy: { variable: "policy" },
  gated: { variable: "gated" },
  list: { variable: "list" },
  json: { variable: "json" },
  nested: { variable: "nested" },
  label: { feature: "flag", variable: "label" },
};
function inspect(overrides: unknown, variables = inputs()) {
  return createCompositionWarningInspector(
    features,
    variables,
    {},
  )({ compose, overrides } as ParsedVariable);
}
function mutate(mutate: unknown, extra = {}) {
  return inspect([{ key: "change", conditions: "*", mutate, ...extra }]);
}
const experimentCode = "composition_experiment_override";
const nullableCode = "composition_nullable_mutation";

describe("composition override advisory warnings", () => {
  it("distinguishes an alias's own successful gate from nullable gated source reads", () => {
    const variables = inputs();
    variables.alias = {
      description: "Gated alias",
      compose: "policy",
      conditions: { feature: "flag" },
      overrides: [{ key: "change", conditions: "*", mutate: { limit: 90 } }],
    };
    let getWarnings = createCompositionWarningInspector(features, variables, {});
    expect(getWarnings(variables.alias)).toEqual([]);
    const parent = {
      compose: { policy: { variable: "alias" } },
      overrides: [{ key: "change", conditions: "*", mutate: { "policy.limit": 90 } }],
    } as ParsedVariable;
    expect(getWarnings(parent)).toEqual([expect.objectContaining({ code: nullableCode })]);
    variables.alias = { ...variables.alias, disabledValue: { limit: 0 } };
    getWarnings = createCompositionWarningInspector(features, variables, {});
    expect(getWarnings(parent)).toEqual([]);
  });
  it("ignores ordinary variables, plain composition and unrelated members", () => {
    const getWarnings = createCompositionWarningInspector(features, inputs(), {});
    expect(getWarnings(inputs().policy)).toEqual([]);
    expect(getWarnings({ compose })).toEqual([]);
    expect(mutate({ "policy.limit": 90, label: "Updated", enabled: false })).toEqual([]);
  });
  it.each(["assignment", "experimentPolicy", "experimentPolicy.limit", "nested.treatment"])(
    "warns for changing the experimental source at %s",
    (path) => {
      const warnings = mutate({ [path]: "control" });
      expect(warnings.filter((warning) => warning.code === experimentCode)).toEqual([
        expect.objectContaining({
          path: ["overrides", 0, "mutate", path],
          message: expect.stringContaining('experiment "experiment"'),
        }),
      ]);
    },
  );
  it("warns once per mutation or whole replacement, not once per experiment alias", () => {
    expect(inspect([{ key: "replace", conditions: "*", value: {} }])).toEqual([
      expect.objectContaining({ code: experimentCode, path: ["overrides", 0, "value"] }),
    ]);
    expect(mutate({ nested: {} })).toEqual([
      expect.objectContaining({ code: experimentCode, path: ["overrides", 0, "mutate", "nested"] }),
    ]);
  });
  it.each(["gated.limit", "nested.policy.limit", "json.limit"])(
    "warns when a mutation traverses the nullable definition at %s",
    (path) =>
      expect(mutate({ [path]: 90 })).toEqual([
        expect.objectContaining({ code: nullableCode, path: ["overrides", 0, "mutate", path] }),
      ]),
  );
  it("does not warn about nullable members that are replaced instead of traversed", () => {
    expect(mutate({ gated: { limit: 90 }, json: {} })).toEqual([]);
  });
  it.each(["append", "prepend", "appendUnique"])(
    "does not warn for %s creating a nullable final member as an array",
    (operation) => expect(mutate({ [`list:${operation}`]: "card" })).toEqual([]),
  );
  it("warns when removeValue skips a nullable final member", () => {
    expect(mutate({ "list:removeValue": "card" })).toEqual([
      expect.objectContaining({ code: nullableCode }),
    ]);
  });
  it.each([{ disabledValue: { limit: 0 } }, { useDefaultWhenDisabled: true }])(
    "does not warn after a nonnull authored fallback %j",
    (fallback) => {
      const variables = inputs();
      variables.gated = { ...variables.gated, ...fallback } as ParsedVariable;
      expect(
        inspect([{ key: "change", conditions: "*", mutate: { "gated.limit": 90 } }], variables),
      ).toEqual([]);
    },
  );
  it("recognizes variable prerequisites and literal null overrides on JSON sources", () => {
    const variables = inputs();
    variables.gated = {
      type: "object",
      defaultValue: {},
      conditions: { variable: "policy", operator: "notNull" },
    };
    variables.json = {
      type: "json",
      defaultValue: "{}",
      overrides: [{ key: "null", conditions: "*", value: "null" }],
    };
    expect(
      inspect(
        [{ key: "change", conditions: "*", mutate: { "gated.limit": 90, "json.limit": 90 } }],
        variables,
      ).map((warning) => warning.code),
    ).toEqual([nullableCode, nullableCode]);
  });
  it("warns about disabled feature variables, but not ordinary feature variables with fallbacks", () => {
    expect(mutate({ "experimentPolicy.limit": 90 }).map((warning) => warning.code)).toEqual([
      experimentCode,
      nullableCode,
    ]);
  });
  it.each([
    { variable: "gated", operator: "notNull" },
    [{ variable: "gated", operator: "notNull" }],
    { and: [{ variable: "gated", operator: "notNull" }] },
    {
      or: [
        { variable: "gated", operator: "notNull" },
        { and: [{ variable: "gated", operator: "notNull" }] },
      ],
    },
    { variable: "gated", operator: "notNull", path: [] },
    { variable: "gated", operator: "notNull", path: "limit" },
    { variable: "gated", operator: "notNull", path: ["limit"] },
    { variable: "gated", operator: "exists", path: "limit" },
    { variable: "gated", operator: "exists", path: ["limit"] },
    { not: [{ variable: "gated", operator: "isNull" }] },
    { not: [{ variable: "gated", operator: "isNull", path: [] }] },
    {
      or: [
        { variable: "gated", path: "limit", operator: "exists" },
        { not: [{ variable: "gated", operator: "isNull" }] },
      ],
    },
  ])("recognizes a nonnull source guard %j", (requiredVariables) => {
    expect(mutate({ "gated.limit": 90 }, { conditions: requiredVariables })).toEqual([]);
  });
  it.each([
    { variable: "gated", operator: "exists" },
    { variable: "gated", operator: "exists", path: [] },
    { variable: "policy", operator: "exists", path: "limit" },
    { variable: "policy", operator: "notNull" },
    { feature: "flag", variable: "gated", operator: "notNull" },
    {
      or: [
        { variable: "gated", operator: "notNull" },
        { variable: "policy", operator: "notNull" },
      ],
    },
    { not: [{ variable: "gated", operator: "isNull", path: "limit" }] },
    { not: [{ variable: "policy", operator: "isNull" }] },
    {
      not: [
        { variable: "gated", operator: "isNull" },
        { variable: "policy", operator: "isNull" },
      ],
    },
    { not: [{ and: [{ variable: "gated", operator: "isNull" }] }] },
  ])("does not assume this requirement guards the source %j", (requiredVariables) => {
    expect(mutate({ "gated.limit": 90 }, { conditions: requiredVariables })).toEqual([
      expect.objectContaining({ code: nullableCode }),
    ]);
  });
  it("inherits parent guards and retains exact nested environment and ordered entry paths", () => {
    const overrides = {
      production: [
        {
          key: "parent",
          conditions: [{ variable: "gated", operator: "notNull" }],
          value: {},
          overrides: [
            {
              key: "child",
              conditions: "*",
              mutate: [
                { "gated.limit": 90 },
                { assignment: "control" },
                { assignment: "treatment" },
              ],
            },
          ],
        },
      ],
    };
    expect(inspect(overrides).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: experimentCode, path: ["overrides", "production", 0, "value"] },
      {
        code: experimentCode,
        path: ["overrides", "production", 0, "overrides", 0, "mutate", 1, "assignment"],
      },
      {
        code: experimentCode,
        path: ["overrides", "production", 0, "overrides", 0, "mutate", 2, "assignment"],
      },
    ]);
  });
  it("requires the feature identity to match when guarding a feature variable", () => {
    expect(
      mutate(
        { "experimentPolicy.limit": 90 },
        { conditions: { feature: "experiment", variable: "policy", operator: "notNull" } },
      ).map((warning) => warning.code),
    ).toEqual([experimentCode]);
  });
  it.each([
    { feature: "experiment", variable: "policy", operator: "exists", path: "limit" },
    { feature: "experiment", variable: "policy", operator: "notNull", path: ["limit"] },
    { not: [{ feature: "experiment", variable: "policy", operator: "isNull" }] },
  ])("inherits a nonnull feature source guard %j", (requiredVariables) => {
    const warnings = inspect([
      {
        key: "parent",
        conditions: requiredVariables,
        mutate: {},
        overrides: [{ key: "child", conditions: "*", mutate: { "experimentPolicy.limit": 90 } }],
      },
    ]);
    expect(warnings.map((warning) => warning.code)).toEqual([experimentCode]);
  });
  it.each(["variations", "rules", "force"] as const)(
    "recognizes a JSON null assignment from feature %s despite nonnull defaults and fallbacks",
    (kind) => {
      const feature = {
        variablesSchema: {
          config: { type: "json", defaultValue: "{}", useDefaultWhenDisabled: true },
        },
        [kind]: [{ variables: { config: " null " } }],
      } as unknown as ParsedFeature;
      const warnings = createCompositionWarningInspector(
        { probe: feature },
        {},
        {},
      )({
        compose: { config: { feature: "probe", variable: "config" } },
        overrides: [{ key: "change", conditions: "*", mutate: { "config.limit": 90 } }],
      });
      expect(warnings.some((warning) => warning.code === nullableCode)).toBe(true);
    },
  );
  it("recognizes JSON null literals in a feature variable override", () => {
    const feature = {
      variablesSchema: { config: { type: "json", defaultValue: "{}", disabledValue: "{}" } },
      rules: {
        production: [{ variableOverrides: { config: [{ conditions: "*", value: "null" }] } }],
      },
    } as unknown as ParsedFeature;
    expect(
      createCompositionWarningInspector(
        { probe: feature },
        {},
        {},
      )({
        compose: { config: { feature: "probe", variable: "config" } },
        overrides: [{ key: "change", conditions: "*", mutate: { "config.limit": 90 } }],
      }),
    ).toEqual([expect.objectContaining({ code: nullableCode })]);
  });
  it("preserves inputs and does not expand a shared composition diamond into all paths", () => {
    const variables = inputs();
    let previous = "nested";
    for (let i = 0; i < 30; i++) {
      const key = `level${i}`;
      variables[key] = { compose: { left: { variable: previous }, right: { variable: previous } } };
      previous = key;
    }
    const snapshot = JSON.stringify(variables);
    const getWarnings = createCompositionWarningInspector(features, variables, {});
    const variable = {
      compose: { view: { variable: previous } },
      overrides: [{ key: "all", conditions: "*", value: {} }],
    } as ParsedVariable;
    expect(getWarnings(variable)).toHaveLength(1);
    expect(getWarnings(variable)).toHaveLength(1);
    expect(JSON.stringify(variables)).toBe(snapshot);
  });
});
