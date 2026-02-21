/**
 * Unit tests for standalone schema validation (schemas/*.yml).
 * Covers getSchemaZodSchema and the refinement helpers: refineEnumMatchesType,
 * refineMinimumMaximum, refineStringLengthPattern, refineArrayItems.
 */
import { z } from "zod";

import {
  refineEnumMatchesType,
  refineMinimumMaximum,
  refineStringLengthPattern,
  refineArrayItems,
  getSchemaZodSchema,
  valueZodSchema,
  propertyTypeEnum,
} from "./schema";

/** Build a refinement context that collects issues for assertion. */
function createRefinementCtx(): { issues: z.ZodIssue[]; ctx: z.RefinementCtx } {
  const issues: z.ZodIssue[] = [];
  const ctx: z.RefinementCtx = {
    path: [],
    addIssue(issue: z.ZodIssue) {
      issues.push(issue);
    },
  };
  return { issues, ctx };
}

/** Return human-readable message from a Zod issue (custom or default). */
function issueMessage(issue: z.ZodIssue): string {
  if (issue.code === z.ZodIssueCode.custom && typeof issue.message === "string") {
    return issue.message;
  }
  return issue.message ?? "";
}

describe("schema.ts :: valueZodSchema and propertyTypeEnum", () => {
  describe("valueZodSchema", () => {
    it("accepts boolean, string, number", () => {
      expect(valueZodSchema.safeParse(true).success).toBe(true);
      expect(valueZodSchema.safeParse("x").success).toBe(true);
      expect(valueZodSchema.safeParse(1).success).toBe(true);
    });

    it("accepts plain objects and arrays of values", () => {
      expect(valueZodSchema.safeParse({ a: 1 }).success).toBe(true);
      expect(valueZodSchema.safeParse([1, "b"]).success).toBe(true);
    });

    it("rejects null at top level", () => {
      const r = valueZodSchema.safeParse(null);
      expect(r.success).toBe(false);
    });
  });

  describe("propertyTypeEnum", () => {
    it("accepts allowed types", () => {
      expect(propertyTypeEnum.safeParse("string").success).toBe(true);
      expect(propertyTypeEnum.safeParse("array").success).toBe(true);
      expect(propertyTypeEnum.safeParse("object").success).toBe(true);
    });

    it("rejects invalid type", () => {
      expect(propertyTypeEnum.safeParse("date").success).toBe(false);
    });
  });
});

describe("schema.ts :: refineEnumMatchesType", () => {
  it("adds no issue when enum values match type string", () => {
    const { issues, ctx } = createRefinementCtx();
    refineEnumMatchesType({ type: "string", enum: ["a", "b"] }, [], ctx);
    expect(issues).toHaveLength(0);
  });

  it("adds no issue when enum values match type integer", () => {
    const { issues, ctx } = createRefinementCtx();
    refineEnumMatchesType({ type: "integer", enum: [1, 2, 3] }, [], ctx);
    expect(issues).toHaveLength(0);
  });

  it("adds issue when an enum value does not match type", () => {
    const { issues, ctx } = createRefinementCtx();
    refineEnumMatchesType({ type: "string", enum: ["a", 2, "c"] }, [], ctx);
    expect(issues).toHaveLength(1);
    expect(issueMessage(issues[0])).toContain("index 1");
    expect(issueMessage(issues[0])).toContain("does not match type \"string\"");
    expect(issues[0].path).toEqual(["enum", 1]);
  });

  it("adds issue for each enum value that does not match type", () => {
    const { issues, ctx } = createRefinementCtx();
    refineEnumMatchesType({ type: "boolean", enum: [true, "yes", false] }, [], ctx);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues.some((i) => issueMessage(i).includes("index 1"))).toBe(true);
  });

  it("recurses into items and adds issue for enum mismatch in items", () => {
    const { issues, ctx } = createRefinementCtx();
    refineEnumMatchesType(
      {
        type: "array",
        items: { type: "integer", enum: [1, "two", 3] },
      },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["items", "enum", 1]);
  });

  it("recurses into properties and adds issue for enum mismatch in property", () => {
    const { issues, ctx } = createRefinementCtx();
    refineEnumMatchesType(
      {
        type: "object",
        properties: {
          level: { type: "integer", enum: [1, 2, 3.5] },
        },
      },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["properties", "level", "enum", 2]);
  });

  it("recurses into oneOf branches", () => {
    const { issues, ctx } = createRefinementCtx();
    refineEnumMatchesType(
      {
        oneOf: [
          { type: "string", enum: ["a", "b"] },
          { type: "integer", enum: [1, "two"] },
        ],
      },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["oneOf", 1, "enum", 1]);
  });

  it("does nothing when schema is null or not an object", () => {
    const { issues: i1, ctx: c1 } = createRefinementCtx();
    refineEnumMatchesType(null as any, [], c1);
    expect(i1).toHaveLength(0);
    const { issues: i2, ctx: c2 } = createRefinementCtx();
    refineEnumMatchesType({ type: "string" }, [], c2);
    expect(i2).toHaveLength(0);
  });
});

describe("schema.ts :: refineMinimumMaximum", () => {
  it("adds no issue when minimum <= maximum", () => {
    const { issues, ctx } = createRefinementCtx();
    refineMinimumMaximum({ type: "integer", minimum: 0, maximum: 10 }, [], ctx);
    expect(issues).toHaveLength(0);
  });

  it("adds issue when minimum > maximum for integer", () => {
    const { issues, ctx } = createRefinementCtx();
    refineMinimumMaximum({ type: "integer", minimum: 10, maximum: 5 }, [], ctx);
    expect(issues).toHaveLength(1);
    expect(issueMessage(issues[0])).toContain("minimum");
    expect(issueMessage(issues[0])).toContain("maximum");
    expect(issues[0].path).toEqual(["minimum"]);
  });

  it("adds issue when minimum > maximum for double", () => {
    const { issues, ctx } = createRefinementCtx();
    refineMinimumMaximum({ type: "double", minimum: 1.5, maximum: 1.0 }, [], ctx);
    expect(issues).toHaveLength(1);
  });

  it("adds issue when const is less than minimum", () => {
    const { issues, ctx } = createRefinementCtx();
    refineMinimumMaximum({ type: "integer", minimum: 10, const: 5 }, [], ctx);
    expect(issues).toHaveLength(1);
    expect(issueMessage(issues[0])).toContain("const");
    expect(issueMessage(issues[0])).toContain("minimum");
  });

  it("adds issue when const is greater than maximum", () => {
    const { issues, ctx } = createRefinementCtx();
    refineMinimumMaximum({ type: "integer", maximum: 10, const: 15 }, [], ctx);
    expect(issues).toHaveLength(1);
  });

  it("adds issue when an enum value is out of range", () => {
    const { issues, ctx } = createRefinementCtx();
    refineMinimumMaximum(
      { type: "integer", minimum: 1, maximum: 5, enum: [1, 3, 10] },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issueMessage(issues[0])).toContain("index 2");
    expect(issueMessage(issues[0])).toContain("maximum");
  });

  it("does nothing for non-numeric types", () => {
    const { issues, ctx } = createRefinementCtx();
    refineMinimumMaximum({ type: "string", minimum: 0, maximum: 10 }, [], ctx);
    expect(issues).toHaveLength(0);
  });

  it("recurses into items", () => {
    const { issues, ctx } = createRefinementCtx();
    refineMinimumMaximum(
      {
        type: "array",
        items: { type: "integer", minimum: 20, maximum: 10 },
      },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["items", "minimum"]);
  });
});

describe("schema.ts :: refineStringLengthPattern", () => {
  it("adds no issue when minLength <= maxLength", () => {
    const { issues, ctx } = createRefinementCtx();
    refineStringLengthPattern({ type: "string", minLength: 1, maxLength: 10 }, [], ctx);
    expect(issues).toHaveLength(0);
  });

  it("adds issue when minLength > maxLength", () => {
    const { issues, ctx } = createRefinementCtx();
    refineStringLengthPattern({ type: "string", minLength: 10, maxLength: 5 }, [], ctx);
    expect(issues).toHaveLength(1);
    expect(issueMessage(issues[0])).toContain("minLength");
    expect(issues[0].path).toEqual(["minLength"]);
  });

  it("adds issue when pattern is invalid regex", () => {
    const { issues, ctx } = createRefinementCtx();
    refineStringLengthPattern({ type: "string", pattern: "[" }, [], ctx);
    expect(issues).toHaveLength(1);
    expect(issueMessage(issues[0])).toContain("pattern");
    expect(issueMessage(issues[0])).toContain("invalid");
  });

  it("adds no issue when pattern is valid", () => {
    const { issues, ctx } = createRefinementCtx();
    refineStringLengthPattern({ type: "string", pattern: "^[a-z]+$" }, [], ctx);
    expect(issues).toHaveLength(0);
  });

  it("adds issue when const string is shorter than minLength", () => {
    const { issues, ctx } = createRefinementCtx();
    refineStringLengthPattern({ type: "string", minLength: 5, const: "ab" }, [], ctx);
    expect(issues).toHaveLength(1);
    expect(issueMessage(issues[0])).toContain("const");
  });

  it("adds issue when const string is longer than maxLength", () => {
    const { issues, ctx } = createRefinementCtx();
    refineStringLengthPattern({ type: "string", maxLength: 2, const: "hello" }, [], ctx);
    expect(issues).toHaveLength(1);
  });

  it("adds issue when const string does not match pattern", () => {
    const { issues, ctx } = createRefinementCtx();
    refineStringLengthPattern(
      { type: "string", pattern: "^[0-9]+$", const: "abc" },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issueMessage(issues[0])).toContain("pattern");
  });

  it("adds issue when an enum string value violates length or pattern", () => {
    const { issues, ctx } = createRefinementCtx();
    refineStringLengthPattern(
      { type: "string", maxLength: 2, enum: ["a", "abc", "b"] },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issueMessage(issues[0])).toContain("index 1");
  });

  it("recurses into items and properties", () => {
    const { issues, ctx } = createRefinementCtx();
    refineStringLengthPattern(
      {
        type: "object",
        properties: {
          code: { type: "string", minLength: 10, maxLength: 5 },
        },
      },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["properties", "code", "minLength"]);
  });
});

describe("schema.ts :: refineArrayItems", () => {
  it("adds no issue when minItems <= maxItems", () => {
    const { issues, ctx } = createRefinementCtx();
    refineArrayItems({ type: "array", minItems: 0, maxItems: 10 }, [], ctx);
    expect(issues).toHaveLength(0);
  });

  it("adds issue when minItems > maxItems", () => {
    const { issues, ctx } = createRefinementCtx();
    refineArrayItems({ type: "array", minItems: 10, maxItems: 5 }, [], ctx);
    expect(issues).toHaveLength(1);
    expect(issueMessage(issues[0])).toContain("minItems");
    expect(issues[0].path).toEqual(["minItems"]);
  });

  it("adds issue when const array length is less than minItems", () => {
    const { issues, ctx } = createRefinementCtx();
    refineArrayItems(
      { type: "array", minItems: 3, const: [1, 2] },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issueMessage(issues[0])).toContain("minItems");
  });

  it("adds issue when const array length is greater than maxItems", () => {
    const { issues, ctx } = createRefinementCtx();
    refineArrayItems(
      { type: "array", maxItems: 2, const: [1, 2, 3] },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
  });

  it("adds issue when uniqueItems is true and const array has duplicates", () => {
    const { issues, ctx } = createRefinementCtx();
    refineArrayItems(
      { type: "array", uniqueItems: true, const: [1, 2, 1] },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issueMessage(issues[0])).toContain("duplicate");
  });

  it("adds issue when uniqueItems is true and enum array value has duplicates", () => {
    const { issues, ctx } = createRefinementCtx();
    refineArrayItems(
      { type: "array", uniqueItems: true, enum: [[1, 2], [3, 3], [4, 5]] },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["enum", 1]);
  });

  it("recurses into items", () => {
    const { issues, ctx } = createRefinementCtx();
    refineArrayItems(
      {
        type: "array",
        items: { type: "array", minItems: 5, maxItems: 2 },
      },
      [],
      ctx,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["items", "minItems"]);
  });
});

describe("schema.ts :: getSchemaZodSchema", () => {
  it("accepts a minimal valid schema with type and items for array", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({
      type: "array",
      items: { type: "string" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a schema with description only (no type)", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({ description: "A schema" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown schema reference when key not in schemaKeys", () => {
    const Schema = getSchemaZodSchema(["link", "color"]);
    const result = Schema.safeParse({ schema: "nonexistent" });
    expect(result.success).toBe(false);
    const err = !result.success ? (result as z.SafeParseError<unknown>).error : null;
    expect(err?.issues.some((i) => i.message === 'Unknown schema "nonexistent"')).toBe(true);
  });

  it("accepts schema reference when key is in schemaKeys", () => {
    const Schema = getSchemaZodSchema(["link"]);
    const result = Schema.safeParse({ schema: "link" });
    expect(result.success).toBe(true);
  });

  it("rejects oneOf with only one branch (requires min 2)", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({
      oneOf: [{ type: "string" }],
    });
    expect(result.success).toBe(false);
    const err = !result.success ? (result as z.SafeParseError<unknown>).error : null;
    const msg = err?.issues.map((i) => (typeof i.message === "string" ? i.message : "")).join(" ") ?? "";
    expect(msg).toMatch(/array|length|minimum|oneOf|element/i);
  });

  it("accepts oneOf with at least two branches", () => {
    const Schema = getSchemaZodSchema(["link"]);
    const result = Schema.safeParse({
      oneOf: [{ type: "string" }, { schema: "link" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects type array without items", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({ type: "array" });
    expect(result.success).toBe(false);
    const err = !result.success ? (result as z.SafeParseError<unknown>).error : null;
    expect(
      err?.issues.some(
        (i) =>
          typeof i.message === "string" &&
          i.message.includes("array") &&
          i.message.includes("items"),
      ),
    ).toBe(true);
  });

  it("rejects extra keys (strict)", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({
      type: "string",
      unknownKey: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects enum value that does not match type (via refinement)", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({
      type: "string",
      enum: ["a", 42, "c"],
    });
    expect(result.success).toBe(false);
    const err = !result.success ? (result as z.SafeParseError<unknown>).error : null;
    expect(
      err?.issues.some(
        (i) =>
          typeof i.message === "string" && i.message.includes("does not match type"),
      ),
    ).toBe(true);
  });

  it("rejects minimum > maximum (via refinement)", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({
      type: "integer",
      minimum: 10,
      maximum: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid pattern (via refinement)", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({
      type: "string",
      pattern: "[unclosed",
    });
    expect(result.success).toBe(false);
  });

  it("rejects minItems > maxItems (via refinement)", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({
      type: "array",
      items: { type: "string" },
      minItems: 10,
      maxItems: 2,
    });
    expect(result.success).toBe(false);
  });

  it("accepts object schema with properties and required", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts array schema with items that reference another schema", () => {
    const Schema = getSchemaZodSchema(["link"]);
    const result = Schema.safeParse({
      type: "array",
      items: { schema: "link" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts const schema with valid value", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({
      type: "string",
      const: "draft",
    });
    expect(result.success).toBe(true);
  });

  it("accepts boolean type", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({ type: "boolean" });
    expect(result.success).toBe(true);
  });

  it("accepts double type with minimum and maximum", () => {
    const Schema = getSchemaZodSchema([]);
    const result = Schema.safeParse({
      type: "double",
      minimum: 0,
      maximum: 1,
    });
    expect(result.success).toBe(true);
  });
});
