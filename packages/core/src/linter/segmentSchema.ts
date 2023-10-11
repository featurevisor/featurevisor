import * as Joi from "joi";

import { ProjectConfig } from "../config";

export function getSegmentJoiSchema(projectConfig: ProjectConfig, conditionsJoiSchema) {
  const segmentJoiSchema = Joi.object({
    archived: Joi.boolean().optional(),
    description: Joi.string().required(),
    conditions: conditionsJoiSchema.required(),
  });

  return segmentJoiSchema;
}
