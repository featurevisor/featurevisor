import { z } from "zod";

import { ProjectConfig } from "../config";

const tagRegex = /^[a-z0-9-]+$/;

function isFlatObject(value) {
  let isFlat = true;

  Object.keys(value).forEach((key) => {
    if (typeof value[key] === "object") {
      isFlat = false;
    }
  });

  return isFlat;
}

function isArrayOfStrings(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function superRefineVariableValue(variableSchema, variableValue, path, ctx) {
  if (!variableSchema) {
    let message = `Unknown variable with value: ${variableValue}`;

    if (path.length > 0) {
      const lastPath = path[path.length - 1];

      if (typeof lastPath === "string") {
        message = `Unknown variable "${lastPath}" with value: ${variableValue}`;
      }
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path,
    });

    return;
  }

  // string
  if (variableSchema.type === "string") {
    if (typeof variableValue !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid value for variable "${variableSchema.key}" (${variableSchema.type}): ${variableValue}`,
        path,
      });
    }

    return;
  }

  // integer, double
  if (["integer", "double"].indexOf(variableSchema.type) > -1) {
    if (typeof variableValue !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid value for variable "${variableSchema.key}" (${variableSchema.type}): ${variableValue}`,
        path,
      });
    }

    return;
  }

  // boolean
  if (variableSchema.type === "boolean") {
    if (typeof variableValue !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid value for variable "${variableSchema.key}" (${variableSchema.type}): ${variableValue}`,
        path,
      });
    }

    return;
  }

  // array
  if (variableSchema.type === "array") {
    if (!Array.isArray(variableValue) || !isArrayOfStrings(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid value for variable "${variableSchema.key}" (${variableSchema.type}): \n\n${variableValue}\n\n`,
        path,
      });
    }

    return;
  }

  // object
  if (variableSchema.type === "object") {
    if (typeof variableValue !== "object" || !isFlatObject(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid value for variable "${variableSchema.key}" (${variableSchema.type}): \n\n${variableValue}\n\n`,
        path,
      });
    }

    return;
  }

  // json
  if (variableSchema.type === "json") {
    try {
      JSON.parse(variableValue as string);
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid value for variable "${variableSchema.key}" (${variableSchema.type}): \n\n${variableValue}\n\n`,
        path,
      });
    }

    return;
  }
}

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
        return isFlatObject(value);
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
        )

        .refine(
          (rules) => {
            let hasDuplicates = false;
            rules.forEach((rule) => {
              if (Array.isArray(rule.segments)) {
                const segments = rule.segments;
                const uniqueSegments = new Set(segments);
                if (segments.length !== uniqueSegments.size) {
                  hasDuplicates = true;
                }
              }
            });
            return !hasDuplicates;
          },
          (rules) => {
            const duplicatesInRules = rules
              .map((rule) => {
                if (Array.isArray(rule.segments)) {
                  const segments = rule.segments;
                  const duplicates = segments.filter(
                    (segment, index) => segments.indexOf(segment) !== index,
                  );
                  if (duplicates.length > 0) {
                    return `Rule "${rule.key}": ${duplicates.join(", ")}`;
                  }
                }
                return null;
              })
              .filter(Boolean);

            return {
              message: "Duplicate segments found in rules: " + duplicatesInRules.join("; "),
            };
          },
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
              .strict()
              .refine(
                (forceRule) => {
                  if (Array.isArray(forceRule.segments)) {
                    const segments = forceRule.segments;
                    const uniqueSegments = new Set(segments);
                    return segments.length === uniqueSegments.size;
                  }
                  return true;
                },
                (forceRule) => {
                  if (Array.isArray(forceRule.segments)) {
                    const segments = forceRule.segments;
                    const duplicates = segments.filter(
                      (segment, index) => segments.indexOf(segment) !== index,
                    );
                    return {
                      message: `Duplicate segments found in force rule: ${duplicates.join(", ")}`,
                    };
                  }
                  return { message: "" };
                },
              ),
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
            .strict(),
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
    .strict()
    .superRefine((value, ctx) => {
      if (!value.variablesSchema) {
        return;
      }

      const allVariablesSchema = value.variablesSchema;
      const variableSchemaByKey = {};

      // variablesSchema[n].defaultValue
      allVariablesSchema.forEach((variableSchema, n) => {
        variableSchemaByKey[variableSchema.key] = variableSchema;

        superRefineVariableValue(
          variableSchema,
          variableSchema.defaultValue,
          ["variablesSchema", n, "defaultValue"],
          ctx,
        );
      });

      // variations[n].variables[n].value
      if (value.variations) {
        value.variations.forEach((variation, variationN) => {
          if (!variation.variables) {
            return;
          }

          variation.variables.forEach((variable, variableN) => {
            superRefineVariableValue(
              variableSchemaByKey[variable.key],
              variable.value,
              ["variations", variationN, "variables", variableN, "value"],
              ctx,
            );

            // variations[n].variables[n].overrides[n].value
            if (variable.overrides) {
              variable.overrides.forEach((override, overrideN) => {
                superRefineVariableValue(
                  variableSchemaByKey[variable.key],
                  override.value,
                  [
                    "variations",
                    variationN,
                    "variables",
                    variableN,
                    "overrides",
                    overrideN,
                    "value",
                  ],
                  ctx,
                );
              });
            }
          });
        });
      }

      // environments[key].rules[n].variables[key]
      Object.keys(value.environments).forEach((environmentKey) => {
        value.environments[environmentKey].rules.forEach((rule, ruleN) => {
          if (rule.variables) {
            Object.keys(rule.variables).forEach((variableKey) => {
              superRefineVariableValue(
                variableSchemaByKey[variableKey],
                rule.variables[variableKey],
                ["environments", environmentKey, "rules", ruleN, "variables", variableKey],
                ctx,
              );
            });
          }
        });
      });
    });

  return featureZodSchema;
}
