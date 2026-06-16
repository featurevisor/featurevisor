/**
 * Unit tests for condition schema validation (segment conditions, feature rules, etc.).
 * Covers getConditionsZodSchema: attribute path resolution, operator/value compatibility,
 * schema-aware value validation, regexFlags, nesting, and "*" (everyone).
 */
import { z } from "zod";

import type { Attribute } from "@featurevisor/types";
import type { ProjectConfig } from "../config";
import { getConditionsZodSchema } from "./conditionSchema";

function minimalProjectConfig(): ProjectConfig {
  return {
    featuresDirectoryPath: "",
    segmentsDirectoryPath: "",
    attributesDirectoryPath: "",
    groupsDirectoryPath: "",
    schemasDirectoryPath: "",
    targetsDirectoryPath: "",
    testsDirectoryPath: "",
    stateDirectoryPath: "",
    datafilesDirectoryPath: "",
    datafileNamePattern: "",
    revisionFileName: "",
    siteExportDirectoryPath: "",
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
        type: "semver",
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
    oneOf: [{ type: "string" }, { type: "double" }],
  },
  traits: {
    description: "Traits",
    type: "object",
  },
};

function getConditionsSchema() {
  return getConditionsZodSchema(minimalProjectConfig(), TEST_ATTRIBUTES);
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
        "can only be used with integer or double attributes",
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
    });

    it("rejects date operators with invalid strings", () => {
      expectConditionsFailure(
        { attribute: "device", operator: "after", value: "not-a-date" },
        "ISO 8601",
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
    it("accepts in/notIn on scalar attributes", () => {
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
});
