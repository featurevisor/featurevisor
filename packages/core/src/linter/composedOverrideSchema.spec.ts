import type { ParsedFeature, ParsedVariable, Schema } from "@featurevisor/types";
import type { ProjectConfig } from "../config";
import { getVariableZodSchema } from "./variableSchema";

const config = { tags: [], disallowOperators: [] } as unknown as ProjectConfig;
const schemas: Record<string, Schema> = {
  policy: {
    type: "object",
    required: ["limit", "methods"],
    properties: {
      limit: { type: "integer", minimum: 1 },
      methods: { type: "array", items: { type: "string", enum: ["card", "cash", "ideal"] } },
      note: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" }, label: { type: "string" } },
        },
      },
    },
  },
};
const features = {
  checkout: {
    variablesSchema: { policy: { schema: "policy", defaultValue: { limit: 5, methods: [] } } },
    variations: [{ value: "control" }],
    disabledVariationValue: "off",
  },
  flagOnly: { disabledVariationValue: "off" },
} as unknown as Record<string, ParsedFeature>;
const variables: Record<string, ParsedVariable> = {
  policy: { schema: "policy", defaultValue: { limit: 5, methods: [] } },
  raw: { type: "json", defaultValue: "{}" },
  union: {
    oneOf: [{ type: "string" }, { type: "object", properties: { enabled: { type: "boolean" } } }],
    defaultValue: "text",
  },
  nested: { compose: { source: { variable: "policy" } } },
  strings: { type: "array", defaultValue: [] },
  flat: { type: "object", defaultValue: {} },
  timestamp: { type: "string", format: "date-time", defaultValue: "2026-10-15T00:00:00Z" },
};
const compose = {
  flag: { feature: "checkout" },
  variation: { feature: "checkout", variation: true as const },
  emptyVariation: { feature: "flagOnly", variation: true as const },
  featurePolicy: { feature: "checkout", variable: "policy" },
  policy: { variable: "policy" },
  raw: { variable: "raw" },
  union: { variable: "union" },
  nested: { variable: "nested" },
  "literal.alias": { variable: "raw" },
  strings: { variable: "strings" },
  flat: { variable: "flat" },
  timestamp: { variable: "timestamp" },
};
const value = {
  flag: false,
  variation: "off",
  emptyVariation: null,
  featurePolicy: null,
  policy: { limit: 1, methods: ["card"] },
  raw: { decoded: true },
  union: { enabled: false },
  nested: { source: null },
  "literal.alias": [1, null],
  strings: ["a"],
  flat: { a: 1 },
  timestamp: "2026-10-15T01:00:00+01:00",
};
function check(overrides: unknown) {
  return getVariableZodSchema(config, {}, [], features, schemas, variables).safeParse({
    description: "Composed",
    compose,
    overrides,
  });
}
function mutation(mutate: unknown) {
  return check([{ key: "override", conditions: "*", mutate }]);
}
function errors(result: ReturnType<typeof check>) {
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Expected errors");
  return result.error.issues;
}

describe("composed override inferred shapes", () => {
  it("accepts an exact replacement with nullable getter members, decoded JSON and literal dotted keys", () => {
    expect(check([{ key: "replace", conditions: "*", value }]).success).toBe(true);
  });
  it.each([
    { ...value, flag: null },
    { ...value, flag: "false" },
    { ...value, variation: "invented" },
    { ...value, emptyVariation: "invented" },
    { ...value, policy: { limit: "1", methods: [] } },
    { ...value, policy: { limit: 0, methods: [] } },
    { ...value, nested: { source: { limit: 0, methods: [] } } },
    { ...value, union: 4 },
    { ...value, extra: true },
    { ...value, strings: [4] },
    { ...value, flat: { a: {} } },
    { ...value, timestamp: "not a date" },
    null,
    [],
    "text",
  ])("rejects incompatible complete replacements %#", (replacement) => {
    errors(check([{ key: "replace", conditions: "*", value: replacement }]));
  });
  it("rejects missing root or nested composition properties at their own paths", () => {
    const missing: Partial<typeof value> = { ...value };
    delete missing.flag;
    expect(
      errors(check([{ key: "replace", conditions: "*", value: missing }])).map(
        (issue) => issue.path,
      ),
    ).toEqual([["overrides", 0, "value", "flag"]]);
    expect(
      errors(check([{ key: "replace", conditions: "*", value: { ...value, nested: {} } }])).map(
        (issue) => issue.path,
      ),
    ).toEqual([["overrides", 0, "value", "nested", "source"]]);
  });
  it.each([
    { policy: null },
    { featurePolicy: null },
    { variation: null },
    { emptyVariation: null },
    { emptyVariation: "off" },
    { nested: null },
    { nested: { source: null } },
    { "nested.source": null },
    { raw: [true, null] },
    { "raw.anything[0].enabled": true },
    { "raw.anything:append": { decoded: true } },
    { "policy.limit": 2 },
    { "policy.note:remove": true },
    { "policy.methods:append": "ideal" },
    { "policy.methods:prepend": "cash" },
    { "policy.methods:appendUnique": "card" },
    { "policy.methods:removeValue": "card" },
    { "policy.methods[0]:before": "cash" },
    { "policy.methods[0]:after": "ideal" },
    { "policy.methods[0]:remove": true },
    { "policy.items[id=a].label": "A" },
    { "policy.items[id=a]:before": { id: "b" } },
    { union: "text" },
    { union: { enabled: true } },
    { "strings:append": "valid" },
    { "flat.key": null },
  ])("accepts compatible dynamic mutations %j", (mutate) => {
    expect(mutation(mutate)).toEqual(expect.objectContaining({ success: true }));
  });
  it.each([
    { flag: null },
    { variation: "invented" },
    { emptyVariation: "invented" },
    { "policy:remove": true },
    { "policy.limit:remove": true },
    { "nested.source:remove": true },
    { extra: true },
    { "policy.unknown": 1 },
    { "policy.limit": 0 },
    { "policy.limit": "2" },
    { "policy.methods:append": 2 },
    { "policy.methods:appendUnique": null },
    { "policy.methods:removeValue": false },
    { "policy.limit:append": 2 },
    { "policy.methods[0]:before": false },
    { "policy.items[id=a]:after": {} },
    { "policy.items[missing=a].label": "A" },
    { "union.enabled": false },
    { "strings:append": 1 },
    { "flat.key": {} },
    { "literal.alias": true },
    { "policy.__proto__.polluted": true },
    { "policy..limit": 1 },
    { ":append": 1 },
    { timestamp: "not a timestamp" },
  ])("rejects invalid mutation paths and operands %j", (mutate) => {
    expect(errors(mutation(mutate)).some((issue) => issue.path[2] === "mutate")).toBe(true);
  });
  it("retains ordered entry indexes and does not simulate a made up runtime base", () => {
    const result = mutation([
      { "policy.methods:append": "card" },
      { "policy.limit": 0 },
      { "policy.limit": 1 },
    ]);
    expect(errors(result).map((issue) => issue.path)).toEqual([
      ["overrides", 0, "mutate", 1, "policy.limit"],
    ]);
  });
  it("reports nested duplicate keys once and allows reuse in different environments", () => {
    const result = check([
      {
        key: "same",
        conditions: "*",
        mutate: { flag: true },
        overrides: [{ key: "same", conditions: "*", mutate: { flag: false } }],
      },
    ]);
    expect(
      errors(result)
        .filter((issue) => issue.message.includes("Duplicate"))
        .map((issue) => issue.path),
    ).toEqual([["overrides", 0, "overrides", 0, "key"]]);
    const environments = getVariableZodSchema(
      { ...config, environments: ["a", "b"] },
      {},
      [],
      features,
      schemas,
      variables,
    );
    const override = [{ key: "same", conditions: "*", mutate: { flag: false } }];
    expect(
      environments.safeParse({
        description: "Env",
        compose,
        overrides: { a: override, b: override },
      }).success,
    ).toBe(true);
  });
});
