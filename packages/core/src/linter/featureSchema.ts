import * as Joi from "joi";

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
    expose: Joi.boolean(),
    rules: Joi.array()
      .items(
        Joi.object({
          key: Joi.string().required(),
          description: Joi.string().optional(),
          segments: groupSegmentsJoiSchema,
          percentage: Joi.number().precision(3).min(0).max(100),

          enabled: Joi.boolean().optional(),
          variation: variationValueJoiSchema.optional(), // @TODO: only allowed if feature.variations is present
          variables: Joi.object().optional(), // @TODO: make it stricter
        }),
      )
      .unique("key")
      .required(),
    force: Joi.array().items(
      Joi.object({
        // @TODO: either of the two below
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
          key: Joi.string().disallow("variation"),
          type: Joi.string().valid(
            "string",
            "integer",
            "boolean",
            "double",
            "array",
            "object",
            "json",
          ),
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
