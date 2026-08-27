import type { Attribute, ParsedFeature, Schema } from "@featurevisor/types";

import type { ProjectConfig } from "../config";
import { getVariableZodSchema } from "./variableSchema";

const config = {
  environments: ["staging", "production"],
  tags: ["web", "shared"],
  namespaceCharacter: ".",
} as ProjectConfig;
const attributes: Record<string, Attribute> = {
  country: { type: "string", description: "Country" },
};
const features: Record<string, ParsedFeature> = {
  checkout: {
    description: "Checkout",
    variations: [{ value: "control" }, { value: "treatment" }],
  } as ParsedFeature,
  archived: { description: "Archived", archived: true } as ParsedFeature,
};
const schemas: Record<string, Schema> = {
  banner: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  },
};

function parse(value: unknown) {
  return getVariableZodSchema(config, attributes, ["europe"], features, schemas).safeParse(value);
}

describe("global variable schema", () => {
  it("accepts inline and referenced schemas with environment overrides", () => {
    expect(
      parse({
        description: "Support email",
        tags: ["shared"],
        type: "string",
        defaultValue: "help@example.com",
        requiredFeatures: [{ feature: "checkout", variation: "treatment" }],
        overrides: {
          production: [
            { key: "europe", segments: "europe", value: "eu@example.com" },
            {
              key: "nl",
              conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
              value: "nl@example.com",
            },
          ],
        },
      }).success,
    ).toBe(true);

    expect(
      parse({
        description: "Banner",
        schema: "banner",
        defaultValue: { title: "Hello" },
        overrides: { staging: [{ key: "all", segments: "*", mutate: { title: "Hi" } }] },
      }).success,
    ).toBe(true);
  });

  it("accepts oneOf when the value matches exactly one branch", () => {
    expect(
      parse({
        description: "External identifier",
        oneOf: [{ type: "string" }, { type: "integer" }],
        defaultValue: "anonymous",
        overrides: {
          production: [{ key: "numeric", segments: "europe", value: 42 }],
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    ["boolean", { type: "boolean", defaultValue: true }],
    ["integer", { type: "integer", minimum: 1, maximum: 5, defaultValue: 3 }],
    ["double", { type: "double", defaultValue: 1.5 }],
    ["string", { type: "string", minLength: 2, maxLength: 5, defaultValue: "okay" }],
    [
      "array",
      {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        uniqueItems: true,
        defaultValue: ["one"],
      },
    ],
    [
      "object",
      {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        defaultValue: { title: "Hello" },
      },
    ],
    ["json", { type: "json", defaultValue: '{"arbitrary":[true,1,"value"]}' }],
  ])("accepts a valid %s definition", (_type, definition) => {
    expect(parse({ description: "Typed variable", ...definition }).success).toBe(true);
  });

  it("rejects mixed, unmatched, and ambiguous oneOf roots", () => {
    expect(
      parse({
        description: "Mixed",
        type: "string",
        oneOf: [{ type: "string" }],
        defaultValue: "value",
      }).success,
    ).toBe(false);
    expect(
      parse({
        description: "Unmatched",
        oneOf: [{ type: "string" }, { type: "integer" }],
        defaultValue: false,
      }).success,
    ).toBe(false);
    expect(
      parse({
        description: "Ambiguous",
        oneOf: [{ type: "integer" }, { type: "double" }],
        defaultValue: 1,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["unknown tag", { tags: ["unknown"] }],
    ["missing type", { type: undefined }],
    ["mixed schema forms", { type: "object", schema: "banner" }],
    ["invalid default", { type: "integer", defaultValue: "five" }],
    ["archived required feature", { requiredFeatures: ["archived"] }],
    ["unknown required variation", { requiredFeatures: [{ feature: "checkout", variation: "x" }] }],
  ])("rejects %s", (_label, changes) => {
    const value = {
      description: "Variable",
      type: "string",
      defaultValue: "value",
      ...changes,
    };
    expect(parse(value).success).toBe(false);
  });

  it("requires keyed, explicitly targeted overrides with exactly one value operation", () => {
    const base = { description: "Variable", type: "string", defaultValue: "value" };
    expect(
      parse({ ...base, overrides: { staging: [{ segments: "*", value: "x" }] } }).success,
    ).toBe(false);
    expect(parse({ ...base, overrides: { staging: [{ key: "x", value: "x" }] } }).success).toBe(
      false,
    );
    expect(
      parse({
        ...base,
        overrides: {
          staging: [{ key: "x", segments: "*", value: "x", mutate: { value: "y" } }],
        },
      }).success,
    ).toBe(false);
  });

  it("validates disabled values, override values, environments, and mutation results", () => {
    const objectVariable = {
      description: "Settings",
      type: "object",
      properties: {
        title: { type: "string" },
        count: { type: "integer" },
      },
      required: ["title", "count"],
      defaultValue: { title: "Default", count: 1 },
    };

    expect(parse({ ...objectVariable, disabledValue: { title: "Missing count" } }).success).toBe(
      false,
    );
    expect(
      parse({
        ...objectVariable,
        overrides: {
          production: [{ key: "wrong", segments: "*", value: { title: "Missing count" } }],
        },
      }).success,
    ).toBe(false);
    expect(
      parse({
        ...objectVariable,
        overrides: {
          production: [{ key: "wrong", segments: "*", mutate: { count: "not-an-integer" } }],
        },
      }).success,
    ).toBe(false);
    expect(
      parse({
        ...objectVariable,
        overrides: {
          unknown: [
            { key: "wrong-environment", segments: "*", value: objectVariable.defaultValue },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("accepts direct override arrays when the project has no environments", () => {
    const environmentlessConfig = {
      ...config,
      environments: false,
    } as unknown as ProjectConfig;
    const result = getVariableZodSchema(
      environmentlessConfig,
      attributes,
      ["europe"],
      features,
      schemas,
    ).safeParse({
      description: "Environmentless",
      type: "string",
      defaultValue: "default",
      overrides: [
        { key: "europe", segments: "europe", value: "Europe" },
        { key: "fallback", segments: "*", value: "Fallback" },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("supports requiredFeatures as a direct selector and alongside one other selector", () => {
    const base = { description: "Variable", type: "string", defaultValue: "value" };
    const validOverrides = [
      { key: "required", requiredFeatures: "checkout", value: "x" },
      {
        key: "conditions",
        conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
        requiredFeatures: [{ feature: "checkout", enabled: false, variation: "control" }],
        value: "x",
      },
      {
        key: "segments",
        segments: "europe",
        requiredFeatures: ["checkout"],
        value: "x",
      },
    ];

    for (const override of validOverrides) {
      expect(parse({ ...base, overrides: { production: [override] } }).success).toBe(true);
    }

    expect(
      parse({
        ...base,
        overrides: {
          production: [
            {
              key: "invalid",
              segments: "europe",
              conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
              value: "x",
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      parse({
        ...base,
        overrides: { production: [{ key: "empty", requiredFeatures: [], value: "x" }] },
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate keys, non-final catch-alls, and invalid mutation paths", () => {
    const base = { description: "Variable", type: "string", defaultValue: "value" };
    expect(
      parse({
        ...base,
        overrides: {
          staging: [
            { key: "same", segments: "europe", value: "a" },
            { key: "same", segments: "*", value: "b" },
          ],
        },
      }).success,
    ).toBe(false);
    for (const segments of [["*"], { or: ["europe", "*"] }, { not: [{ not: ["*"] }] }]) {
      expect(
        parse({
          ...base,
          overrides: {
            staging: [
              { key: "all", segments, value: "a" },
              { key: "later", segments: "europe", value: "b" },
            ],
          },
        }).success,
      ).toBe(false);
    }
    for (const conditions of [
      ["*"],
      {
        or: [{ attribute: "country", operator: "equals", value: "de" }, "*"],
      },
      { not: [{ not: ["*"] }] },
    ]) {
      expect(
        parse({
          ...base,
          overrides: {
            staging: [
              { key: "all", conditions, value: "a" },
              {
                key: "later",
                conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
                value: "b",
              },
            ],
          },
        }).success,
      ).toBe(false);
    }
    expect(
      parse({
        ...base,
        overrides: {
          staging: [
            { key: "all", segments: "*", value: "a" },
            { key: "later", segments: "europe", value: "b" },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      parse({
        description: "Object",
        type: "object",
        properties: { title: { type: "string" } },
        defaultValue: { title: "Hello" },
        overrides: {
          staging: [{ key: "bad", segments: "*", mutate: { unknown: "x" } }],
        },
      }).success,
    ).toBe(false);

    expect(
      parse({
        ...base,
        overrides: {
          staging: [
            { key: "never", segments: { not: ["*"] }, value: "never" },
            { key: "later", segments: "europe", value: "later" },
          ],
        },
      }).success,
    ).toBe(true);
  });
});
