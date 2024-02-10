import * as Joi from "joi";
import { z } from "zod";

import { ProjectConfig } from "../config";

export function getSegmentJoiSchema(projectConfig: ProjectConfig, conditionsJoiSchema) {
  const segmentJoiSchema = Joi.object({
    archived: Joi.boolean().optional(),
    description: Joi.string().required(),
    conditions: conditionsJoiSchema.required(),
  });

  return segmentJoiSchema;
}

export function getSegmentZodSchema(projectConfig: ProjectConfig, conditionsZodSchema) {
  const segmentZodSchema = z
    .object({
      archived: z.boolean().optional(),
      description: z.string(),
      conditions: conditionsZodSchema,
    })
    .strict();

  return segmentZodSchema;
}
