import { z } from "zod";

import { ProjectConfig } from "../config";
import { valueZodSchema, propertyTypeEnum, getPropertyZodSchema } from "./propertySchema";

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

function getVariableLabel(variableSchema, variableKey, path) {
  return variableKey ?? variableSchema?.key ?? (path.length > 0 ? String(path[path.length - 1]) : "variable");
}

function superRefineVariableValue(
  projectConfig: ProjectConfig,
  variableSchema,
  variableValue,
  path,
  ctx,
  variableKey?: string,
) {
  const label = getVariableLabel(variableSchema, variableKey, path);

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
        message: `Invalid value for variable "${label}" (${variableSchema.type}): ${variableValue}`,
        path,
      });
    }

    if (
      projectConfig.maxVariableStringLength &&
      variableValue.length > projectConfig.maxVariableStringLength
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" value is too long (${variableValue.length} characters), max length is ${projectConfig.maxVariableStringLength}`,
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
        message: `Invalid value for variable "${label}" (${variableSchema.type}): ${variableValue}`,
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
        message: `Invalid value for variable "${label}" (${variableSchema.type}): ${variableValue}`,
        path,
      });
    }

    return;
  }

  // array
  if (variableSchema.type === "array") {
    if (!Array.isArray(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid value for variable "${label}" (${variableSchema.type}): \n\n${variableValue}\n\n`,
        path,
      });
      return;
    }

    const itemSchema = variableSchema.items;
    if (itemSchema) {
      variableValue.forEach((item, index) => {
        superRefineVariableValue(
          projectConfig,
          itemSchema,
          item,
          [...path, index],
          ctx,
          undefined,
        );
      });
    } else {
      if (!isArrayOfStrings(variableValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid value for variable "${label}" (${variableSchema.type}): when \`items\` is not set, array must contain only strings. \n\n${variableValue}\n\n`,
          path,
        });
      }
    }

    if (projectConfig.maxVariableArrayStringifiedLength) {
      const stringified = JSON.stringify(variableValue);

      if (stringified.length > projectConfig.maxVariableArrayStringifiedLength) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Variable "${label}" array is too long (${stringified.length} characters), max length is ${projectConfig.maxVariableArrayStringifiedLength}`,
          path,
        });
      }
    }

    return;
  }

  // object
  if (variableSchema.type === "object") {
    if (typeof variableValue !== "object" || !isFlatObject(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid value for variable "${label}" (${variableSchema.type}): \n\n${variableValue}\n\n`,
        path,
      });
    }

    if (projectConfig.maxVariableObjectStringifiedLength) {
      const stringified = JSON.stringify(variableValue);

      if (stringified.length > projectConfig.maxVariableObjectStringifiedLength) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Variable "${label}" object is too long (${stringified.length} characters), max length is ${projectConfig.maxVariableObjectStringifiedLength}`,
          path,
        });
      }
    }

    return;
  }

  // json
  if (variableSchema.type === "json") {
    try {
      JSON.parse(variableValue as string);

      if (projectConfig.maxVariableJSONStringifiedLength) {
        const stringified = variableValue;

        if (stringified.length > projectConfig.maxVariableJSONStringifiedLength) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Variable "${label}" JSON is too long (${stringified.length} characters), max length is ${projectConfig.maxVariableJSONStringifiedLength}`,
            path,
          });
        }
      }
      // eslint-disable-next-line
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid value for variable "${label}" (${variableSchema.type}): \n\n${variableValue}\n\n`,
        path,
      });
    }

    return;
  }
}

function refineForce({
  ctx,
  parsedFeature, // eslint-disable-line
  variableSchemaByKey,
  variationValues,
  force,
  pathPrefix,
  projectConfig,
}) {
  force.forEach((f, fN) => {
    // force[n].variation
    if (f.variation) {
      if (variationValues.indexOf(f.variation) === -1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown variation "${f.variation}" in force`,
          path: [...pathPrefix, fN, "variation"],
        });
      }
    }

    // force[n].variables[key]
    if (f.variables) {
      Object.keys(f.variables).forEach((variableKey) => {
        superRefineVariableValue(
          projectConfig,
          variableSchemaByKey[variableKey],
          f.variables[variableKey],
          pathPrefix.concat([fN, "variables", variableKey]),
          ctx,
          variableKey,
        );
      });
    }
  });
}

function refineRules({
  ctx,
  parsedFeature,
  variableSchemaByKey,
  variationValues,
  rules,
  pathPrefix,
  projectConfig,
}) {
  rules.forEach((rule, ruleN) => {
    // rules[n].variables[key]
    if (rule.variables) {
      Object.keys(rule.variables).forEach((variableKey) => {
        superRefineVariableValue(
          projectConfig,
          variableSchemaByKey[variableKey],
          rule.variables[variableKey],
          pathPrefix.concat([ruleN, "variables", variableKey]),
          ctx,
          variableKey,
        );
      });
    }

    // rules[n].variationWeights
    if (rule.variationWeights) {
      if (!parsedFeature.variations) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Variation weights are overridden from rule, but no variations are present in feature.",
          path: pathPrefix.concat([ruleN, "variationWeights"]),
        });
      } else {
        const overriddenVariationValues = Object.keys(rule.variationWeights);
        const overriddenVariationWeights: number[] = Object.values(rule.variationWeights);

        // unique keys
        if (overriddenVariationValues.length !== new Set(overriddenVariationValues).size) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Duplicate variation values found in variationWeights: " +
              overriddenVariationValues.join(", "),
            path: pathPrefix.concat([ruleN, "variationWeights"]),
          });
        }

        // all original variations must be used
        const missingVariations = variationValues.filter(
          (v) => !overriddenVariationValues.includes(v),
        );

        if (missingVariations.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Missing variations: " + missingVariations.join(", "),
            path: pathPrefix.concat([ruleN, "variationWeights"]),
          });
        }

        // unknown variations
        const unknownVariations = overriddenVariationValues.filter(
          (v) => !variationValues.includes(v),
        );

        if (unknownVariations.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Variation weights contain unknown variations: " + unknownVariations.join(", "),
            path: pathPrefix.concat([ruleN, "variationWeights"]),
          });
        }

        // weights sum must be 100
        const weightsSum = overriddenVariationWeights.reduce((sum, weight) => sum + weight, 0);

        if (weightsSum !== 100) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Variation weights must sum to 100",
            path: pathPrefix.concat([ruleN, "variationWeights"]),
          });
        }
      }
    }
  });
}

export function getFeatureZodSchema(
  projectConfig: ProjectConfig,
  conditionsZodSchema,
  availableAttributeKeys: [string, ...string[]],
  availableSegmentKeys: [string, ...string[]],
  availableFeatureKeys: [string, ...string[]],
) {
  const propertyZodSchema = getPropertyZodSchema(projectConfig);
  const variableValueZodSchema = valueZodSchema;

  const variationValueZodSchema = z.string().min(1);

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

  const exposeSchema = z
    .union([z.boolean(), z.array(z.string().refine((value) => projectConfig.tags.includes(value)))])
    .optional();

  const rulesSchema = z
    .array(
      z
        .object({
          key: z.string(),
          description: z.string().optional(),
          segments: groupSegmentsZodSchema,
          percentage: z.number().min(0).max(100),

          enabled: z.boolean().optional(),
          variation: variationValueZodSchema.optional(),
          variables: z.record(variableValueZodSchema).optional(), // @TODO: lint per variable type
          variationWeights: z.record(z.number().min(0).max(100)).optional(),
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
    );

  const forceSchema = z
    .array(
      z.union([
        z
          .object({
            segments: groupSegmentsZodSchema,
            enabled: z.boolean().optional(),
            variation: variationValueZodSchema.optional(),
            variables: z.record(variableValueZodSchema).optional(), // @TODO: lint per variable type
          })
          .strict(),
        z
          .object({
            conditions: conditionsZodSchema,
            enabled: z.boolean().optional(),
            variation: variationValueZodSchema.optional(),
            variables: z.record(variableValueZodSchema).optional(), // @TODO: lint per variable type
          })
          .strict(),
      ]),
    )
    .optional();

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

  const environmentKeys = projectConfig.environments || [];

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
        .record(
          z
            .object({
              deprecated: z.boolean().optional(),

              // @TODO: make the linting adapt per type change
              type: z.union([z.literal("json"), propertyTypeEnum]),
              items: propertyZodSchema.optional(),
              properties: z.record(propertyZodSchema).optional(),

              description: z.string().optional(),

              defaultValue: variableValueZodSchema,
              disabledValue: variableValueZodSchema.optional(),

              useDefaultWhenDisabled: z.boolean().optional(),
            })
            .strict(),
        )
        .optional(),

      disabledVariationValue: variationValueZodSchema.optional(),

      variations: z
        .array(
          z
            .object({
              description: z.string().optional(),
              value: variationValueZodSchema,
              weight: z.number().min(0).max(100),
              variables: z.record(variableValueZodSchema).optional(),
              variableOverrides: z
                .record(
                  z.array(
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
                  ),
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

      expose:
        projectConfig.environments === false
          ? exposeSchema.optional()
          : z.record(z.enum(environmentKeys as [string, ...string[]]), exposeSchema).optional(),

      force:
        projectConfig.environments === false
          ? forceSchema
          : z.record(z.enum(environmentKeys as [string, ...string[]]), forceSchema).optional(),

      rules:
        projectConfig.environments === false
          ? rulesSchema
          : z.record(z.enum(environmentKeys as [string, ...string[]]), rulesSchema),
    })
    .strict()
    .superRefine((value, ctx) => {
      // disabledVariationValue
      if (value.disabledVariationValue) {
        if (!value.variations) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Disabled variation value is set, but no variations are present in feature.",
            path: ["disabledVariationValue"],
          });
        } else {
          const variationValues = value.variations.map((v) => v.value);

          if (variationValues.indexOf(value.disabledVariationValue) === -1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Disabled variation value "${value.disabledVariationValue}" is not one of the defined variations: ${variationValues.join(", ")}`,
              path: ["disabledVariationValue"],
            });
          }
        }
      }

      if (!value.variablesSchema) {
        return;
      }

      const variableSchemaByKey = value.variablesSchema;
      const variationValues: string[] = [];

      if (value.variations) {
        value.variations.forEach((variation) => {
          variationValues.push(variation.value);
        });
      }

      // variablesSchema[key]
      const variableKeys = Object.keys(variableSchemaByKey);
      variableKeys.forEach((variableKey) => {
        const variableSchema = variableSchemaByKey[variableKey];

        if (variableKey === "variation") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Variable key "${variableKey}" is reserved and cannot be used.`,
            path: ["variablesSchema", variableKey],
          });
        }

        // defaultValue
        superRefineVariableValue(
          projectConfig,
          variableSchema,
          variableSchema.defaultValue,
          ["variablesSchema", variableKey, "defaultValue"],
          ctx,
          variableKey,
        );

        // disabledValue (only when present)
        if (variableSchema.disabledValue !== undefined) {
          superRefineVariableValue(
            projectConfig,
            variableSchema,
            variableSchema.disabledValue,
            ["variablesSchema", variableKey, "disabledValue"],
            ctx,
            variableKey,
          );
        }
      });

      // variations
      if (value.variations) {
        value.variations.forEach((variation, variationN) => {
          if (!variation.variables) {
            return;
          }

          // variations[n].variables[key]
          for (const variableKey of Object.keys(variation.variables)) {
            const variableValue = variation.variables[variableKey];

            superRefineVariableValue(
              projectConfig,
              variableSchemaByKey[variableKey],
              variableValue,
              ["variations", variationN, "variables", variableKey],
              ctx,
              variableKey,
            );

            // variations[n].variableOverrides[n].value
            if (variation.variableOverrides) {
              for (const variableKey of Object.keys(variation.variableOverrides)) {
                const overrides = variation.variableOverrides[variableKey];

                if (Array.isArray(overrides)) {
                  overrides.forEach((override, overrideN) => {
                    superRefineVariableValue(
                      projectConfig,
                      variableSchemaByKey[variableKey],
                      override.value,
                      [
                        "variations",
                        variationN,
                        "variableOverrides",
                        variableKey,
                        overrideN,
                        "value",
                      ],
                      ctx,
                      variableKey,
                    );
                  });
                }
              }
            }
          }
        });
      }

      if (environmentKeys.length > 0) {
        // with environments
        for (const environmentKey of environmentKeys) {
          // rules
          if (value.rules && value.rules[environmentKey]) {
            refineRules({
              parsedFeature: value,
              variableSchemaByKey,
              variationValues,
              rules: value.rules[environmentKey],
              pathPrefix: ["rules", environmentKey],
              ctx,
              projectConfig,
            });
          }

          // force
          if (value.force && value.force[environmentKey]) {
            refineForce({
              parsedFeature: value,
              variableSchemaByKey,
              variationValues,
              force: value.force[environmentKey],
              pathPrefix: ["force", environmentKey],
              ctx,
              projectConfig,
            });
          }
        }
      } else {
        // no environments

        // rules
        if (value.rules) {
          refineRules({
            parsedFeature: value,
            variableSchemaByKey,
            variationValues,
            rules: value.rules,
            pathPrefix: ["rules"],
            ctx,
            projectConfig,
          });
        }

        // force
        if (value.force) {
          refineForce({
            parsedFeature: value,
            variableSchemaByKey,
            variationValues,
            force: value.force,
            pathPrefix: ["force"],
            ctx,
            projectConfig,
          });
        }
      }
    });

  return featureZodSchema;
}
