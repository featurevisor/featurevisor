import * as Joi from "joi";

export function getAttributeJoiSchema() {
  const attributeJoiSchema = Joi.object({
    archived: Joi.boolean(),
    type: Joi.string().allow("boolean", "string", "integer", "double", "date").required(),
    description: Joi.string().required(),
    capture: Joi.boolean(),
  });

  return attributeJoiSchema;
}
