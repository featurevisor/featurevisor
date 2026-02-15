import type { PropertySchema, Value } from "@featurevisor/types";
import { z } from "zod";

import { ProjectConfig } from "../config";

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

export function getPropertyZodSchema(_projectConfig: ProjectConfig) {
  const propertyZodSchema: z.ZodType<PropertySchema> = z.lazy(() =>
    z
      .object({
        description: z.string().optional(),
        type: propertyTypeEnum.optional(),
        // enum?: Value[]; const?: Value;
        // Numeric: maximum?, minimum?
        // String: maxLength?, minLength?, pattern?
        items: propertyZodSchema.optional(),
        // maxItems?, minItems?, uniqueItems?
        required: z.array(z.string()).optional(),
        properties: z.record(z.string(), propertyZodSchema).optional(),
        // Annotations: default?: Value; examples?: Value[];
      })
      .strict(),
  );

  return propertyZodSchema;
}
