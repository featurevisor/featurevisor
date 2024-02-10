import * as Joi from "joi";
import { z } from "zod";

export function getAttributeJoiSchema() {
  const attributeJoiSchema = Joi.object({
    archived: Joi.boolean(),
    type: Joi.string().valid("boolean", "string", "integer", "double", "date", "semver").required(),
    description: Joi.string().required(),
    capture: Joi.boolean(),
  });

  return attributeJoiSchema;
}

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
