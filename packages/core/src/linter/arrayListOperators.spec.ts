import { resolve } from "node:path";
import type { Attribute, ParsedFeature, ParsedVariable, Schema } from "@featurevisor/types";
import { getConditionsZodSchema } from "./conditionSchema";
import { getChecksZodSchema } from "./testSchema";
import { getProjectConfig } from "../config";

const config = getProjectConfig(resolve(__dirname, "../../../../examples/example-1"));
const attributes = {
  roles: {
    description: "Roles",
    type: "array",
    items: { type: "string", enum: ["member", "owner", "admin"] },
  },
  numbers: { description: "Numbers", type: "array", items: { type: "integer" } },
  booleans: { description: "Flags", type: "array", items: { type: "boolean" } },
  nested: {
    description: "Nested",
    type: "object",
    properties: { roles: { type: "array", items: { schema: "role" } } },
  },
  text: { description: "Text", type: "string" },
  objects: {
    description: "Objects",
    type: "array",
    items: { type: "object", properties: { role: { type: "string" } } },
  },
  arrays: {
    description: "Arrays",
    type: "array",
    items: { type: "array", items: { type: "string" } },
  },
} as unknown as Record<string, Attribute>;
const schemas = { role: { type: "string", enum: ["member", "owner", "admin"] } } as Record<
  string,
  Schema
>;
const variables = {
  roles: { type: "array", items: { type: "string" }, defaultValue: ["owner"] },
  numbers: { type: "array", items: { type: "integer" }, defaultValue: [1] },
  booleans: { type: "array", items: { type: "boolean" }, defaultValue: [true] },
  nested: {
    type: "object",
    properties: { roles: { type: "array", items: { type: "string" } } },
    defaultValue: { roles: ["owner"] },
  },
  text: { type: "string", defaultValue: "owner" },
  objects: { type: "array", items: { type: "object" }, defaultValue: [] },
  arrays: { type: "array", items: { type: "array", items: { type: "string" } }, defaultValue: [] },
  dynamic: {
    type: "object",
    properties: {
      roles: {
        oneOf: [
          { type: "array", items: { type: "string" } },
          { type: "array", items: { type: "integer" } },
        ],
      },
    },
    defaultValue: { roles: ["owner"] },
  },
} as unknown as Record<string, ParsedVariable>;
const features = { checkout: { variablesSchema: variables } } as unknown as Record<
  string,
  ParsedFeature
>;

describe.each(["includesAny", "notIncludesAny"])("array list operator %s", (operator) => {
  const conditions = () => getConditionsZodSchema(config, attributes, schemas);
  const required = () => getConditionsZodSchema(config, {}, schemas, features, variables);
  test.each([
    ["roles", ["owner"]],
    ["roles", []],
    ["numbers", [1, 2]],
    ["booleans", [true, false]],
    ["nested.roles", ["member"]],
  ])("accepts declared array %s", (attribute, value) => {
    expect(conditions().safeParse({ attribute, operator, value }).success).toBe(true);
  });
  test.each([undefined, null, "owner", 1, false, {}, [["owner"]], ["owner", {}]])(
    "rejects malformed condition candidate %#",
    (value) => {
      expect(conditions().safeParse({ attribute: "roles", operator, value }).success).toBe(false);
    },
  );
  test.each(["text", "objects", "arrays", "nested"])(
    "rejects incompatible attribute %s",
    (attribute) => {
      expect(conditions().safeParse({ attribute, operator, value: [] }).success).toBe(false);
    },
  );
  test.each([[["owner", {}]], [[["owner"]]], [new Array(1)]])(
    "reports a specific indexed diagnostic for malformed candidates %#",
    (value) => {
      const result = conditions().safeParse({ attribute: "roles", operator, value });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining(
                "each candidate must be a string, number, boolean or null",
              ),
              path: ["value", value.length - 1],
            }),
          ]),
        );
    },
  );
  test.each(["in", "notIn"])("retains the string array diagnostic for %s", (membership) => {
    const schema = getConditionsZodSchema(config, {
      country: { description: "Country", type: "string" },
    });
    const result = schema.safeParse({
      attribute: "country",
      operator: membership,
      value: [{ country: "nl" }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining("value must be a list of strings or of numbers"),
          }),
        ]),
      );
  });
  test("reports one issue per malformed candidate without hiding valid primitive schema errors", () => {
    const result = conditions().safeParse({
      attribute: "roles",
      operator,
      value: ["owner", {}, [], "unknown", NaN, null, 1, true, undefined],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(8);
    for (let index = 1; index <= 8; index++) {
      const issues = result.error.issues.filter(
        (issue) => issue.path[0] === "value" && issue.path[1] === index,
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain(
        [1, 2, 4, 8].includes(index) ? "each candidate" : "item schema",
      );
    }
  });
  test("keeps operand and unrelated configuration errors together", () => {
    const blocked = getConditionsZodSchema(
      { ...config, disallowOperators: [operator] },
      attributes,
      schemas,
    );
    const result = blocked.safeParse({
      attribute: "nested.roles",
      operator,
      value: ["owner", {}],
      regexFlags: "i",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(3);
    expect(result.error.issues.map((issue) => issue.path)).toEqual([
      ["operator"],
      ["value", 1],
      ["regexFlags"],
    ]);
  });
  test("retains enum and item type validation with indexed issues", () => {
    for (const [attribute, value] of [
      ["roles", ["owner", "unknown"]],
      ["numbers", [1, 1.5]],
      ["booleans", [false, 0]],
      ["nested.roles", ["owner", "unknown"]],
    ]) {
      const result = conditions().safeParse({ attribute, operator, value });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: ["value", 1] })]),
        );
    }
  });
  test("rejects regex flags and honours disallowOperators in groups", () => {
    expect(
      conditions().safeParse({ attribute: "roles", operator, value: ["owner"], regexFlags: "i" })
        .success,
    ).toBe(false);
    const blocked = getConditionsZodSchema(
      { ...config, disallowOperators: [operator] },
      attributes,
      schemas,
    );
    expect(
      blocked.safeParse({ not: [{ attribute: "roles", operator, value: ["owner"] }] }).success,
    ).toBe(false);
  });
  test.each([
    ["roles", ["owner"]],
    ["roles", []],
    ["numbers", [1]],
    ["booleans", [true]],
  ])("supports feature and global variable array %s", (variable, value) => {
    expect(required().safeParse({ variable, operator, value }).success).toBe(true);
    expect(required().safeParse({ feature: "checkout", variable, operator, value }).success).toBe(
      true,
    );
  });
  test("supports nested and dynamic variable paths", () => {
    expect(
      required().safeParse({ variable: "nested", path: "roles", operator, value: ["owner"] })
        .success,
    ).toBe(true);
    expect(
      required().safeParse({ variable: "dynamic", path: "roles", operator, value: ["owner"] })
        .success,
    ).toBe(true);
  });
  test.each([NaN, Infinity, -Infinity])("rejects nonportable numeric candidates %#", (value) => {
    expect(conditions().safeParse({ attribute: "numbers", operator, value: [value] }).success).toBe(
      false,
    );
    expect(
      required().safeParse({ variable: "dynamic", path: "roles", operator, value: [value] })
        .success,
    ).toBe(false);
  });
  test.each([undefined, null, "owner", {}, [[]], ["owner", {}]])(
    "rejects malformed requirement candidate %#",
    (value) => {
      expect(required().safeParse({ variable: "roles", operator, value }).success).toBe(false);
      expect(
        required().safeParse({ variable: "dynamic", path: "roles", operator, value }).success,
      ).toBe(false);
    },
  );
  test.each(["text", "objects", "arrays"])(
    "rejects incompatible required variable %s",
    (variable) => {
      expect(required().safeParse({ variable, operator, value: [] }).success).toBe(false);
    },
  );
  test("rejects required variable item type mismatches and disabled operators", () => {
    expect(required().safeParse({ variable: "numbers", operator, value: [true] }).success).toBe(
      false,
    );
    const blocked = getConditionsZodSchema(
      {
        ...config,
        disallowOperators: [operator],
      },
      {},
      schemas,
      features,
      variables,
    );
    expect(
      blocked.safeParse({ not: [{ variable: "roles", operator, value: ["owner"] }] }).success,
    ).toBe(false);
  });
  test("accepts literal and resolved array comparison checks", () => {
    const checks = getChecksZodSchema();
    expect(checks.safeParse([{ variable: "roles", operator, value: ["owner"] }]).success).toBe(
      true,
    );
    expect(
      checks.safeParse([
        { variable: "roles", operator, compareTo: { variable: "nested", path: "roles" } },
      ]).success,
    ).toBe(true);
    expect(
      checks.safeParse([{ variable: "roles", operator, value: ["owner"], regexFlags: "i" }])
        .success,
    ).toBe(false);
  });
});
