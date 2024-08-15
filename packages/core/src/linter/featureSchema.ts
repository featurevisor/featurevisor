import { z } from "zod";

import { ProjectConfig } from "../config";

const tagRegex = /^[a-z0-9-]+$/;

export function getFeatureZodSchema(
  projectConfig: ProjectConfig,
  conditionsZodSchema,
  availableAttributeKeys: [string, ...string[]],
  availableSegmentKeys: [string, ...string[]],
  availableFeatureKeys: [string, ...string[]],
) {
  const variationValueZodSchema = z.string().min(1);
  const variableValueZodSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.record(z.unknown()).refine(
      (value) => {
        let isFlat = true;

        Object.keys(value).forEach((key) => {
          if (typeof value[key] === "object") {
            isFlat = false;
          }
        });

        return isFlat;
      },
      {
        message: "object is not flat",
      },
    ),
  ]);

  const plainGroupSegment = z.string().refine(
    (value) => value === "*" || availableSegmentKeys.includes(value),
    (value) => ({
      message: `Unknown segment key "${value}"`,
    }),
  );

  const andOrNotGroupSegment = z.union([
    z
      .object({
        and: z.array(z.lazy(() => groupSegmentZodSchema)),
      })
      .strict(),
    z
      .object({
        or: z.array(z.lazy(() => groupSegmentZodSchema)),
      })
      .strict(),
    z
      .object({
        not: z.array(z.lazy(() => groupSegmentZodSchema)),
      })
      .strict(),
  ]);

  const groupSegmentZodSchema = z.union([andOrNotGroupSegment, plainGroupSegment]);

  const groupSegmentsZodSchema = z.union([z.array(groupSegmentZodSchema), groupSegmentZodSchema]);

  const environmentZodSchema = z
    .object({
      expose: z
        .union([
          z.boolean(),
          z.array(z.string().refine((value) => projectConfig.tags.includes(value))),
        ])
        .optional(),
      rules: z
        .array(
          z
            .object({
              key: z.string(),
              description: z.string().optional(),
              segments: groupSegmentsZodSchema,
              percentage: z.number().min(0).max(100),

              enabled: z.boolean().optional(),
              variation: variationValueZodSchema.optional(),
              variables: z.record(variableValueZodSchema).optional(),
            })
            .strict(),
        )

        // must have at least one rule
        .refine(
          (value) => value.length > 0,
          () => ({
            message: "Must have at least one rule",
          }),
        )

        // duplicate rules
        .refine(
          (value) => {
            const keys = value.map((v) => v.key);
            return keys.length === new Set(keys).size;
          },
          (value) => ({
            message: "Duplicate rule keys found: " + value.map((v) => v.key).join(", "),
          }),
        )

        // enforce catch-all rule
        .refine(
          (value) => {
            if (!projectConfig.enforceCatchAllRule) {
              return true;
            }

            const hasCatchAllAsLastRule = value[value.length - 1].segments === "*";
            return hasCatchAllAsLastRule;
          },
          () => ({
            message: `Missing catch-all rule with \`segments: "*"\` at the end`,
          }),
        ),
      force: z
        .array(
          z.union([
            z
              .object({
                segments: groupSegmentsZodSchema,
                enabled: z.boolean().optional(),
                variation: variationValueZodSchema.optional(),
                variables: z.record(variableValueZodSchema).optional(),
              })
              .strict(),
            z
              .object({
                conditions: conditionsZodSchema,
                enabled: z.boolean().optional(),
                variation: variationValueZodSchema.optional(),
                variables: z.record(variableValueZodSchema).optional(),
              })
              .strict(),
          ]),
        )
        .optional(),
    })
    .strict();

  const allEnvironmentsSchema = {};
  projectConfig.environments.forEach((environmentKey) => {
    allEnvironmentsSchema[environmentKey] = environmentZodSchema;
  });
  const allEnvironmentsZodSchema = z.object(allEnvironmentsSchema).strict();

  const attributeKeyZodSchema = z.string().refine(
    (value) => value === "*" || availableAttributeKeys.includes(value),
    (value) => ({
      message: `Unknown attribute "${value}"`,
    }),
  );

  const featureKeyZodSchema = z.string().refine(
    (value) => availableFeatureKeys.includes(value),
    (value) => ({
      message: `Unknown feature "${value}"`,
    }),
  );

  const featureZodSchema = z
    .object({
      archived: z.boolean().optional(),
      deprecated: z.boolean().optional(),
      description: z.string(),
      tags: z
        .array(
          z.string().refine(
            (value) => tagRegex.test(value),
            (value) => ({
              message: `Tag "${value}" must be lower cased and alphanumeric, and may contain hyphens.`,
            }),
          ),
        )
        .refine(
          (value) => {
            return value.length === new Set(value).size;
          },
          (value) => ({
            message: "Duplicate tags found: " + value.join(", "),
          }),
        ),
      required: z
        .array(
          z.union([
            featureKeyZodSchema,
            z
              .object({
                key: featureKeyZodSchema,
                variation: z.string().optional(),
              })
              .strict(),
          ]),
        )
        .optional(),
      bucketBy: z.union([
        attributeKeyZodSchema,
        z.array(attributeKeyZodSchema),
        z
          .object({
            or: z.array(attributeKeyZodSchema),
          })
          .strict(),
      ]),
      variablesSchema: z
        .array(
          z
            .object({
              key: z
                .string()
                .min(1)
                .refine((value) => value !== "variation", {
                  message: `variable key cannot be "variation"`,
                }),
              type: z.enum(["string", "integer", "boolean", "double", "array", "object", "json"]),
              description: z.string().optional(),
              defaultValue: variableValueZodSchema,
            })
            .strict()
            .refine(
              (value) => {
                if (value.type === "json") {
                  try {
                    JSON.parse(value.defaultValue as string);
                  } catch (e) {
                    return false;
                  }
                }

                return true;
              },
              (value) => ({
                message: `Invalid JSON for variable "${value.key}" in schema: \n\n${value.defaultValue}\n\n`,
              }),
            ),
        )
        .refine(
          (value) => {
            const keys = value.map((v) => v.key);
            return keys.length === new Set(keys).size;
          },
          (value) => ({
            message: "Duplicate variable keys found: " + value.map((v) => v.key).join(", "),
          }),
        )
        .optional(),
      variations: z
        .array(
          z
            .object({
              description: z.string().optional(),
              value: variationValueZodSchema,
              weight: z.number().min(0).max(100),
              variables: z
                .array(
                  z
                    .object({
                      key: z.string().min(1),
                      value: variableValueZodSchema,
                      overrides: z
                        .array(
                          z.union([
                            z
                              .object({
                                conditions: conditionsZodSchema,
                                value: variableValueZodSchema,
                              })
                              .strict(),
                            z
                              .object({
                                segments: groupSegmentsZodSchema,
                                value: variableValueZodSchema,
                              })
                              .strict(),
                          ]),
                        )
                        .optional(),
                    })
                    .strict(),
                )
                .optional(),
            })
            .strict(),
        )
        .refine(
          (value) => {
            const variationValues = value.map((v) => v.value);
            return variationValues.length === new Set(variationValues).size;
          },
          (value) => ({
            message: "Duplicate variation values found: " + value.map((v) => v.value).join(", "),
          }),
        )
        .optional(),
      environments: allEnvironmentsZodSchema,
    })
    .strict();

  return featureZodSchema;
}
