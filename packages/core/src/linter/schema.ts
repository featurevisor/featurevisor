import type { Schema, Value } from "@featurevisor/types";
import { z } from "zod";

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

export function getSchemaZodSchema() {
  const schemaZodSchema: z.ZodType<Schema> = z.lazy(() =>
    z
      .object({
        description: z.string().optional(),
        type: propertyTypeEnum.optional(),
        // enum?: Value[]; const?: Value;
        // Numeric: maximum?, minimum?
        // String: maxLength?, minLength?, pattern?
        items: schemaZodSchema.optional(),
        // maxItems?, minItems?, uniqueItems?
        required: z.array(z.string()).optional(),
        properties: z.record(z.string(), schemaZodSchema).optional(),
        // Annotations: default?: Value; examples?: Value[];
      })
      .strict(),
  );

  return schemaZodSchema;
}
