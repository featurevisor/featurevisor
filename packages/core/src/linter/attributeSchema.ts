import { z } from "zod";

export function getAttributeZodSchema() {
  const attributeZodSchema = z
    .object({
      archived: z.boolean().optional(),
      type: z.enum(["boolean", "string", "integer", "double", "date", "semver"]),
      description: z.string(),
      capture: z.boolean().optional(),
    })
    .strict();

  return attributeZodSchema;
}
