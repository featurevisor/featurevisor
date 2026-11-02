import type { ParsedFeature, ParsedVariable, Schema } from "@featurevisor/types";
import { getConditionsZodSchema } from "./conditionSchema";
const features = {
  checkout: {
    variablesSchema: {
      settings: {
        type: "object",
        properties: {
          title: { type: "string" },
          enabled: { type: "boolean" },
          limits: { type: "array", items: { type: "integer" } },
        },
      },
      raw: { type: "json" },
    },
  },
  archived: { archived: true, variablesSchema: { message: { type: "string" } } },
} as unknown as Record<string, ParsedFeature>;

const variables = {
  enabled: { type: "boolean", defaultValue: true },
  nullableMessage: { type: "string", defaultValue: null },
  profile: { schema: "profile", defaultValue: { name: "Ada" } },
  unionValue: { oneOf: [{ type: "string" }, { type: "integer" }], defaultValue: "one" },
  scalarUnion: { oneOf: [{ type: "boolean" }, { type: "integer" }], defaultValue: 1 },
  strictObject: { type: "object", additionalProperties: false, defaultValue: {} },
  looseObject: { type: "object", additionalProperties: true, defaultValue: { dynamic: 1 } },
  jsonConfig: { type: "json", defaultValue: '{"nested":[1]}' },
  openObject: { type: "object", defaultValue: { dynamic: true } },
  regions: { type: "string", enum: ["eu", "us"], defaultValue: "eu" },
  positive: { type: "integer", minimum: 1, defaultValue: 1 },
  stringList: { type: "array", items: { type: "string" }, defaultValue: ["first"] },
  release: { type: "string", format: "semver", defaultValue: "1.0.0" },
  expiresAt: { type: "string", format: "date-time", defaultValue: "2026-09-18T00:00:00Z" },
  numericKeys: {
    type: "object",
    properties: { "0": { type: "string" } },
    defaultValue: { "0": "zero" },
  },
  literalKeys: {
    type: "object",
    properties: { "01": { type: "string" }, "support.label": { type: "string" } },
    defaultValue: {},
  },
  "config.policy": { type: "string", defaultValue: "strict" },
  archived: { archived: true, type: "string", defaultValue: "old" },
} as unknown as Record<string, ParsedVariable>;

const schemas = {
  profile: {
    type: "object",
    properties: {
      name: { type: "string" },
      enabled: { type: "boolean" },
      quota: { schema: "limit" },
      payload: { type: "json" },
      extras: { type: "object" },
    },
  },
  limit: { type: "integer", minimum: 0, maximum: 10 },
} as unknown as Record<string, Schema>;

function parse(value: unknown) {
  return getConditionsZodSchema({} as any, {}, schemas, features, variables).safeParse(value);
}

describe("requiredVariables schema", () => {
  it.each(["in", "notIn"])(
    "rejects boolean membership for %s without changing boolean equality",
    (operator) => {
      expect(parse({ variable: "enabled", operator, value: [true] }).success).toBe(false);
      expect(parse({ variable: "enabled", operator, value: [null] }).success).toBe(false);
      expect(
        parse({ variable: "looseObject", path: "dynamic", operator, value: [true] }).success,
      ).toBe(false);
      expect(parse({ variable: "scalarUnion", operator, value: [false] }).success).toBe(false);
      expect(parse({ variable: "profile", path: "enabled", operator, value: [true] }).success).toBe(
        false,
      );
      expect(
        parse({
          feature: "checkout",
          variable: "settings",
          path: ["enabled"],
          operator,
          value: [true],
        }).success,
      ).toBe(false);
      expect(parse({ variable: "regions", operator, value: ["eu", null] }).success).toBe(true);
      expect(parse({ variable: "positive", operator, value: [1, null] }).success).toBe(true);
      expect(parse({ variable: "enabled", operator: "equals", value: true }).success).toBe(true);
      expect(parse({ variable: "enabled", operator: "notEquals", value: false }).success).toBe(
        true,
      );
    },
  );
  it.each(["1234", "123456", "1234567", "123456789"])(
    "accepts longer fractional seconds %s",
    (fraction) => {
      expect(
        parse({
          variable: "expiresAt",
          operator: "before",
          value: `2024-01-01T00:00:00.${fraction}Z`,
        }).success,
      ).toBe(true);
    },
  );
  it.each([
    "2025-02-30T00:00:00Z",
    "1900-02-29T00:00:00Z",
    "2024-01-01T24:00:00Z",
    "2024-01-01T00:00:00.1234567890Z",
    "2024-01-01T00:00:00+14:01",
  ])("rejects invalid date operand %s", (value) => {
    expect(parse({ variable: "expiresAt", operator: "before", value }).success).toBe(false);
  });
  it.each([
    ["equals", "2026-09-18T00:00:00Z", "Compare dates with before or after"],
    ["startsWith", "2026", "Compare dates with before or after"],
    ["empty", undefined, "Use exists or notNull"],
  ])(
    "rejects %s on a date-time variable like a date-time attribute",
    (operator, value, message) => {
      const result = parse({
        variable: "expiresAt",
        operator,
        ...(value === undefined ? {} : { value }),
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].message).toContain(message);
    },
  );
  it.each(["exists", "notNull"])("accepts %s on a date-time variable", (operator) => {
    expect(parse({ variable: "expiresAt", operator }).success).toBe(true);
  });
  it.each([
    ["semverGreaterThan", "5.5", true],
    ["semverEquals", "v5.5.0", true],
    ["semverEquals", "5.5,0", false],
    ["equals", "5.5,0", false],
  ])("checks %s operand %s against the version grammar", (operator, value, success) => {
    expect(parse({ variable: "release", operator, value }).success).toBe(success);
  });
  it("accepts valid leap day and millisecond date operands", () => {
    expect(
      parse({ variable: "expiresAt", operator: "before", value: "2000-02-29T12:00:00.250+14:00" })
        .success,
    ).toBe(true);
  });
  it("rejects configured operators in requirements with a precise path", () => {
    const schema = getConditionsZodSchema(
      {
        disallowOperators: ["equals"],
      } as any,
      {},
      schemas,
      features,
      variables,
    );
    const result = schema.safeParse({
      or: [{ variable: "enabled", operator: "equals", value: true }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["or", 0, "operator"],
            message: expect.stringContaining("disallowed"),
          }),
        ]),
      );
  });
  it("accepts global and feature variables, paths, null and recursive groups", () => {
    expect(parse({ variable: "enabled", operator: "equals", value: true }).success).toBe(true);
    expect(parse({ variable: "nullableMessage", operator: "equals", value: null }).success).toBe(
      true,
    );
    expect(
      parse({ variable: "profile", path: "name", operator: "startsWith", value: "A" }).success,
    ).toBe(true);
    expect(parse({ variable: "profile", operator: "equals", value: null }).success).toBe(true);
    expect(parse({ variable: "enabled", path: [], operator: "equals", value: true }).success).toBe(
      true,
    );
    expect(
      parse({ variable: "literalKeys", path: ["support.label"], operator: "equals", value: "Help" })
        .success,
    ).toBe(true);
    expect(
      parse({ variable: "profile", path: ["name"], operator: "equals", value: "Ada" }).success,
    ).toBe(true);
    expect(parse({ variable: "config.policy", operator: "equals", value: "strict" }).success).toBe(
      true,
    );
    expect(
      parse({ variable: "profile", path: "quota", operator: "greaterThan", value: 2 }).success,
    ).toBe(true);
    expect(parse({ variable: "regions", operator: "startsWith", value: "e" }).success).toBe(true);
    expect(parse({ variable: "regions", operator: "matches", value: "^e" }).success).toBe(true);
    expect(parse({ variable: "positive", operator: "greaterThan", value: 0 }).success).toBe(true);
    expect(parse({ variable: "unionValue", operator: "greaterThan", value: 2 }).success).toBe(true);
    expect(
      parse({
        feature: "checkout",
        variable: "settings",
        path: ["limits", 0],
        operator: "greaterThan",
        value: 1,
      }).success,
    ).toBe(true);
    expect(
      parse({
        and: [
          { variable: "enabled", operator: "notNull" },
          { or: [{ variable: "enabled", operator: "equals", value: true }] },
        ],
      }).success,
    ).toBe(true);
    expect(
      parse({ not: [{ variable: "enabled", operator: "equals", value: false }] }).success,
    ).toBe(true);
  });

  it.each([
    [{ variable: "missing", operator: "equals", value: true }, "Unknown global variable"],
    [{ feature: "missing", variable: "settings", operator: "exists" }, "Unknown feature"],
    [{ feature: "checkout", variable: "missing", operator: "exists" }, "Unknown feature variable"],
    [{ variable: "profile", path: "missing", operator: "exists" }, "Path does not exist"],
    [{ variable: "strictObject", path: "missing", operator: "exists" }, "Path does not exist"],
    [
      { variable: "profile", path: "quota", operator: "greaterThan", value: "zero" },
      "value must be a number",
    ],
    [{ variable: "profile", path: "name..first", operator: "exists" }, "empty dot components"],
    [
      { variable: "jsonConfig", path: "9007199254740992", operator: "exists" },
      "safe nonnegative integers",
    ],
    [{ variable: "profile", path: ["__proto__"], operator: "exists" }, "unsafe path segment"],
    [
      { feature: "checkout", variable: "settings", path: ["limits", -1], operator: "exists" },
      "nonnegative integers",
    ],
    [{ variable: "profile", operator: "equals", value: { name: "Ada" } }, "deep equality"],
    [{ variable: "enabled", operator: "greaterThan", value: 1 }, "numeric variable"],
    [{ variable: "enabled", operator: "isNull", value: null }, "value is not needed"],
    [
      { variable: "nullableMessage", operator: "matches", value: "(?=x)" },
      "unsupported group syntax",
    ],
  ])("rejects invalid requirement %#", (value, message) => {
    const result = parse(value);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.some((issue) => issue.message.includes(message))).toBe(true);
  });

  it("rejects empty groups and arrays", () => {
    expect(parse([]).success).toBe(false);
    expect(parse({ and: [] }).success).toBe(false);
    expect(parse({ not: [] }).success).toBe(false);
  });

  it("keeps leading-zero dotted components and dotted array components as literal keys", () => {
    expect(parse({ variable: "literalKeys", path: "01", operator: "exists" }).success).toBe(true);
    expect(
      parse({ variable: "literalKeys", path: ["support.label"], operator: "exists" }).success,
    ).toBe(true);
  });

  it("rejects conditions that read json values", () => {
    const direct =
      "Conditions cannot read json variables, since their contents have no declared types.";
    for (const [requirement, message, path] of [
      [{ variable: "jsonConfig", operator: "exists" }, direct, "variable"],
      [
        { variable: "jsonConfig", path: "nested.0", operator: "greaterThan", value: 0 },
        direct,
        "variable",
      ],
      [{ variable: "jsonConfig", path: "nested", operator: "notEmpty" }, direct, "variable"],
      [
        { feature: "checkout", variable: "raw", path: "a", operator: "equals", value: 1 },
        direct,
        "variable",
      ],
      [
        { variable: "profile", path: "payload.any.0", operator: "equals", value: true },
        'this condition reads one through global variable "profile"',
        "path",
      ],
    ] as const) {
      const result = parse(requirement);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0].message).toContain(message);
        expect(result.error.issues[0].path).toEqual([path]);
      }
    }
    const composed = getConditionsZodSchema({} as any, {}, schemas, features, {
      ...variables,
      composedRaw: { compose: { raw: { feature: "checkout", variable: "raw" } } },
      rawAlias: { compose: "composedRaw" },
    } as unknown as Record<string, ParsedVariable>);
    for (const variable of ["composedRaw", "rawAlias"]) {
      const result = composed.safeParse({ variable, path: ["raw", "a"], operator: "exists" });
      expect(!result.success && result.error.issues[0].message).toContain(
        `reads one through global variable "${variable}". Give variable "raw" of feature "checkout" a declared shape`,
      );
    }
    const feature = parse({ feature: "checkout", variable: "raw", operator: "exists" });
    expect(!feature.success && feature.error.issues[0].message).toContain(
      'Give variable "raw" of feature "checkout" a declared shape, such as type object with properties, to use it here.',
    );
  });

  it("rejects reading inside objects without declared properties", () => {
    const fix = "properties, or additionalProperties for a map, to use it here.";
    for (const [requirement, message] of [
      [
        { variable: "openObject", path: "anything", operator: "exists" },
        `Conditions cannot read inside objects without declared properties, since their contents have no declared types. Give global variable "openObject" ${fix}`,
      ],
      [
        { variable: "looseObject", path: "dynamic", operator: "equals", value: 1 },
        `Give global variable "looseObject" ${fix}`,
      ],
      [
        { variable: "profile", path: "extras.colour", operator: "equals", value: "red" },
        `this condition reads inside one through global variable "profile". Give "extras" in global variable "profile" ${fix}`,
      ],
    ] as const) {
      const result = parse(requirement);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0].message).toContain(message);
        expect(result.error.issues[0].path).toEqual(["path"]);
      }
    }
    const aliased = getConditionsZodSchema({} as any, {}, schemas, features, {
      ...variables,
      openAlias: { compose: "openObject" },
    } as unknown as Record<string, ParsedVariable>).safeParse({
      variable: "openAlias",
      path: "anything",
      operator: "exists",
    });
    expect(!aliased.success && aliased.error.issues[0].message).toContain(
      `reads inside one through global variable "openAlias". Give global variable "openObject" ${fix}`,
    );
    for (const requirement of [
      { variable: "openObject", operator: "exists" },
      { variable: "openObject", operator: "notEmpty" },
      { variable: "profile", path: "extras", operator: "notNull" },
    ]) {
      expect(parse(requirement).success).toBe(true);
    }
  });

  it("accepts emptiness operators for supported, referenced, union and unknown schemas", () => {
    for (const requirement of [
      { variable: "nullableMessage", operator: "empty" },
      { variable: "stringList", operator: "notEmpty" },
      { variable: "strictObject", operator: "empty" },
      { variable: "profile", operator: "notEmpty" },
      { variable: "profile", path: "name", operator: "empty" },
      { variable: "openObject", operator: "notEmpty" },
      { variable: "profile", path: "extras", operator: "empty" },
      { variable: "unionValue", operator: "empty" },
      { variable: "release", operator: "notEmpty" },
      { feature: "checkout", variable: "settings", path: "limits", operator: "notEmpty" },
    ]) {
      expect(parse(requirement).success).toBe(true);
    }
  });

  it.each([
    [{ variable: "enabled", operator: "empty" }, "string, array or object variable"],
    [{ variable: "positive", operator: "notEmpty" }, "string, array or object variable"],
    [{ variable: "scalarUnion", operator: "empty" }, "string, array or object variable"],
    [{ variable: "stringList", operator: "empty", value: "" }, "value is not needed"],
    [{ variable: "stringList", operator: "empty", value: false }, "value is not needed"],
    [{ variable: "stringList", operator: "empty", value: 0 }, "value is not needed"],
    [{ variable: "stringList", operator: "empty", value: null }, "value is not needed"],
    [{ variable: "stringList", operator: "empty", value: [] }, "value is not needed"],
    [{ variable: "profile", operator: "notEmpty", regexFlags: "" }, ""],
    [{ variable: "profile", operator: "notEmpty", regexFlags: "i" }, "only allowed"],
    [{ variable: "profile", operator: "empty", compareTo: null }, ""],
    [{ variable: "profile", operator: "empty", compareTo: { variable: "stringList" } }, ""],
  ])("rejects invalid emptiness requirement %#", (requirement, message) => {
    const result = parse(requirement);
    expect(result.success).toBe(false);
    if (!result.success) {
      if (message) {
        expect(result.error.issues.some((issue) => issue.message.includes(message))).toBe(true);
      }
    }
  });

  it("resolves string array indices and length without conflating object key types", () => {
    expect(
      parse({ variable: "stringList", path: ["0"], operator: "startsWith", value: "f" }).success,
    ).toBe(true);
    expect(
      parse({ variable: "stringList", path: ["length"], operator: "greaterThan", value: 0 })
        .success,
    ).toBe(true);
    expect(
      parse({ variable: "numericKeys", path: ["0"], operator: "equals", value: "zero" }).success,
    ).toBe(true);
    expect(
      parse({ variable: "numericKeys", path: [0], operator: "equals", value: "zero" }).success,
    ).toBe(false);
    expect(
      parse({ variable: "numericKeys", path: "0", operator: "equals", value: "zero" }).success,
    ).toBe(false);
    expect(parse({ variable: "stringList", path: ["00"], operator: "exists" }).success).toBe(false);
  });
});
