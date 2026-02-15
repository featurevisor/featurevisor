import { z } from "zod";

import { ProjectConfig } from "../config";
import { valueZodSchema, propertyTypeEnum, getPropertyZodSchema } from "./propertySchema";

const tagRegex = /^[a-z0-9-]+$/;

function isArrayOfStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isFlatObjectValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function getVariableLabel(variableSchema, variableKey, path) {
  return (
    variableKey ??
    variableSchema?.key ??
    (path.length > 0 ? String(path[path.length - 1]) : "variable")
  );
}

function typeOfValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Validates a variable value against an array schema. Recursively validates each item
 * when the schema defines `items` (nested arrays/objects use the same refinement).
 */
function refineVariableValueArray(
  projectConfig: ProjectConfig,
  variableSchema: { items?: unknown; type: string },
  variableValue: unknown[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
  variableKey?: string,
): void {
  const label = getVariableLabel(variableSchema, variableKey, path);
  const itemSchema = variableSchema.items;

  if (itemSchema) {
    variableValue.forEach((item, index) => {
      superRefineVariableValue(
        projectConfig,
        itemSchema,
        item,
        [...path, index],
        ctx,
        variableKey,
      );
    });
  } else {
    if (!isArrayOfStrings(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type array): when \`items\` is not set, array must contain only strings; found non-string element.`,
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
}

/**
 * Validates a variable value against an object schema. Recursively validates each property
 * when the schema defines `properties` (nested objects/arrays use the same refinement).
 */
function refineVariableValueObject(
  projectConfig: ProjectConfig,
  variableSchema: {
    properties?: Record<string, unknown>;
    required?: string[];
    type: string;
  },
  variableValue: Record<string, unknown>,
  path: (string | number)[],
  ctx: z.RefinementCtx,
  variableKey?: string,
): void {
  const label = getVariableLabel(variableSchema, variableKey, path);
  const schemaProperties = variableSchema.properties;

  if (schemaProperties && typeof schemaProperties === "object") {
    const requiredKeys =
      variableSchema.required && variableSchema.required.length > 0
        ? variableSchema.required
        : Object.keys(schemaProperties);

    for (const key of requiredKeys) {
      if (!Object.prototype.hasOwnProperty.call(variableValue, key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing required property "${key}" in variable "${label}"`,
          path: [...path, key],
        });
      }
    }

    for (const key of Object.keys(variableValue)) {
      const propSchema = schemaProperties[key];
      if (!propSchema) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown property "${key}" in variable "${label}" (not in schema)`,
          path: [...path, key],
        });
      } else {
        superRefineVariableValue(
          projectConfig,
          propSchema,
          variableValue[key],
          [...path, key],
          ctx,
          key,
        );
      }
    }
  } else {
    for (const key of Object.keys(variableValue)) {
      const propValue = variableValue[key];
      if (!isFlatObjectValue(propValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Variable "${label}" is a flat object (no \`properties\` in schema); property "${key}" must be a primitive (string, number, boolean, or null), got: ${typeof propValue}`,
          path: [...path, key],
        });
      }
    }
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
    const variableName =
      path.length > 0 && typeof path[path.length - 1] === "string"
        ? String(path[path.length - 1])
        : "variable";
    const message = `Variable "${variableName}" is used but not defined in variablesSchema. Define it under variablesSchema first, then use it here.`;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path,
    });

    return;
  }

  // Require a value (no undefined) for every variable usage
  if (variableValue === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Variable "${label}" value is required (got undefined).`,
      path,
    });
    return;
  }

  const expectedType = variableSchema.type;
  const gotType = typeOfValue(variableValue);

  // string — only string allowed
  if (expectedType === "string") {
    if (typeof variableValue !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type string) must be a string; got ${gotType}.`,
        path,
      });
      return;
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

  // integer — only integer number allowed (no NaN, no Infinity, no float)
  if (expectedType === "integer") {
    if (typeof variableValue !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type integer) must be a number; got ${gotType}.`,
        path,
      });
      return;
    }
    if (!Number.isFinite(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type integer) must be a finite number; got ${variableValue}.`,
        path,
      });
      return;
    }
    if (!Number.isInteger(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type integer) must be an integer; got ${variableValue}.`,
        path,
      });
    }
    return;
  }

  // double — only finite number allowed
  if (expectedType === "double") {
    if (typeof variableValue !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type double) must be a number; got ${gotType}.`,
        path,
      });
      return;
    }
    if (!Number.isFinite(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type double) must be a finite number; got ${variableValue}.`,
        path,
      });
    }
    return;
  }

  // boolean — only boolean allowed
  if (expectedType === "boolean") {
    if (typeof variableValue !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type boolean) must be a boolean; got ${gotType}.`,
        path,
      });
    }
    return;
  }

  // array — only array allowed; without items schema = array of strings
  if (expectedType === "array") {
    if (!Array.isArray(variableValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type array) must be an array; got ${gotType}.`,
        path,
      });
      return;
    }
    refineVariableValueArray(
      projectConfig,
      variableSchema,
      variableValue,
      path,
      ctx,
      variableKey,
    );
    return;
  }

  // object — only plain object allowed (no null, no array)
  if (expectedType === "object") {
    if (
      typeof variableValue !== "object" ||
      variableValue === null ||
      Array.isArray(variableValue)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type object) must be a plain object; got ${gotType}.`,
        path,
      });
      return;
    }
    refineVariableValueObject(
      projectConfig,
      variableSchema,
      variableValue as Record<string, unknown>,
      path,
      ctx,
      variableKey,
    );
    return;
  }

  // json — only string containing valid JSON allowed
  if (expectedType === "json") {
    if (typeof variableValue !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type json) must be a string (JSON string); got ${gotType}.`,
        path,
      });
      return;
    }
    try {
      JSON.parse(variableValue);

      if (projectConfig.maxVariableJSONStringifiedLength) {
        if (variableValue.length > projectConfig.maxVariableJSONStringifiedLength) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Variable "${label}" JSON is too long (${variableValue.length} characters), max length is ${projectConfig.maxVariableJSONStringifiedLength}`,
            path,
          });
        }
      }
      // eslint-disable-next-line
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" (type json) must be a valid JSON string; parse failed.`,
        path,
      });
    }

    return;
  }

  // Unknown variable type — schema is invalid or unsupported
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Variable "${label}" has unknown or unsupported type "${String(expectedType)}" in variablesSchema.`,
    path,
  });
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
  const propertyZodSchema = getPropertyZodSchema();
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

              type: z.union([z.literal("json"), propertyTypeEnum]),
              // array: when omitted, treated as array of strings
              items: propertyZodSchema.optional(),
              // object: when omitted, treated as flat object (primitive values only)
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
