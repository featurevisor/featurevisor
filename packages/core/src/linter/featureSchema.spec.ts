/**
 * Unit tests for feature schema validation, with focus on variablesSchema and
 * variable value validation (defaultValue, disabledValue, variations, variableOverrides,
 * rules, force). Ensures every place a variable value can be set is validated against
 * the variable's schema.
 */
import type { Schema } from "@featurevisor/types";
import { z } from "zod";

import type { ProjectConfig } from "../config";
import { getConditionsZodSchema } from "./conditionSchema";
import { getFeatureZodSchema } from "./featureSchema";

/** Minimal project config for feature schema tests (no file paths used for variable validation). */
function minimalProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    featuresDirectoryPath: "",
    segmentsDirectoryPath: "",
    attributesDirectoryPath: "",
    groupsDirectoryPath: "",
    schemasDirectoryPath: "",
    testsDirectoryPath: "",
    stateDirectoryPath: "",
    datafilesDirectoryPath: "",
    datafileNamePattern: "",
    revisionFileName: "",
    siteExportDirectoryPath: "",
    environments: ["staging", "production"],
    tags: ["all"],
    adapter: {},
    plugins: [],
    defaultBucketBy: "userId",
    parser: "yml",
    prettyState: true,
    prettyDatafile: false,
    stringify: true,
    enforceCatchAllRule: false,
    ...overrides,
  };
}

/** Attributes and segments that appear in conditions; keep small for tests. */
const TEST_ATTRIBUTES: [string, ...string[]] = ["userId", "country", "device"];
const TEST_SEGMENTS: [string, ...string[]] = ["*", "countries/germany", "countries/france"];
const TEST_FEATURES: [string, ...string[]] = ["testFeature"];
const TEST_SCHEMA_KEYS = ["link", "slugSchema"];

/** Resolved schema for "slugSchema": string with pattern and length. */
const slugSchemaResolved: Schema = {
  type: "string",
  minLength: 1,
  maxLength: 30,
  pattern: "^[a-z0-9-]+$",
};

/** Resolved schema for "link": object with title and url. */
const linkSchemaResolved: Schema = {
  type: "object",
  required: ["title", "url"],
  properties: {
    title: { type: "string" },
    url: { type: "string" },
  },
};

const TEST_SCHEMAS_BY_KEY: Record<string, Schema> = {
  link: linkSchemaResolved,
  slugSchema: slugSchemaResolved,
};

function getFeatureSchema() {
  const projectConfig = minimalProjectConfig();
  const conditionsZodSchema = getConditionsZodSchema(projectConfig, TEST_ATTRIBUTES);
  return getFeatureZodSchema(
    projectConfig,
    conditionsZodSchema,
    TEST_ATTRIBUTES,
    TEST_SEGMENTS,
    TEST_FEATURES,
    TEST_SCHEMA_KEYS,
    TEST_SCHEMAS_BY_KEY,
  );
}

/** Base feature shape required by getFeatureZodSchema (description, tags, bucketBy, rules). */
function baseFeature(overrides: Record<string, unknown> = {}) {
  return {
    description: "Test feature",
    tags: ["all"],
    bucketBy: "userId",
    rules: {
      staging: [{ key: "r1", segments: "*", percentage: 100 }],
      production: [{ key: "r1", segments: "*", percentage: 100 }],
    },
    ...overrides,
  };
}

function parseFeature(feature: unknown): z.SafeParseReturnType<unknown, unknown> {
  return getFeatureSchema().safeParse(feature);
}

function expectParseSuccess(feature: unknown): void {
  const result = parseFeature(feature);
  expect(result.success).toBe(true);
  if (!result.success) {
    const err = (result as z.SafeParseError<unknown>).error;
    const msg = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Expected success but got: ${msg}`);
  }
}

function expectParseFailure(feature: unknown, messageSubstring?: string): z.ZodError {
  const result = parseFeature(feature);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Expected parse failure");
  const err = (result as z.SafeParseError<unknown>).error;
  if (messageSubstring) {
    const messages = err.issues.map((i) => (typeof i.message === "string" ? i.message : "")).join(" ");
    expect(messages).toContain(messageSubstring);
  }
  return err;
}

describe("featureSchema.ts :: getFeatureZodSchema (variablesSchema and variable values)", () => {
  describe("variablesSchema: schema reference", () => {
    it("accepts variable with schema reference and valid defaultValue", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "link",
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
      );
    });

    it("rejects variable with unknown schema reference", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "nonexistentSchema",
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
        "Unknown schema",
      );
    });

    it("rejects variable with schema reference when defaultValue does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "link",
              defaultValue: { title: "Home" }, // missing required "url"
            },
          },
        }),
      );
    });
  });

  describe("variablesSchema: inline schema and defaultValue", () => {
    it("accepts inline string variable with valid defaultValue", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            label: { type: "string", defaultValue: "hello" },
          },
        }),
      );
    });

    it("accepts inline integer with min/max and defaultValue in range", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              defaultValue: 5,
            },
          },
        }),
      );
    });

    it("rejects inline integer defaultValue below minimum", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              defaultValue: 0,
            },
          },
        }),
        "minimum",
      );
    });

    it("rejects inline integer defaultValue above maximum", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              defaultValue: 11,
            },
          },
        }),
        "maximum",
      );
    });

    it("rejects inline string defaultValue that violates minLength", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: {
              type: "string",
              minLength: 3,
              defaultValue: "ab",
            },
          },
        }),
        "minLength",
      );
    });

    it("rejects inline string defaultValue that violates maxLength", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: {
              type: "string",
              maxLength: 5,
              defaultValue: "toolong",
            },
          },
        }),
        "maxLength",
      );
    });

    it("rejects inline string defaultValue that does not match pattern", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: {
              type: "string",
              pattern: "^[a-z0-9-]+$",
              defaultValue: "INVALID",
            },
          },
        }),
        "pattern",
      );
    });

    it("rejects inline array defaultValue with length below minItems", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            tags: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
              defaultValue: ["one"],
            },
          },
        }),
        "minItems",
      );
    });

    it("rejects inline array defaultValue with length above maxItems", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            tags: {
              type: "array",
              items: { type: "string" },
              maxItems: 2,
              defaultValue: ["a", "b", "c"],
            },
          },
        }),
        "maxItems",
      );
    });

    it("rejects inline array defaultValue with duplicate items when uniqueItems is true", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            codes: {
              type: "array",
              items: { type: "string" },
              uniqueItems: true,
              defaultValue: ["x", "x"],
            },
          },
        }),
        "duplicate",
      );
    });

    it("rejects inline const variable when defaultValue does not equal const", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            status: {
              type: "string",
              const: "active",
              defaultValue: "inactive",
            },
          },
        }),
        "constant",
      );
    });

    it("rejects inline enum variable when defaultValue is not in enum", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            theme: {
              type: "string",
              enum: ["light", "dark"],
              defaultValue: "blue",
            },
          },
        }),
      );
    });

    it("accepts inline oneOf variable when defaultValue matches exactly one branch", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            idOrLink: {
              oneOf: [{ type: "string" }, { schema: "link" }],
              defaultValue: "ref-123",
            },
          },
        }),
      );
    });

    it("rejects when variable has both schema reference and inline type", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "link",
              type: "object",
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
        "schema",
      );
    });

    it("rejects reserved variable key 'variation'", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            variation: { type: "string", defaultValue: "control" },
          },
        }),
        "reserved",
      );
    });
  });

  describe("variablesSchema: disabledValue", () => {
    it("accepts valid disabledValue matching variable schema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            label: {
              type: "string",
              defaultValue: "on",
              disabledValue: "off",
            },
          },
        }),
      );
    });

    it("rejects disabledValue that does not match variable schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              defaultValue: 5,
              disabledValue: 99,
            },
          },
        }),
        "maximum",
      );
    });
  });

  describe("variations: variables", () => {
    it("accepts variation variables that match variablesSchema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            label: { type: "string", defaultValue: "default" },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50, variables: { label: "treatment-label" } },
          ],
        }),
      );
    });

    it("rejects variation variable value that does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            level: { type: "integer", minimum: 1, maximum: 10, defaultValue: 1 },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50, variables: { level: 100 } },
          ],
        }),
        "maximum",
      );
    });

    it("rejects when variation uses a variable key not defined in variablesSchema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            label: { type: "string", defaultValue: "default" },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50, variables: { unknownVar: "x" } },
          ],
        }),
        "not defined in",
      );
    });
  });

  describe("variations: variableOverrides", () => {
    it("accepts variableOverrides with values matching variable schema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            slug: {
              type: "string",
              pattern: "^[a-z0-9-]+$",
              minLength: 1,
              maxLength: 20,
              defaultValue: "home",
            },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variables: { slug: "treatment" },
              variableOverrides: {
                slug: [
                  { segments: "countries/germany", value: "de" },
                  { segments: "countries/france", value: "fr" },
                ],
              },
            },
          ],
        }),
      );
    });

    it("rejects variableOverride value that does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: {
              type: "string",
              pattern: "^[a-z]+$",
              defaultValue: "home",
            },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variableOverrides: {
                slug: [{ segments: "*", value: "UPPERCASE" }],
              },
            },
          ],
        }),
        "pattern",
      );
    });

    it("rejects variableOverride for variable key not in variablesSchema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            label: { type: "string", defaultValue: "default" },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variableOverrides: {
                notDefined: [{ segments: "*", value: "x" }],
              },
            },
          ],
        }),
        "not defined in",
      );
    });

    it("validates variableOverrides even when variation has no variables", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: { type: "string", maxLength: 5, defaultValue: "home" },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variableOverrides: {
                slug: [{ segments: "*", value: "toolongvalue" }],
              },
            },
          ],
        }),
        "maxLength",
      );
    });
  });

  describe("rules: variables", () => {
    it("accepts rule variables that match variablesSchema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            title: { type: "string", defaultValue: "Default" },
          },
          rules: {
            staging: [
              { key: "r1", segments: "*", percentage: 100 },
              {
                key: "r2",
                segments: "countries/germany",
                percentage: 100,
                variables: { title: "Germany" },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("rejects rule variable value that does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            count: { type: "integer", minimum: 0, maximum: 10, defaultValue: 0 },
          },
          rules: {
            staging: [
              { key: "r1", segments: "*", percentage: 100 },
              {
                key: "r2",
                segments: "countries/germany",
                percentage: 100,
                variables: { count: 100 },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
        "maximum",
      );
    });

    it("rejects rule variable key not defined in variablesSchema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            title: { type: "string", defaultValue: "Default" },
          },
          rules: {
            staging: [
              { key: "r1", segments: "*", percentage: 100 },
              {
                key: "r2",
                segments: "countries/germany",
                percentage: 100,
                variables: { unknownVar: "x" },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
        "not defined in",
      );
    });
  });

  describe("force: variables", () => {
    it("accepts force variables that match variablesSchema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            title: { type: "string", defaultValue: "Default" },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          force: {
            staging: [
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "u1" }],
                variation: "treatment",
                variables: { title: "Forced" },
              },
            ],
            production: [],
          },
        }),
      );
    });

    it("rejects force variable value that does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            level: { type: "integer", minimum: 1, maximum: 5, defaultValue: 1 },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          force: {
            staging: [
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "u1" }],
                variation: "control",
                variables: { level: 10 },
              },
            ],
            production: [],
          },
        }),
        "maximum",
      );
    });

    it("rejects force variable key not defined in variablesSchema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            title: { type: "string", defaultValue: "Default" },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          force: {
            staging: [
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "u1" }],
                variation: "control",
                variables: { notDefined: "x" },
              },
            ],
            production: [],
          },
        }),
        "not defined in",
      );
    });
  });

  describe("oneOf: value must match exactly one branch", () => {
    it("rejects defaultValue that matches no oneOf branch", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            idOrLink: {
              oneOf: [{ type: "string" }, { schema: "link" }],
              defaultValue: 42, // number matches neither
            },
          },
        }),
      );
    });

    it("rejects defaultValue that matches more than one oneOf branch when one is string", () => {
      // If we had two branches that both accept the same value, we'd get "matched more than one"
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            idOrLink: {
              oneOf: [{ type: "string" }, { schema: "link" }],
              defaultValue: "id-1",
            },
          },
        }),
      );
    });
  });

  describe("schema reference: defaultValue resolved and validated", () => {
    it("rejects defaultValue for schema-ref variable when value violates resolved schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            slug: {
              schema: "slugSchema",
              defaultValue: "INVALID-SLUG", // pattern is ^[a-z0-9-]+$
            },
          },
        }),
      );
    });

    it("accepts defaultValue for schema-ref variable when value satisfies resolved schema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            slug: {
              schema: "slugSchema",
              defaultValue: "valid-slug",
            },
          },
        }),
      );
    });
  });
});
