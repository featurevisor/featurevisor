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

/**
 * Recursively validates that when a schema has both `type` and `enum`, every enum value matches the type.
 * Adds Zod issues for any mismatch (e.g. mixed types in enum).
 */
export function refineEnumMatchesType(
  schema: {
    type?: string;
    enum?: unknown[];
    items?: unknown;
    properties?: Record<string, unknown>;
  },
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
    refineEnumMatchesType(schema.items as Parameters<typeof refineEnumMatchesType>[0], [...pathPrefix, "items"], ctx);
  }
  if (schema.properties && typeof schema.properties === "object") {
    for (const k of Object.keys(schema.properties)) {
      refineEnumMatchesType(
        schema.properties[k] as Parameters<typeof refineEnumMatchesType>[0],
        [...pathPrefix, "properties", k],
        ctx,
      );
    }
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
        // Numeric: maximum?, minimum?
        // String: maxLength?, minLength?, pattern?
        items: schemaZodSchema.optional(),
        // maxItems?, minItems?, uniqueItems?
        required: z.array(z.string()).optional(),
        properties: z.record(z.string(), schemaZodSchema).optional(),
        // Annotations: default?: Value; examples?: Value[];

        // @TODO: check if infinite recursion scenarios should be allowed
        schema: z
          .string()
          .refine(
            (value) => schemaKeys.includes(value),
            (value) => ({
              message: `Unknown schema "${value}"`,
            }),
          )
          .optional(),
      })
      .strict()
      .superRefine((data, ctx) => refineEnumMatchesType(data, [], ctx)),
  );

  return schemaZodSchema;
}
