import * as Joi from "joi";

import { ProjectConfig } from "../config";

export function getTestsJoiSchema(
  projectConfig: ProjectConfig,
  availableFeatureKeys: string[],
  availableSegmentKeys: string[],
) {
  const segmentTestJoiSchema = Joi.object({
    segment: Joi.string()
      .valid(...availableSegmentKeys)
      .required(),
    assertions: Joi.array().items(
      Joi.object({
        description: Joi.string().optional(),
        context: Joi.object(),
        expectedToMatch: Joi.boolean(),
      }),
    ),
  });

  const featureTestJoiSchema = Joi.object({
    feature: Joi.string()
      .valid(...availableFeatureKeys)
      .required(),
    assertions: Joi.array().items(
      Joi.object({
        description: Joi.string().optional(),
        at: Joi.number().precision(3).min(0).max(100),
        environment: Joi.string().valid(...projectConfig.environments),
        context: Joi.object(),

        // @TODO: one or all below
        expectedToBeEnabled: Joi.boolean().required(),
        expectedVariation: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean()),
        expectedVariables: Joi.object(),
      }),
    ),
  });

  return Joi.alternatives().try(segmentTestJoiSchema, featureTestJoiSchema);
}
