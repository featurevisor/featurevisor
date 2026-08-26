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
        requiredFeatures: [{ key: "checkout", variation: "treatment" }],
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
    ["unknown required variation", { requiredFeatures: [{ key: "checkout", variation: "x" }] }],
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
  });
});
