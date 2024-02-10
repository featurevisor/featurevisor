import * as Joi from "joi";
import { z } from "zod";

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

export function getTestsZodSchema(
  projectConfig: ProjectConfig,
  availableFeatureKeys: [string, ...string[]],
  availableSegmentKeys: [string, ...string[]],
) {
  const segmentTestZodSchema = z
    .object({
      segment: z.string().refine(
        (value) => availableSegmentKeys.includes(value),
        (value) => ({
          message: `Unknown segment "${value}"`,
        }),
      ),
      assertions: z.array(
        z
          .object({
            matrix: z.record(z.unknown()).optional(), // @TODO: make it stricter
            description: z.string().optional(),
            context: z.record(z.unknown()),
            expectedToMatch: z.boolean(),
          })
          .strict(),
      ),
    })
    .strict();

  const featureTestZodSchema = z
    .object({
      feature: z.string().refine(
        (value) => availableFeatureKeys.includes(value),
        (value) => ({
          message: `Unknown feature "${value}"`,
        }),
      ),
      assertions: z.array(
        z
          .object({
            matrix: z.record(z.unknown()).optional(), // @TODO: make it stricter
            description: z.string().optional(),
            at: z.union([z.number().min(0).max(100), z.string()]),
            environment: z.string().refine(
              (value) => {
                if (value.indexOf("${{") === 0) {
                  // allow unknown strings for matrix
                  return true;
                }

                // otherwise only known environments should be passed
                if (projectConfig.environments.includes(value)) {
                  return true;
                }

                return false;
              },
              (value) => ({
                message: `Unknown environment "${value}"`,
              }),
            ),
            context: z.record(z.unknown()),
            expectedToBeEnabled: z.boolean(),
            expectedVariation: z.string().optional(),
            expectedVariables: z.record(z.unknown()).optional(),
          })
          .strict(),
      ),
    })
    .strict();

  return z.union([segmentTestZodSchema, featureTestZodSchema]);
}
