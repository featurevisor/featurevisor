import * as Joi from "joi";
import { z } from "zod";

import { ProjectConfig } from "../config";

const tagRegex = /^[a-z0-9-]+$/;

export function getFeatureJoiSchema(
  projectConfig: ProjectConfig,
  conditionsJoiSchema,
  availableSegmentKeys: string[],
  availableFeatureKeys: string[],
) {
  const variationValueJoiSchema = Joi.string().required();
  const variableValueJoiSchema = Joi.alternatives()
    .try(
      // @TODO: make it stricter based on variableSchema.type
      Joi.string(),
      Joi.number(),
      Joi.boolean(),
      Joi.array().items(Joi.string()),
      Joi.object().custom(function (value) {
        let isFlat = true;

        Object.keys(value).forEach((key) => {
          if (typeof value[key] === "object") {
            isFlat = false;
          }
        });

        if (!isFlat) {
          throw new Error("object is not flat");
        }

        return value;
      }),
    )
    .allow("");

  const plainGroupSegment = Joi.string().valid("*", ...availableSegmentKeys);

  const andOrNotGroupSegment = Joi.alternatives()
    .try(
      Joi.object({
        and: Joi.array().items(Joi.link("#andOrNotGroupSegment"), plainGroupSegment),
      }),
      Joi.object({
        or: Joi.array().items(Joi.link("#andOrNotGroupSegment"), plainGroupSegment),
      }),
      Joi.object({
        // @TODO: allow plainGroupSegment as well?
        not: Joi.array().items(Joi.link("#andOrNotGroupSegment"), plainGroupSegment),
      }),
    )
    .id("andOrNotGroupSegment");

  const groupSegment = Joi.alternatives().try(andOrNotGroupSegment, plainGroupSegment);

  const groupSegmentsJoiSchema = Joi.alternatives().try(
    Joi.array().items(groupSegment),
    groupSegment,
  );

  const environmentJoiSchema = Joi.object({
    expose: Joi.alternatives().try(
      Joi.boolean(),
      Joi.array().items(Joi.string().valid(...projectConfig.tags)),
    ),
    rules: Joi.array()
      .items(
        Joi.object({
          key: Joi.string().required(),
          description: Joi.string().optional(),
          segments: groupSegmentsJoiSchema.required(),
          percentage: Joi.number().precision(3).min(0).max(100).required(),

          enabled: Joi.boolean().optional(),
          variation: variationValueJoiSchema.optional(), // @TODO: only allowed if feature.variations is present
          variables: Joi.object().optional(), // @TODO: make it stricter
        }),
      )
      .unique("key")
      .required(),
    force: Joi.array().items(
      Joi.object({
        // @TODO: either of the two below should be required
        segments: groupSegmentsJoiSchema.optional(),
        conditions: conditionsJoiSchema.optional(),

        enabled: Joi.boolean().optional(),
        variation: variationValueJoiSchema.optional(),
        variables: Joi.object().optional(), // @TODO: make it stricter
      }),
    ),
  });

  const allEnvironmentsSchema = {};
  projectConfig.environments.forEach((environmentKey) => {
    allEnvironmentsSchema[environmentKey] = environmentJoiSchema.required();
  });
  const allEnvironmentsJoiSchema = Joi.object(allEnvironmentsSchema);

  const featureJoiSchema = Joi.object({
    archived: Joi.boolean().optional(),
    deprecated: Joi.boolean().optional(),
    description: Joi.string().required(),
    tags: Joi.array()
      .items(
        Joi.string().custom((value) => {
          if (!tagRegex.test(value)) {
            throw new Error("tag must be lower cased and alphanumeric, and may contain hyphens.");
          }

          return value;
        }),
      )
      .required(),

    required: Joi.array()
      .items(
        Joi.alternatives().try(
          Joi.string()
            .required()
            .valid(...availableFeatureKeys),
          Joi.object({
            key: Joi.string()
              .required()
              .valid(...availableFeatureKeys),
            variation: Joi.string().optional(), // @TODO: can be made stricter
          }),
        ),
      )
      .optional(),

    bucketBy: Joi.alternatives()
      .try(
        // plain
        Joi.string(),

        // and
        Joi.array().items(Joi.string()),

        // or
        Joi.object({
          or: Joi.array().items(Joi.string()),
        }),
      )
      .required(),

    variablesSchema: Joi.array()
      .items(
        Joi.object({
          key: Joi.string().disallow("variation").required(),
          type: Joi.string()
            .valid("string", "integer", "boolean", "double", "array", "object", "json")
            .required(),
          description: Joi.string().optional(),
          defaultValue: variableValueJoiSchema, // @TODO: make it stricter based on `type`
        }),
      )
      .unique("key"),

    variations: Joi.array()
      .items(
        Joi.object({
          description: Joi.string(),
          value: variationValueJoiSchema.required(),
          weight: Joi.number().precision(3).min(0).max(100).required(),
          variables: Joi.array()
            .items(
              Joi.object({
                key: Joi.string(),
                value: variableValueJoiSchema,
                overrides: Joi.array().items(
                  Joi.object({
                    // @TODO: either segments or conditions prsent at a time
                    segments: groupSegmentsJoiSchema,
                    conditions: conditionsJoiSchema,

                    // @TODO: make it stricter based on `type`
                    value: variableValueJoiSchema,
                  }),
                ),
              }),
            )
            .unique("key"),
        }),
      )
      .custom((value) => {
        const total = value.reduce((acc, v) => acc + v.weight, 0);

        if (total !== 100) {
          throw new Error(`Sum of all variation weights must be 100, got ${total}`);
        }

        return value;
      })
      .optional(),

    environments: allEnvironmentsJoiSchema.required(),
  });

  return featureJoiSchema;
}

export function getFeatureZodSchema(
  projectConfig: ProjectConfig,
  conditionsZodSchema,
  availableSegmentKeys: [string, ...string[]],
  availableFeatureKeys: [string, ...string[]],
) {
  const variationValueZodSchema = z.string().min(1);
  const variableValueZodSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.record(z.unknown()).refine((value) => {
      let isFlat = true;

      Object.keys(value).forEach((key) => {
        if (typeof value[key] === "object") {
          isFlat = false;
        }
      });

      if (!isFlat) {
        throw new Error("object is not flat");
      }

      return value;
    }),
  ]);

  const plainGroupSegment = z
    .string()
    .refine((value) => value === "*" || availableSegmentKeys.includes(value), {
      message: "Invalid segment key",
    });

  const andOrNotGroupSegment = z.union([
    z.object({
      and: z.array(z.lazy(() => groupSegmentZodSchema)),
    }),
    z.object({
      or: z.array(z.lazy(() => groupSegmentZodSchema)),
    }),
    z.object({
      not: z.array(z.lazy(() => groupSegmentZodSchema)),
    }),
  ]);

  const groupSegmentZodSchema = z.union([andOrNotGroupSegment, plainGroupSegment]);

  const groupSegmentsZodSchema = z.union([z.array(groupSegmentZodSchema), groupSegmentZodSchema]);

  const environmentZodSchema = z.object({
    expose: z
      .union([
        z.boolean(),
        z.array(z.string().refine((value) => projectConfig.tags.includes(value))),
      ])
      .optional(),
    rules: z.array(
      z.object({
        key: z.string(),
        description: z.string().optional(),
        segments: groupSegmentsZodSchema,
        percentage: z.number().min(0).max(100),

        enabled: z.boolean().optional(),
        variation: variationValueZodSchema.optional(),
        variables: z.record(variableValueZodSchema).optional(),
      }),
    ),
    force: z
      .array(
        z.object({
          segments: groupSegmentsZodSchema.optional(),
          conditions: conditionsZodSchema.optional(),

          enabled: z.boolean().optional(),
          variation: variationValueZodSchema.optional(),
          variables: z.record(variableValueZodSchema).optional(),
        }),
      )
      .optional(),
  });

  const allEnvironmentsSchema = {};
  projectConfig.environments.forEach((environmentKey) => {
    allEnvironmentsSchema[environmentKey] = environmentZodSchema;
  });
  const allEnvironmentsZodSchema = z.object(allEnvironmentsSchema);

  const featureZodSchema = z.object({
    archived: z.boolean().optional(),
    deprecated: z.boolean().optional(),
    description: z.string(),
    tags: z.array(z.string().refine((value) => tagRegex.test(value))),
    required: z
      .array(
        z.union([
          z.string().refine((value) => availableFeatureKeys.includes(value)),
          z.object({
            key: z.string().refine((value) => availableFeatureKeys.includes(value)),
            variation: z.string().optional(),
          }),
        ]),
      )
      .optional(),
    bucketBy: z.union([z.string(), z.array(z.string()), z.object({ or: z.array(z.string()) })]),
    variablesSchema: z
      .array(
        z.object({
          key: z.string().refine((value) => value !== "variation"),
          type: z.enum(["string", "integer", "boolean", "double", "array", "object", "json"]),
          description: z.string().optional(),
          defaultValue: variableValueZodSchema.optional(),
        }),
      )
      .optional(),
    variations: z
      .array(
        z.object({
          description: z.string().optional(),
          value: variationValueZodSchema,
          weight: z.number().min(0).max(100),
          variables: z
            .array(
              z.object({
                key: z.string(),
                value: variableValueZodSchema,
                overrides: z
                  .array(
                    z.union([
                      z.object({
                        segments: groupSegmentsZodSchema.optional(),
                        conditions: conditionsZodSchema.optional(),
                        value: variableValueZodSchema,
                      }),
                      z.object({
                        segments: groupSegmentsZodSchema.optional(),
                        value: variableValueZodSchema,
                      }),
                    ]),
                  )
                  .optional(),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
    environments: allEnvironmentsZodSchema,
  });

  return featureZodSchema;
}
