import { z } from "zod";

export function getAttributeZodSchema() {
  const propertySchema = z.object({
    type: z.enum([
      "boolean",
      "string",
      "integer",
      "double",
      "date",
      "semver",
      "array",

      // @NOTE: intentionally ignored for now to not allow nesting
      // "object",
    ]),
    description: z.string().optional(),
  });

  const attributeZodSchema = z
    .object({
      archived: z.boolean().optional(),
      type: z.enum(["boolean", "string", "integer", "double", "date", "semver", "object", "array"]),
      description: z.string(),
      properties: z.record(z.string(), propertySchema).optional(),
    })
    .strict();

  return attributeZodSchema;
}
