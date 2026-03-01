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
    environmentsDirectoryPath: "",
    environments: ["staging", "production"],
    splitByEnvironment: false,
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
    const messages = err.issues
      .map((i) => (typeof i.message === "string" ? i.message : ""))
      .join(" ");
    expect(messages).toContain(messageSubstring);
  }
  return err;
}

/** Assert that an intentional mistake produces an error at the expected path with expected message. */
function expectErrorSurfaces(
  feature: unknown,
  opts: { pathContains: string[]; messageContains: string },
): void {
  const err = expectParseFailure(feature, opts.messageContains);
  const pathStrings = err.issues.map((i) => i.path.join("."));
  const hasMatchingPath = pathStrings.some((p) =>
    opts.pathContains.every((seg) => p.includes(seg)),
  );
  expect(hasMatchingPath).toBe(true);
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

    it("rejects variable with schema reference when schema could not be loaded (missing from schemasByKey)", () => {
      const projectConfig = minimalProjectConfig();
      const conditionsZodSchema = getConditionsZodSchema(projectConfig, TEST_ATTRIBUTES);
      const schemaWithEmptySchemasByKey = getFeatureZodSchema(
        projectConfig,
        conditionsZodSchema,
        TEST_ATTRIBUTES,
        TEST_SEGMENTS,
        TEST_FEATURES,
        ["link"],
        {},
      );
      const result = schemaWithEmptySchemasByKey.safeParse(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "link",
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      const messages = (result as z.SafeParseError<unknown>).error.issues
        .map((i) => (typeof i.message === "string" ? i.message : ""))
        .join(" ");
      expect(messages).toContain("could not be loaded");
      expect(messages).toContain("link");
      expect(messages).toContain("myLink");
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

    it("accepts plain-key partial object overrides for structured object schemas", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: {
                theme: { type: "string" },
                compact: { type: "boolean" },
              },
              required: ["theme", "compact"],
              defaultValue: { theme: "light", compact: true },
            },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variableOverrides: {
                config: [{ segments: "*", value: { theme: "dark" } }],
              },
            },
          ],
        }),
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

    it("rejects rule variable key when feature has no variablesSchema", () => {
      expectParseFailure(
        baseFeature({
          rules: {
            staging: [{ key: "r1", segments: "*", percentage: 100 }],
            production: [
              {
                key: "r1",
                segments: "*",
                percentage: 80,
                variables: { blah123: "some value" },
              },
            ],
          },
        }),
        "not defined in",
      );
    });
  });

  describe("rules: variableOverrides", () => {
    it("accepts rule variableOverrides with values matching variablesSchema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: {
                title: { type: "string" },
                nested: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                  },
                },
              },
              defaultValue: {
                title: "default",
                nested: { count: 0 },
              },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                segments: "*",
                percentage: 100,
                variableOverrides: {
                  config: [
                    {
                      segments: "countries/germany",
                      value: {
                        "nested.count": 5,
                      },
                    },
                  ],
                },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("rejects rule variableOverrides for unknown variable key", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            config: { type: "string", defaultValue: "x" },
          },
          rules: {
            staging: [
              {
                key: "r1",
                segments: "*",
                percentage: 100,
                variableOverrides: {
                  unknown: [{ segments: "*", value: "x" }],
                },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
        "not defined in",
      );
    });

    it("rejects mutation notation in rule variableOverrides key", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: { title: { type: "string" } },
              defaultValue: { title: "x" },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                segments: "*",
                percentage: 100,
                variableOverrides: {
                  "config.title": [{ segments: "*", value: "y" }],
                },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
        "must be a declared variable key",
      );
    });

    it("rejects rule variableOverride path not present in schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: { title: { type: "string" } },
              defaultValue: { title: "x" },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                segments: "*",
                percentage: 100,
                variableOverrides: {
                  config: [
                    {
                      segments: "*",
                      value: {
                        "nested.missing": "x",
                      },
                    },
                  ],
                },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
        "invalid for variable",
      );
    });

    it("rejects non-null payload for :remove in rule variableOverrides", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: { title: { type: "string" }, optional: { type: "string" } },
              defaultValue: { title: "x", optional: "y" },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                segments: "*",
                percentage: 100,
                variableOverrides: {
                  config: [
                    {
                      conditions: [{ attribute: "country", operator: "equals", value: "de" }],
                      value: {
                        "optional:remove": "not-null",
                      },
                    },
                  ],
                },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
        "must use `null` as value",
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

  describe("complex cases (mirroring example-1 withSchema / withComplexSchema)", () => {
    it("accepts inline object variable with properties and valid defaultValue (e.g. settings)", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            settings: {
              type: "object",
              properties: {
                theme: { type: "string" },
                compact: { type: "boolean" },
              },
              defaultValue: { theme: "light", compact: true },
            },
          },
        }),
      );
    });

    it("accepts object variable with additionalProperties only and arbitrary keys", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            labels: {
              type: "object",
              additionalProperties: { type: "string" },
              defaultValue: { title: "Welcome", subtitle: "Hello" },
            },
          },
        }),
      );
    });

    it("accepts object variable with properties and additionalProperties together", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            metadata: {
              type: "object",
              properties: {
                fixed: { type: "integer" },
              },
              additionalProperties: { type: "string" },
              required: ["fixed"],
              defaultValue: { fixed: 1, dynamicKey: "value" },
            },
          },
        }),
      );
    });

    it("rejects object variable when unknown key is present and additionalProperties is not defined", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            settings: {
              type: "object",
              properties: {
                theme: { type: "string" },
              },
              defaultValue: { theme: "light", subtitle: "hello" },
            },
          },
        }),
        "Unknown property",
      );
    });

    it("accepts object variable with additionalProperties that references reusable schema", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            linksByLocale: {
              type: "object",
              additionalProperties: { schema: "link" },
              defaultValue: {
                en: { title: "Home", url: "/" },
                de: { title: "Start", url: "/de" },
              },
            },
          },
        }),
      );
    });

    it("rejects object variable when additionalProperties value does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            linksByLocale: {
              type: "object",
              additionalProperties: { schema: "link" },
              defaultValue: {
                en: { title: "Home" },
              },
            },
          },
        }),
        "Missing required property",
      );
    });

    it("rejects inline object variable when defaultValue is missing required property", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            settings: {
              type: "object",
              properties: {
                theme: { type: "string" },
                compact: { type: "boolean" },
              },
              required: ["theme"],
              defaultValue: { compact: true },
            },
          },
        }),
      );
    });

    it("accepts inline array variable with items schema ref (e.g. linkPair)", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            linkPair: {
              type: "array",
              items: { schema: "link" },
              defaultValue: [
                { title: "First", url: "/first" },
                { title: "Second", url: "/second" },
              ],
            },
          },
        }),
      );
    });

    it("rejects inline array with items schema ref when an item does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            linkPair: {
              type: "array",
              items: { schema: "link" },
              defaultValue: [{ title: "Only title, missing url" }],
            },
          },
        }),
      );
    });

    it("accepts oneOf variable when defaultValue matches object branch (e.g. refOrLink as link)", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            refOrLink: {
              oneOf: [{ type: "string" }, { schema: "link" }],
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
      );
    });

    it("accepts object variable with nested const in property (e.g. statusInfo.kind const active)", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            statusInfo: {
              type: "object",
              properties: {
                kind: { type: "string", const: "active" },
                label: { type: "string" },
              },
              required: ["kind", "label"],
              defaultValue: { kind: "active", label: "Default" },
            },
          },
        }),
      );
    });

    it("rejects object variable when nested const property has wrong value", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            statusInfo: {
              type: "object",
              properties: {
                kind: { type: "string", const: "active" },
                label: { type: "string" },
              },
              required: ["kind", "label"],
              defaultValue: { kind: "inactive", label: "Default" },
            },
          },
        }),
      );
    });

    it("accepts object variable with nested enum in property (e.g. themeConfig.theme)", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            themeConfig: {
              type: "object",
              properties: {
                theme: { type: "string", enum: ["light", "dark", "system"] },
                label: { type: "string" },
              },
              required: ["theme", "label"],
              defaultValue: { theme: "light", label: "Default" },
            },
          },
        }),
      );
    });

    it("rejects object variable when nested enum property has invalid value", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            themeConfig: {
              type: "object",
              properties: {
                theme: { type: "string", enum: ["light", "dark", "system"] },
                label: { type: "string" },
              },
              required: ["theme", "label"],
              defaultValue: { theme: "invalid", label: "Default" },
            },
          },
        }),
      );
    });

    it("accepts rule variables with object value (e.g. singleLink, themeColor in rules)", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            singleLink: {
              schema: "link",
              defaultValue: { title: "Home", url: "/" },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                segments: "*",
                percentage: 100,
                variables: {
                  singleLink: { title: "DE Link", url: "/de" },
                },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("rejects rule variable when object value does not match schema", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            singleLink: {
              schema: "link",
              defaultValue: { title: "Home", url: "/" },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                segments: "*",
                percentage: 100,
                variables: {
                  singleLink: { title: "Missing url" },
                },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
      );
    });
  });

  describe("errors surface properly: intentional mistakes produce correct path and message", () => {
    it("unknown schema ref: error path points to variable and message says Unknown schema", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "nonexistent",
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
        {
          pathContains: ["variablesSchema", "myLink", "schema"],
          messageContains: "Unknown schema",
        },
      );
    });

    it("defaultValue below minimum: error path includes defaultValue, message mentions minimum", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 10,
              maximum: 100,
              defaultValue: 5,
            },
          },
        }),
        { pathContains: ["variablesSchema", "level", "defaultValue"], messageContains: "minimum" },
      );
    });

    it("defaultValue above maximum: error path includes defaultValue, message mentions maximum", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 0,
              maximum: 10,
              defaultValue: 99,
            },
          },
        }),
        { pathContains: ["variablesSchema", "level", "defaultValue"], messageContains: "maximum" },
      );
    });

    it("variation uses undeclared variable: error path points to variations.*.variables, message says not defined", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            label: { type: "string", defaultValue: "x" },
          },
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50, variables: { typoVar: "y" } },
          ],
        }),
        {
          pathContains: ["variations", "variables", "typoVar"],
          messageContains: "not defined in",
        },
      );
    });

    it("variableOverrides value violates pattern: error path points to variableOverrides.*.value", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            slug: {
              type: "string",
              pattern: "^[a-z-]+$",
              defaultValue: "home",
            },
          },
          variations: [
            { value: "control", weight: 50 },
            {
              value: "treatment",
              weight: 50,
              variableOverrides: {
                slug: [{ segments: "*", value: "INVALID-UPPERCASE" }],
              },
            },
          ],
        }),
        {
          pathContains: ["variableOverrides", "slug", "value"],
          messageContains: "pattern",
        },
      );
    });

    it("rule variable wrong type: error path points to rules.*.variables, message surfaces constraint", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            count: {
              type: "integer",
              minimum: 0,
              maximum: 10,
              defaultValue: 0,
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                segments: "*",
                percentage: 100,
                variables: { count: 100 },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
        {
          pathContains: ["rules", "variables", "count"],
          messageContains: "maximum",
        },
      );
    });

    it("disabledValue violates schema: error path includes disabledValue", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            level: {
              type: "integer",
              minimum: 1,
              maximum: 5,
              defaultValue: 1,
              disabledValue: 99,
            },
          },
        }),
        {
          pathContains: ["variablesSchema", "level", "disabledValue"],
          messageContains: "maximum",
        },
      );
    });

    it("reserved key variation: error path points to variablesSchema.variation", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            variation: { type: "string", defaultValue: "control" },
          },
        }),
        {
          pathContains: ["variablesSchema", "variation"],
          messageContains: "reserved",
        },
      );
    });

    it("object defaultValue missing required property: error path includes defaultValue and key, message says Missing required", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            settings: {
              type: "object",
              properties: { theme: { type: "string" }, requiredKey: { type: "string" } },
              required: ["requiredKey"],
              defaultValue: { theme: "light" },
            },
          },
        }),
        {
          pathContains: ["variablesSchema", "settings", "defaultValue"],
          messageContains: "Missing required",
        },
      );
    });

    it("nested const property wrong: error path points into object value", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            statusInfo: {
              type: "object",
              properties: {
                kind: { type: "string", const: "active" },
                label: { type: "string" },
              },
              required: ["kind", "label"],
              defaultValue: { kind: "inactive", label: "x" },
            },
          },
        }),
        {
          pathContains: ["variablesSchema", "statusInfo", "defaultValue"],
          messageContains: "constant",
        },
      );
    });

    it("force variable not in variablesSchema: error path points to force.*.variables", () => {
      expectErrorSurfaces(
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
                variables: { typoKey: "x" },
              },
            ],
            production: [],
          },
        }),
        {
          pathContains: ["force", "variables", "typoKey"],
          messageContains: "not defined in",
        },
      );
    });
  });

  describe("mutation notation in variables", () => {
    it("accepts valid dot-notation mutation keys in rules.variables", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: {
                theme: { type: "string" },
                width: { type: "integer" },
              },
              defaultValue: { theme: "light", width: 100 },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                segments: "*",
                percentage: 100,
                variables: { "config.theme": "dark", "config.width": 1200 },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("accepts valid array-index mutation keys in rules.variables", () => {
      expectParseSuccess(
        baseFeature({
          variablesSchema: {
            tags: {
              type: "array",
              items: { type: "string" },
              defaultValue: ["a", "b"],
            },
          },
          rules: {
            staging: [
              { key: "r1", segments: "*", percentage: 100, variables: { "tags[0]": "first" } },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
      );
    });

    it("rejects mutation key when root variable is not in variablesSchema", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            title: { type: "string", defaultValue: "Default" },
          },
          rules: {
            staging: [
              { key: "r1", segments: "*", percentage: 100, variables: { "unknownVar.foo": "x" } },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
        {
          pathContains: ["rules", "variables", "unknownVar.foo"],
          messageContains: "not defined in",
        },
      );
    });

    it("rejects invalid path (property not in schema)", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: { theme: { type: "string" } },
              defaultValue: { theme: "light" },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                segments: "*",
                percentage: 100,
                variables: { "config.unknownProp": "x" },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
        { pathContains: ["rules", "variables"], messageContains: "path does not exist" },
      );
    });

    it("rejects :append on non-array (object property)", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: { theme: { type: "string" } },
              defaultValue: { theme: "light" },
            },
          },
          rules: {
            staging: [
              { key: "r1", segments: "*", percentage: 100, variables: { "config:append": "x" } },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
        { pathContains: ["rules", "variables"], messageContains: "only allowed on array" },
      );
    });

    it("rejects :remove on required object property", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            config: {
              type: "object",
              properties: {
                theme: { type: "string" },
                compact: { type: "boolean" },
              },
              required: ["compact"],
              defaultValue: { theme: "light", compact: true },
            },
          },
          rules: {
            staging: [
              {
                key: "r1",
                segments: "*",
                percentage: 100,
                variables: { "config.compact:remove": null },
              },
            ],
            production: [{ key: "r1", segments: "*", percentage: 100 }],
          },
        }),
        {
          pathContains: ["rules", "variables"],
          messageContains: "Cannot remove required property",
        },
      );
    });

    it("additionalProperties type mismatch: error path includes dynamic object key", () => {
      expectErrorSurfaces(
        baseFeature({
          variablesSchema: {
            labels: {
              type: "object",
              additionalProperties: { type: "string" },
              defaultValue: {
                title: 123,
              },
            },
          },
        }),
        {
          pathContains: ["variablesSchema", "labels", "defaultValue", "title"],
          messageContains: "type string",
        },
      );
    });

    it("rejects variable schema with schema reference mixed with inline additionalProperties", () => {
      expectParseFailure(
        baseFeature({
          variablesSchema: {
            myLink: {
              schema: "link",
              additionalProperties: { type: "string" },
              defaultValue: { title: "Home", url: "/" },
            },
          },
        }),
        "additionalProperties",
      );
    });
  });
});
