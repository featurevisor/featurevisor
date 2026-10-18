/**
 * Unit tests for condition schema validation (segment conditions, feature rules, etc.).
 * Covers getConditionsZodSchema: attribute path resolution, operator/value compatibility,
 * schema-aware value validation, regexFlags, nesting, and "*" (everyone).
 */
import { z } from "zod";

import type { Attribute, Schema } from "@featurevisor/types";
import type { ProjectConfig } from "../config";
import { getConditionsZodSchema } from "./conditionSchema";

function minimalProjectConfig(): ProjectConfig {
  return {
    featuresDirectoryPath: "",
    segmentsDirectoryPath: "",
    attributesDirectoryPath: "",
    schemasDirectoryPath: "",
    targetsDirectoryPath: "",
    variablesDirectoryPath: "",
    testsDirectoryPath: "",
    stateDirectoryPath: "",
    datafilesDirectoryPath: "",
    datafileNamePattern: "",
    revisionFileName: "",
    catalogDirectoryPath: "",
    setsDirectoryPath: "",
    environments: ["staging", "production"],
    sets: false,
    namespaceCharacter: ".",
    tags: ["all"],
    adapter: {},
    plugins: [],
    defaultBucketBy: "userId",
    parser: "yml",
    prettyState: true,
    prettyDatafile: false,
    stringify: true,
  };
}

const TEST_ATTRIBUTES: Record<string, Attribute> = {
  userId: {
    description: "User ID",
    type: "string",
  },
  country: {
    description: "Country",
    type: "string",
    enum: ["de", "fr", "nl", "us"],
  },
  device: {
    description: "Device",
    type: "string",
  },
  email: {
    description: "Email",
    type: "string",
    pattern: "^[^@]+@[^@]+\\.[^@]+$",
  },
  age: {
    description: "Age",
    type: "integer",
    minimum: 18,
  },
  browser: {
    description: "Browser",
    type: "object",
    properties: {
      name: {
        type: "string",
        enum: ["chrome", "firefox", "safari"],
      },
      version: {
        type: "string",
        format: "semver",
      },
    },
  },
  account: {
    description: "Account",
    type: "object",
    properties: {
      plan: {
        type: "string",
        enum: ["free", "pro"],
      },
      locale: {
        type: "string",
      },
    },
  },
  labels: {
    description: "Labels",
    type: "object",
    additionalProperties: {
      type: "string",
    },
  },
  permissions: {
    description: "Permissions",
    type: "array",
    items: {
      type: "string",
      enum: ["read", "write", "admin"],
    },
  },
  version: {
    description: "Version",
    oneOf: [{ type: "string" }, { type: "number" }],
  },
  traits: {
    description: "Traits",
    type: "object",
  },
  active: {
    description: "Whether the account is active",
    type: "boolean",
  },
  createdAt: {
    description: "Creation time",
    type: "string",
    format: "date-time",
  },
  payload: {
    description: "Unstructured payload",
    type: "json",
  } as unknown as Attribute,
  mixedCollection: {
    description: "String or integer",
    oneOf: [{ type: "integer" }, { type: "array", items: { type: "string" } }],
  },
  scalarUnion: {
    description: "Boolean or integer",
    oneOf: [{ type: "boolean" }, { type: "integer" }],
  },
  referencedCollection: {
    description: "Referenced collection",
    schema: "collection",
  } as unknown as Attribute,
  customer: {
    description: "Customer",
    schema: "customer",
  } as unknown as Attribute,
};

const TEST_SCHEMAS: Record<string, Schema> = {
  customer: {
    type: "object",
    properties: { tier: { type: "string" }, balance: { type: "number" } },
  },
  collection: {
    type: "array",
    items: { type: "string" },
  },
};

function getConditionsSchema() {
  return getConditionsZodSchema(minimalProjectConfig(), TEST_ATTRIBUTES, TEST_SCHEMAS);
}

function parseConditions(input: unknown): z.ZodSafeParseResult<unknown> {
  return getConditionsSchema().safeParse(input);
}

function expectConditionsSuccess(input: unknown): void {
  const result = parseConditions(input);
  expect(result.success).toBe(true);
  if (!result.success) {
    const err = (result as z.ZodSafeParseError<unknown>).error;
    const msg = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Expected conditions to pass: ${msg}`);
  }
}

function expectConditionsFailure(input: unknown, messageSubstring?: string): z.ZodError {
  const result = parseConditions(input);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Expected conditions to fail");
  const err = (result as z.ZodSafeParseError<unknown>).error;
  if (messageSubstring) {
    const messages = err.issues
      .map((i) => (typeof i.message === "string" ? i.message : ""))
      .join(" ");
    expect(messages).toContain(messageSubstring);
  }
  return err;
}

function expectConditionErrorSurfaces(
  input: unknown,
  opts: { pathContains: string[]; messageContains: string },
): void {
  const err = expectConditionsFailure(input, opts.messageContains);
  const pathStrings = err.issues.map((i) => i.path.join("."));
  const hasMatchingPath = pathStrings.some((p) =>
    opts.pathContains.every((seg) => p.includes(seg)),
  );
  expect(hasMatchingPath).toBe(true);
}

describe("conditionSchema.ts :: getConditionsZodSchema", () => {
  it("rejects configured operators inside a logical group at the operator path", () => {
    const schema = getConditionsZodSchema(
      { ...minimalProjectConfig(), disallowOperators: ["equals"] },
      TEST_ATTRIBUTES,
      TEST_SCHEMAS,
    );
    const result = schema.safeParse({
      not: [{ attribute: "country", operator: "equals", value: "nl" }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["not", 0, "operator"],
            message: expect.stringContaining("disallowed"),
          }),
        ]),
      );
  });
  describe("attribute path resolution", () => {
    it("accepts direct attributes", () => {
      expectConditionsSuccess({ attribute: "userId", operator: "equals", value: "u1" });
    });

    it("accepts nested attributes from declared object properties", () => {
      expectConditionsSuccess({
        attribute: "browser.name",
        operator: "equals",
        value: "chrome",
      });
    });

    it("accepts dynamic nested attributes via additionalProperties", () => {
      expectConditionsSuccess({
        attribute: "labels.locale",
        operator: "equals",
        value: "nl-NL",
      });
    });

    it("accepts one-level nested attributes on flat objects", () => {
      expectConditionsSuccess({
        attribute: "traits.favoriteColor",
        operator: "equals",
        value: "blue",
      });
    });

    it("rejects unknown attributes", () => {
      expectConditionsFailure(
        {
          attribute: "unknownAttr",
          operator: "equals",
          value: "x",
        },
        "Unknown attribute",
      );
    });

    it("rejects paths that are too deep for flat objects", () => {
      expectConditionsFailure(
        {
          attribute: "traits.preferences.theme",
          operator: "equals",
          value: "dark",
        },
        "Unknown attribute",
      );
    });
  });

  describe("operator and value validation", () => {
    it("accepts schema-aware equality checks", () => {
      expectConditionsSuccess({
        attribute: "browser.name",
        operator: "equals",
        value: "firefox",
      });
    });

    it("rejects equality values outside enum constraints", () => {
      expectConditionsFailure(
        {
          attribute: "browser.name",
          operator: "equals",
          value: "edge",
        },
        'Value does not match the schema of attribute "browser.name"',
      );
    });

    it("accepts number equality on numeric attributes", () => {
      expectConditionsSuccess({ attribute: "age", operator: "equals", value: 42 });
    });

    it("accepts null equality checks", () => {
      expectConditionsSuccess({ attribute: "userId", operator: "equals", value: null });
    });

    it("rejects array values with equals", () => {
      expectConditionsFailure(
        { attribute: "userId", operator: "equals", value: ["a", "b"] },
        "value has to be",
      );
    });

    it("accepts numeric operators on numeric attributes", () => {
      expectConditionsSuccess({
        attribute: "age",
        operator: "greaterThan",
        value: 21,
      });
    });

    it("rejects numeric operators on string attributes", () => {
      expectConditionsFailure(
        { attribute: "country", operator: "greaterThan", value: 10 },
        "can only be used with integer or number attributes",
      );
    });

    it("accepts string operators on string-like attributes", () => {
      expectConditionsSuccess({
        attribute: "email",
        operator: "contains",
        value: "@",
      });
    });

    it("rejects string operators on array attributes", () => {
      expectConditionsFailure(
        { attribute: "permissions", operator: "contains", value: "admin" },
        "can only be used with string-like attributes",
      );
    });

    it("accepts date operators with ISO strings", () => {
      expectConditionsSuccess({
        attribute: "device",
        operator: "before",
        value: "2025-12-31T23:59:59Z",
      });
      expectConditionsSuccess({
        attribute: "device",
        operator: "after",
        value: "2026-01-01T00:59:59+01:00",
      });
    });

    it("rejects date operators with invalid strings", () => {
      expectConditionsFailure(
        { attribute: "device", operator: "after", value: "not-a-date" },
        "ISO 8601",
      );
      expectConditionsFailure(
        { attribute: "device", operator: "after", value: "2025-12-31T23:59:59" },
        "ISO 8601",
      );
      expectConditionsFailure(
        { attribute: "device", operator: "after", value: "2025-12-31" },
        "ISO 8601",
      );
    });

    it.each([
      "2025-02-30T00:00:00Z",
      "1900-02-29T00:00:00Z",
      "2024-01-01T24:00:00Z",
      "2024-01-01T00:00:00.1234567890Z",
      "2024-01-01T00:00:00+14:01",
    ])("rejects invalid calendar or nonportable date %s", (value) => {
      expectConditionsFailure({ attribute: "device", operator: "before", value }, "ISO 8601");
    });

    it.each(["1234", "123456", "1234567", "123456789"])(
      "accepts longer fractional seconds %s",
      (fraction) => {
        expectConditionsSuccess({
          attribute: "device",
          operator: "before",
          value: `2024-01-01T00:00:00.${fraction}Z`,
        });
      },
    );

    it("rejects native Date operands outside the portable UTC range", () => {
      expectConditionsFailure(
        { attribute: "device", operator: "before", value: new Date("+010000-01-01T00:00:00Z") },
        "invalid",
      );
    });

    it("accepts semver operators on semver attributes", () => {
      expectConditionsSuccess({
        attribute: "browser.version",
        operator: "semverEquals",
        value: "1.0.0",
      });
    });

    it("accepts semver operators on oneOf attributes when a string branch supports them", () => {
      expectConditionsSuccess({
        attribute: "version",
        operator: "semverGreaterThan",
        value: "5.0.0",
      });
    });

    it("accepts numeric equality on oneOf attributes when a numeric branch matches", () => {
      expectConditionsSuccess({
        attribute: "version",
        operator: "equals",
        value: 5.5,
      });
    });
  });

  describe("array-aware operators", () => {
    it.each(["in", "notIn"])("limits %s to declared string leaves", (operator) => {
      for (const [attribute, value] of [
        ["country", ["de", "fr"]],
        ["browser.name", ["chrome"]],
        ["account.plan", ["pro"]],
        ["labels.region", ["eu"]],
        ["customer.tier", ["gold"]],
      ] as const) {
        expectConditionsSuccess({ attribute, operator, value: [...value] });
      }
      for (const attribute of [
        "age",
        "version",
        "browser.version",
        "active",
        "createdAt",
        "customer.balance",
      ]) {
        expectConditionsFailure(
          { attribute, operator, value: ["1"] },
          attribute === "createdAt"
            ? "date-time attribute"
            : "can only be used with string attributes",
        );
      }
      expectConditionsFailure(
        { attribute: "browser", operator, value: ["chrome"] },
        "resolves to an object",
      );
      expectConditionsFailure(
        { attribute: "browser.name", operator, value: [1] },
        "value must be an array of strings",
      );
    });

    it.each(["in", "notIn"])("reports one useful %s error for numeric membership", (operator) => {
      const schema = getConditionsZodSchema(minimalProjectConfig(), TEST_ATTRIBUTES);
      const result = schema.safeParse([{ attribute: "age", operator, value: [18, 21] }]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0].message).toContain(
          `Operator "${operator}" can only be used with string attributes`,
        );
        expect(result.error.issues[0].message).toContain(
          operator === "notIn" ? "Use a not group containing an or group" : "Use an or group",
        );
        expect(result.error.issues[0].path).toEqual([0, "value"]);
      }
    });

    it("accepts in/notIn on string attributes", () => {
      expectConditionsSuccess({
        attribute: "country",
        operator: "in",
        value: ["de", "fr", "nl"],
      });
    });

    it("rejects non-array values for in/notIn", () => {
      expectConditionsFailure(
        { attribute: "country", operator: "notIn", value: "de" },
        "value must be an array",
      );
    });

    it("rejects in/notIn members that violate attribute schema", () => {
      expectConditionsFailure(
        { attribute: "country", operator: "in", value: ["de", "unknown"] },
        'Value at index 1 does not match the schema of attribute "country"',
      );
    });

    it("accepts includes for arrays with typed string items", () => {
      expectConditionsSuccess({
        attribute: "permissions",
        operator: "includes",
        value: "admin",
      });
    });

    it("rejects includes values outside item enum constraints", () => {
      expectConditionsFailure(
        {
          attribute: "permissions",
          operator: "includes",
          value: "delete",
        },
        'Value does not match the item schema of attribute "permissions"',
      );
    });

    it("rejects non-string includes values for string arrays", () => {
      expectConditionsFailure(
        {
          attribute: "permissions",
          operator: "includes",
          value: 42,
        },
        'Value does not match the item schema of attribute "permissions"',
      );
    });
  });

  describe("regex flags", () => {
    it("accepts regexFlags with matches", () => {
      expectConditionsSuccess({
        attribute: "browser.version",
        operator: "matches",
        value: "1\\.0\\.0",
        regexFlags: "i",
      });
    });

    it("accepts all portable cross-SDK regex flags", () => {
      expectConditionsSuccess({
        attribute: "browser.version",
        operator: "matches",
        value: "^chrome$",
        regexFlags: "gims",
      });
    });

    it.each(["u", "y", "v", "d"])("rejects non-portable regex flag %s", (regexFlags) => {
      expectConditionsFailure(
        {
          attribute: "browser.version",
          operator: "matches",
          value: "^chrome$",
          regexFlags,
        },
        "cross-SDK",
      );
    });

    it("rejects invalid regexFlags", () => {
      expectConditionsFailure(
        {
          attribute: "browser.version",
          operator: "matches",
          value: "x",
          regexFlags: "invalid",
        },
        "regexFlags",
      );
    });

    it("rejects duplicate regexFlags", () => {
      expectConditionsFailure(
        {
          attribute: "browser.version",
          operator: "matches",
          value: "x",
          regexFlags: "ii",
        },
        "unique",
      );
    });

    it.each([
      ["lookahead", "foo(?=bar)"],
      ["lookbehind", "(?<=foo)bar"],
      ["noncapturing group", "(?:foo|bar)"],
      ["named group", "(?<name>foo)"],
      ["numeric backreference", "(foo)\\1"],
      ["named backreference", "(?<name>foo)\\k<name>"],
      ["possessive quantifier", "foo++"],
    ])("rejects non-portable regex syntax: %s", (_name, pattern) => {
      expectConditionsFailure(
        {
          attribute: "userId",
          operator: "matches",
          value: pattern,
        },
        "cross-SDK regex subset",
      );
    });

    it.each(["^(a+)+$", "^(a|aa)+$", "^([\\w.-]+)+@example\\.com$"])(
      "rejects exponential backtracking: %s",
      (pattern) => {
        expectConditionsFailure(
          { attribute: "userId", operator: "matches", value: pattern },
          "exponential time",
        );
      },
    );

    it.each([
      "^chrome$",
      "^(chrome|firefox)$",
      "^([a-z0-9-]+\\.)+[a-z]{2,}$",
      "^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$",
      "line1.*line2",
      "\\(literal\\)",
    ])("accepts portable regex syntax: %s", (pattern) => {
      expectConditionsSuccess({
        attribute: "userId",
        operator: "matches",
        value: pattern,
      });
    });

    it("rejects regexFlags when operator is not matches/notMatches", () => {
      expectConditionsFailure(
        {
          attribute: "userId",
          operator: "equals",
          value: "u1",
          regexFlags: "i",
        },
        "not needed",
      );
    });
  });

  describe("exists/notExists", () => {
    it("accepts exists without value", () => {
      expectConditionsSuccess({
        attribute: "userId",
        operator: "exists",
      });
    });

    it("rejects exists with value", () => {
      expectConditionsFailure(
        { attribute: "userId", operator: "exists", value: "x" },
        "value is not needed",
      );
    });
  });

  describe("empty/notEmpty", () => {
    it.each([
      ["userId", "empty"],
      ["browser.version", "notEmpty"],
      ["permissions", "notEmpty"],
      ["traits", "empty"],
      ["payload", "notEmpty"],
      ["mixedCollection", "empty"],
      ["referencedCollection", "notEmpty"],
    ])("accepts %s %s without an operand", (attribute, operator) => {
      expectConditionsSuccess({ attribute, operator });
    });

    it.each(["age", "active", "scalarUnion"])(
      "rejects emptiness checks on known incompatible attribute %s",
      (attribute) => {
        expectConditionsFailure(
          { attribute, operator: "empty" },
          "can only be used with string, array or object attributes",
        );
      },
    );

    it.each([
      { attribute: "userId", operator: "empty", value: "" },
      { attribute: "userId", operator: "empty", value: false },
      { attribute: "userId", operator: "empty", value: 0 },
      { attribute: "permissions", operator: "notEmpty", value: null },
      { attribute: "permissions", operator: "notEmpty", value: [] },
      { attribute: "traits", operator: "empty", regexFlags: "" },
      { attribute: "traits", operator: "empty", regexFlags: "i" },
      { attribute: "traits", operator: "notEmpty", compareTo: null },
      { attribute: "traits", operator: "notEmpty", compareTo: { attribute: "userId" } },
    ])("rejects malformed valueless condition %#", (condition) => {
      expectConditionsFailure(condition);
    });
  });

  describe("structure", () => {
    it("accepts nested and/or/not conditions", () => {
      expectConditionsSuccess({
        or: [
          {
            and: [
              { attribute: "browser.name", operator: "equals", value: "chrome" },
              { attribute: "country", operator: "equals", value: "de" },
            ],
          },
          { attribute: "permissions", operator: "includes", value: "admin" },
        ],
      });
    });

    it("rejects empty and/or/not condition arrays", () => {
      expectConditionsFailure({ and: [] });
      expectConditionsFailure({ or: [] });
      expectConditionsFailure({ not: [] });
    });

    it("rejects invalid nested conditions", () => {
      expectConditionsFailure(
        {
          and: [
            { attribute: "userId", operator: "equals", value: "u1" },
            { attribute: "browser.name", operator: "equals", value: "edge" },
          ],
        },
        'Value does not match the schema of attribute "browser.name"',
      );
    });

    it("accepts literal * as conditions", () => {
      expectConditionsSuccess("*");
    });

    it("accepts arrays of plain conditions", () => {
      expectConditionsSuccess([
        { attribute: "userId", operator: "equals", value: "u1" },
        { attribute: "country", operator: "equals", value: "de" },
      ]);
    });

    it("rejects and/or/not objects with extra keys", () => {
      const result = parseConditions({
        and: [{ attribute: "userId", operator: "equals", value: "u1" }],
        extraKey: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("date-time attribute operator restrictions", () => {
    const attributes: Record<string, Attribute> = {
      date: { description: "Date", type: "string", format: "date-time" },
      profile: {
        description: "Profile",
        type: "object",
        properties: { date: { type: "string", format: "date-time" } },
      },
      calendar: {
        description: "Calendar",
        type: "object",
        additionalProperties: { type: "string", format: "date-time" },
      },
      dateUnion: {
        description: "Date union",
        oneOf: [
          { type: "string", format: "date-time", const: "2026-01-01T00:00:00Z" },
          { type: "string", format: "date-time", const: "2026-02-01T00:00:00Z" },
        ],
      },
      mixed: {
        description: "Mixed",
        oneOf: [{ type: "string", format: "date-time" }, { type: "string" }],
      },
      text: { description: "Text", type: "string" },
    };
    const schema = getConditionsZodSchema(minimalProjectConfig(), attributes);

    it.each(["date", "profile.date", "calendar.launch", "dateUnion"])(
      "permits only time and presence comparisons for %s",
      (attribute) => {
        for (const operator of ["before", "after"]) {
          expect(
            schema.safeParse({ attribute, operator, value: "2026-01-01T00:00:00Z" }).success,
          ).toBe(true);
        }
        for (const operator of ["exists", "notExists", "isNull", "notNull"]) {
          expect(schema.safeParse({ attribute, operator }).success).toBe(true);
        }
        for (const operator of [
          "equals",
          "notEquals",
          "contains",
          "notContains",
          "startsWith",
          "endsWith",
          "matches",
          "notMatches",
          "empty",
          "notEmpty",
          "in",
          "notIn",
          "includes",
          "notIncludes",
          "includesAny",
          "notIncludesAny",
          "semverEquals",
          "greaterThan",
        ]) {
          const result = schema.safeParse({ attribute, operator, value: "[" });
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.issues).toHaveLength(1);
            expect(result.error.issues[0].message).toContain(`date-time attribute "${attribute}"`);
            expect(result.error.issues[0].path).toEqual(["operator"]);
          }
        }
      },
    );

    it("keeps text comparisons on strings and mixed unions", () => {
      for (const attribute of ["text", "mixed"]) {
        for (const operator of ["startsWith", "empty", "notEmpty"]) {
          expect(
            schema.safeParse({
              attribute,
              operator,
              ...(operator === "startsWith" ? { value: "2026" } : {}),
            }).success,
          ).toBe(true);
        }
      }
    });
  });

  describe("error surfacing", () => {
    it("reports unknown attributes at the attribute path", () => {
      expectConditionErrorSurfaces(
        { attribute: "typoAttr", operator: "equals", value: "x" },
        { pathContains: ["attribute"], messageContains: "Unknown attribute" },
      );
    });

    it("reports schema mismatches at the value path", () => {
      expectConditionErrorSurfaces(
        { attribute: "browser.name", operator: "equals", value: "edge" },
        { pathContains: ["value"], messageContains: "Value does not match the schema" },
      );
    });

    it("reports array item schema mismatches at the value path", () => {
      expectConditionErrorSurfaces(
        { attribute: "country", operator: "in", value: ["de", "edge"] },
        { pathContains: ["value"], messageContains: "Value at index 1 does not match" },
      );
    });
  });

  describe("string formats", () => {
    it.each(["5.5.0", "5.5", "v5.5.0", "1.x"])("accepts the version %s", (value) => {
      expectConditionsSuccess([
        { attribute: "browser.version", operator: "semverGreaterThan", value },
      ]);
    });

    it("rejects a version the operators cannot compare", () => {
      expectConditionsFailure(
        [{ attribute: "browser.version", operator: "semverGreaterThan", value: "5.5,0" }],
        "value must be a version the operators can compare",
      );
    });

    it("asks to quote versions YAML read as numbers", () => {
      expectConditionsFailure(
        [{ attribute: "browser.version", operator: "semverEquals", value: 5.5 }],
        "Quote versions such as '5.5'",
      );
    });

    it("checks equality values against format: semver", () => {
      expectConditionsSuccess([{ attribute: "browser.version", operator: "equals", value: "5.5" }]);
      expectConditionsFailure(
        [{ attribute: "browser.version", operator: "equals", value: "latest" }],
        'does not match the schema of attribute "browser.version"',
      );
    });

    it("compares a plain string timestamp as a time and as text", () => {
      const attributes: Record<string, Attribute> = {
        launch: { description: "Launch", type: "string", format: "date-time" },
        launchText: { description: "Launch as text", type: "string" },
        overlapping: {
          description: "Overlapping branches",
          oneOf: [{ type: "string", format: "date-time" }, { type: "string" }],
        },
      };
      const schema = getConditionsZodSchema(minimalProjectConfig(), attributes, {});
      const ok = (condition: unknown) => schema.safeParse([condition]).success;
      const timestamp = "2026-01-01T00:00:00Z";
      expect(ok({ attribute: "launch", operator: "equals", value: timestamp })).toBe(false);
      expect(ok({ attribute: "launchText", operator: "equals", value: timestamp })).toBe(true);
      expect(ok({ attribute: "launchText", operator: "before", value: timestamp })).toBe(true);
      // oneOf needs exactly one branch, and a timestamp matches both of these.
      expect(ok({ attribute: "overlapping", operator: "equals", value: timestamp })).toBe(false);
    });

    it("names number attributes in numeric operator errors", () => {
      expectConditionsFailure(
        [{ attribute: "country", operator: "greaterThan", value: 1 }],
        "can only be used with integer or number attributes",
      );
    });
  });
});
