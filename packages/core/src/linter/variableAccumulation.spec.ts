import type { Attribute, ParsedFeature, Schema } from "@featurevisor/types";

import type { ProjectConfig } from "../config";
import { getVariableZodSchema } from "./variableSchema";

const config = {
  environments: false,
  tags: [],
  namespaceCharacter: ".",
} as unknown as ProjectConfig;

const attributes: Record<string, Attribute> = {
  country: { type: "string", description: "Country" },
};

const features: Record<string, ParsedFeature> = {
  checkout: {
    description: "Checkout",
    variations: [{ value: "control" }],
  } as ParsedFeature,
};

function parse(value: unknown) {
  return getVariableZodSchema(
    config,
    attributes,
    ["europe"],
    features,
    {} as Record<string, Schema>,
  ).safeParse(value);
}

function arrayVariable(overrides: unknown[]) {
  return {
    description: "Numbers",
    type: "array",
    items: { type: "integer" },
    defaultValue: [1],
    overrides,
  };
}

describe("accumulating global variable overrides", () => {
  it("accepts boolean continue and keeps false on the legacy catch-all path", () => {
    expect(
      parse({
        description: "Value",
        type: "string",
        defaultValue: "default",
        overrides: [{ key: "all", conditions: "*", continue: true, value: "all" }],
      }).success,
    ).toBe(true);

    expect(
      parse({
        description: "Value",
        type: "string",
        defaultValue: "default",
        overrides: [{ key: "all", conditions: "*", continue: "yes", value: "all" }],
      }).success,
    ).toBe(false);

    expect(
      parse({
        description: "Value",
        type: "string",
        defaultValue: "default",
        overrides: [
          { key: "all", conditions: "*", continue: false, value: "all" },
          { key: "later", conditions: "europe", value: "later" },
        ],
      }).success,
    ).toBe(false);
  });

  it("allows continuing catch-alls, including in a child scope, while retaining tree-wide keys", () => {
    expect(
      parse({
        description: "Value",
        type: "string",
        defaultValue: "default",
        overrides: [
          {
            key: "parent",
            conditions: "europe",
            value: "parent",
            overrides: [
              { key: "all-child", conditions: "*", continue: true, value: "child" },
              { key: "child-after", conditions: "europe", value: "after" },
            ],
          },
          { key: "root-after", conditions: "europe", value: "root" },
        ],
      }).success,
    ).toBe(true);

    expect(
      parse({
        description: "Value",
        type: "string",
        defaultValue: "default",
        overrides: [
          {
            key: "same",
            conditions: "europe",
            continue: true,
            value: "parent",
            overrides: [{ key: "same", conditions: "europe", value: "child" }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("validates mutation operands even when their selector can never match", () => {
    const result = parse(
      arrayVariable([
        {
          key: "never",
          conditions: { and: ["europe", { not: ["europe"] }] },
          continue: true,
          mutate: { ":append": "x" },
        },
        { key: "later", conditions: "europe", value: [2] },
      ]),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join(".").includes("mutate.:append")),
      ).toBe(true);
    }
  });

  it("does not validate an ignored remove operand against the removed field schema", () => {
    expect(
      parse({
        description: "Optional settings",
        type: "object",
        additionalProperties: { type: "integer" },
        defaultValue: { count: 1 },
        overrides: [
          {
            key: "remove-count",
            conditions: "europe",
            continue: true,
            mutate: { "count:remove": "ignored" },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("validates indexed append and prepend operands against the selected array", () => {
    expect(
      parse({
        description: "Nested arrays",
        type: "array",
        items: { type: "array", items: { type: "integer" } },
        defaultValue: [[]],
        overrides: [
          {
            key: "append-inner",
            conditions: "europe",
            continue: true,
            mutate: { "[0]:append": 1 },
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      parse({
        description: "Nested rows",
        type: "object",
        properties: {
          rows: { type: "array", items: { type: "array", items: { type: "integer" } } },
        },
        required: ["rows"],
        defaultValue: { rows: [[]] },
        overrides: [
          {
            key: "prepend-inner",
            conditions: "europe",
            continue: true,
            mutate: { "rows[0]:prepend": 1 },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects indexed and selected append targets that are not arrays, even when unreachable", () => {
    const indexed = parse({
      ...arrayVariable([
        {
          key: "never",
          conditions: { and: ["europe", { not: ["europe"] }] },
          continue: true,
          mutate: { "[0]:append": 2 },
        },
      ]),
    });
    expect(indexed.success).toBe(false);

    const selected = parse({
      description: "Rows",
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["id", "tags"],
          },
        },
      },
      required: ["rows"],
      defaultValue: { rows: [{ id: "first", tags: [] }] },
      overrides: [
        {
          key: "never-selected",
          conditions: { and: ["europe", { not: ["europe"] }] },
          continue: true,
          mutate: { "rows[id=missing]:append": { id: "new", tags: [] } },
        },
      ],
    });
    expect(selected.success).toBe(false);

    expect(
      parse({
        description: "Rows",
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
              },
              required: ["id", "tags"],
            },
          },
        },
        required: ["rows"],
        defaultValue: { rows: [{ id: "first", tags: [] }] },
        overrides: [
          {
            key: "append-tags",
            conditions: "europe",
            continue: true,
            mutate: { "rows[id=first].tags:append": "x" },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects compositions whose combined reachable result violates the value schema", () => {
    const result = parse({
      ...arrayVariable([
        {
          key: "first",
          conditions: { attribute: "country", operator: "equals", value: "nl" },
          continue: true,
          mutate: { ":append": 2 },
        },
        {
          key: "second",
          conditions: { attribute: "country", operator: "equals", value: "de" },
          mutate: { ":append": 3 },
        },
      ]),
      maxItems: 2,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("maxItems"))).toBe(true);
    }
  });

  it("also catches unique-item violations formed only by composition", () => {
    const result = parse({
      ...arrayVariable([
        {
          key: "first",
          conditions: { attribute: "country", operator: "equals", value: "nl" },
          continue: true,
          mutate: { ":append": 2 },
        },
        {
          key: "second",
          conditions: { attribute: "country", operator: "equals", value: "de" },
          mutate: { ":append": 2 },
        },
      ]),
      uniqueItems: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("uniqueItems"))).toBe(true);
    }
  });

  it("does not apply a statically false continuation while exploring compositions", () => {
    expect(
      parse({
        ...arrayVariable([
          {
            key: "never",
            conditions: { and: ["europe", { not: ["europe"] }] },
            continue: true,
            mutate: { ":append": 2 },
          },
          { key: "later", conditions: "europe", mutate: { ":append": 3 } },
        ]),
        maxItems: 2,
      }).success,
    ).toBe(true);
  });

  it("reports forbidden and malformed mutation notation instead of applying it", () => {
    for (const mutationKey of ["__proto__", "[not-an-index]"]) {
      const result = parse({
        description: "Object",
        type: "object",
        properties: { items: { type: "array", items: { type: "integer" } } },
        defaultValue: { items: [] },
        overrides: [
          {
            key: "bad",
            conditions: "europe",
            continue: true,
            mutate: { [mutationKey]: 1 },
          },
        ],
      });
      expect(result.success).toBe(false);
    }
  });

  it("bounds dynamic composition exploration", () => {
    const overrides = Array.from({ length: 13 }, (_, index) => ({
      key: `step-${index}`,
      conditions: { attribute: "country", operator: "equals", value: `country-${index}` },
      continue: true,
      mutate: { ":append": index },
    }));
    const result = parse({
      ...arrayVariable(overrides),
      maxItems: 20,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("state budget"))).toBe(
        true,
      );
    }
  });

  it("leaves a non-continuing override on its established validation behaviour", () => {
    expect(
      parse({
        description: "Settings",
        type: "object",
        properties: { title: { type: "string" }, count: { type: "integer" } },
        required: ["title", "count"],
        defaultValue: { title: "Default", count: 1 },
        overrides: [
          { key: "europe", conditions: "europe", mutate: { title: "Europe", count: 2 } },
          { key: "fallback", conditions: "*", value: { title: "Fallback", count: 3 } },
        ],
      }).success,
    ).toBe(true);
  });
});
