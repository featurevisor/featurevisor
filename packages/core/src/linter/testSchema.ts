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
        matrix: Joi.object().optional(), // @TODO: make it stricter
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
        matrix: Joi.object().optional(), // @TODO: make it stricter
        description: Joi.string().optional(),
        at: Joi.alternatives().try(
          Joi.number().precision(3).min(0).max(100).required(),

          // because of supporting matrix
          Joi.string().required(),
        ),
        environment: Joi.string()
          .custom((value, helpers) => {
            if (value.indexOf("${{") === 0) {
              // allow unknown strings for matrix
              return value;
            }

            // otherwise only known environments should be passed
            if (projectConfig.environments.includes(value)) {
              return value;
            }

            return helpers.error("any.invalid");
          })
          .required(),
        context: Joi.object().required(),
        expectedToBeEnabled: Joi.boolean().required(),
        expectedVariation: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean()),
        expectedVariables: Joi.object(),
      }),
    ),
  });

  return Joi.alternatives().try(segmentTestJoiSchema, featureTestJoiSchema);
}
