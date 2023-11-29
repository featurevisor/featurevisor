import * as Joi from "joi";

export function getAttributeJoiSchema() {
  const attributeJoiSchema = Joi.object({
    archived: Joi.boolean(),
    type: Joi.string().valid("boolean", "string", "integer", "double", "date", "semver").required(),
    description: Joi.string().required(),
    capture: Joi.boolean(),
  });

  return attributeJoiSchema;
}
