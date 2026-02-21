import type { Schema, SchemaKey, Value } from "@featurevisor/types";
import { z } from "zod";

/** Returns true if value matches the schema type. */
function valueMatchesType(v: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof v === "string";
    case "boolean":
      return typeof v === "boolean";
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "double":
      return typeof v === "number";
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    case "array":
      return Array.isArray(v);
    default:
      return true;
  }
}

type SchemaLike = {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  items?: unknown;
  properties?: Record<string, unknown>;
  oneOf?: unknown[];
};

/**
 * Recursively validates that when a schema has both `type` and `enum`, every enum value matches the type.
 * Also recurses into oneOf branches.
 */
export function refineEnumMatchesType(
  schema: SchemaLike,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;
  const type = schema.type;
  const enumArr = schema.enum;
  if (type && Array.isArray(enumArr) && enumArr.length > 0) {
    for (let i = 0; i < enumArr.length; i++) {
      const v = enumArr[i];
      if (!valueMatchesType(v, type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Enum value at index ${i} (${JSON.stringify(v)}) does not match type "${type}". All enum values must be of the same type as \`type\`.`,
          path: [...pathPrefix, "enum", i],
        });
      }
    }
  }
  if (schema.items && typeof schema.items === "object") {
    refineEnumMatchesType(schema.items as SchemaLike, [...pathPrefix, "items"], ctx);
  }
  if (schema.properties && typeof schema.properties === "object") {
    for (const k of Object.keys(schema.properties)) {
      refineEnumMatchesType(schema.properties[k] as SchemaLike, [...pathPrefix, "properties", k], ctx);
    }
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((branch, i) => {
      if (branch && typeof branch === "object") {
        refineEnumMatchesType(branch as SchemaLike, [...pathPrefix, "oneOf", i], ctx);
      }
    });
  }
}

/**
 * Validates that when a schema has type "integer" or "double", minimum <= maximum when both set,
 * and const/enum values (if present) fall within the range.
 */
export function refineMinimumMaximum(
  schema: SchemaLike,
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;
  const type = schema.type;
  const min = schema.minimum;
  const max = schema.maximum;
  const isNumeric = type === "integer" || type === "double";
  if (isNumeric && min !== undefined && max !== undefined && min > max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `When \`type\` is "${type}", \`minimum\` (${min}) must be less than or equal to \`maximum\` (${max}).`,
      path: [...pathPrefix, "minimum"],
    });
  }
  if (isNumeric && min !== undefined && schema.const !== undefined) {
    const v = schema.const;
    if (typeof v === "number" && v < min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`const\` value ${v} is less than \`minimum\` (${min}).`,
        path: [...pathPrefix, "const"],
      });
    }
  }
  if (isNumeric && max !== undefined && schema.const !== undefined) {
    const v = schema.const;
    if (typeof v === "number" && v > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`const\` value ${v} is greater than \`maximum\` (${max}).`,
        path: [...pathPrefix, "const"],
      });
    }
  }
  if (isNumeric && Array.isArray(schema.enum) && schema.enum.length > 0) {
    for (let i = 0; i < schema.enum.length; i++) {
      const v = schema.enum[i];
      if (typeof v === "number") {
        if (min !== undefined && v < min) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Enum value at index ${i} (${v}) is less than \`minimum\` (${min}).`,
            path: [...pathPrefix, "enum", i],
          });
        }
        if (max !== undefined && v > max) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Enum value at index ${i} (${v}) is greater than \`maximum\` (${max}).`,
            path: [...pathPrefix, "enum", i],
          });
        }
      }
    }
  }
  if (schema.items && typeof schema.items === "object") {
    refineMinimumMaximum(schema.items as SchemaLike, [...pathPrefix, "items"], ctx);
  }
  if (schema.properties && typeof schema.properties === "object") {
    for (const k of Object.keys(schema.properties)) {
      refineMinimumMaximum(schema.properties[k] as SchemaLike, [...pathPrefix, "properties", k], ctx);
    }
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((branch, i) => {
      if (branch && typeof branch === "object") {
        refineMinimumMaximum(branch as SchemaLike, [...pathPrefix, "oneOf", i], ctx);
      }
    });
  }
}

// Recursive schema for Value: boolean | string | number | ObjectValue | Value[]
export const valueZodSchema: z.ZodType<Value> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.string(),
    z.number(),
    // | Date // @TODO: support in future
    z.record(z.string(), valueZodSchema),
    z.array(valueZodSchema),
  ]),
);

// @TODO: support "date" in future
// @TODO: consider "semver" in future
// @TODO: consider "url" in future
export const propertyTypeEnum = z.enum([
  "boolean",
  "string",
  "integer",
  "double",
  "object",
  "array",
]);

export function getSchemaZodSchema(schemaKeys: SchemaKey[] = []) {
  const schemaZodSchema: z.ZodType<Schema> = z.lazy(() =>
    z
      .object({
        description: z.string().optional(),
        type: propertyTypeEnum.optional(),
        enum: z.array(valueZodSchema).optional(),
        const: valueZodSchema.optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
        // String: maxLength?, minLength?, pattern?
        items: schemaZodSchema.optional(),
        // maxItems?, minItems?, uniqueItems?
        required: z.array(z.string()).optional(),
        properties: z.record(z.string(), schemaZodSchema).optional(),
        // Annotations: default?: Value; examples?: Value[];

        schema: z
          .string()
          .refine(
            (value) => schemaKeys.includes(value),
            (value) => ({
              message: `Unknown schema "${value}"`,
            }),
          )
          .optional(),
        oneOf: z.array(schemaZodSchema).min(1).optional(),
      })
      .strict()
      .superRefine((data, ctx) => refineEnumMatchesType(data, [], ctx))
      .superRefine((data, ctx) => refineMinimumMaximum(data, [], ctx)),
  );

  return schemaZodSchema;
}
