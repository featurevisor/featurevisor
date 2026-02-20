import type { Schema } from "@featurevisor/types";
import { z } from "zod";

import { ProjectConfig } from "../config";
import { valueZodSchema, propertyTypeEnum, getSchemaZodSchema } from "./schema";

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

/**
 * Resolve variable schema to the Schema used for value validation.
 * When variable has `schema` (reference), returns the parsed Schema from schemasByKey; otherwise returns the inline variable schema.
 */
function resolveVariableSchema(
  variableSchema: {
    schema?: string;
    type?: string;
    items?: unknown;
    properties?: unknown;
    required?: string[];
    const?: unknown;
  },
  schemasByKey?: Record<string, Schema>,
): { type?: string; items?: unknown; properties?: unknown; required?: string[]; const?: unknown } | null {
  if (variableSchema.schema) {
    return schemasByKey?.[variableSchema.schema] ?? null;
  }
  return variableSchema as {
    type?: string;
    items?: unknown;
    properties?: unknown;
    required?: string[];
    const?: unknown;
  };
}

/** Deep equality for variable values (primitives, plain objects, arrays). */
function valueDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === "object" && typeof b === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => valueDeepEqual(v, b[i]));
    }
    const keysA = Object.keys(a as object).sort();
    const keysB = Object.keys(b as object).sort();
    if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) return false;
    return keysA.every((k) => valueDeepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/**
 * Recursively validates that every `required` array (at this level and in nested
 * object/array schemas) only contains keys that exist in the same level's `properties`.
 * Adds Zod issues with the correct path for invalid required field names.
 */
function refineRequiredKeysInSchema(
  schema: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
  },
  pathPrefix: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object") return;

  const effectiveType = schema.type;
  const properties = schema.properties;
  const required = schema.required;
  const items = schema.items;

  if (
    effectiveType === "object" &&
    Array.isArray(required) &&
    required.length > 0 &&
    properties &&
    typeof properties === "object"
  ) {
    const allowedKeys = Object.keys(properties);
    required.forEach((key, index) => {
      if (!allowedKeys.includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown required field "${key}". \`required\` must only contain property names defined in \`properties\`. Allowed: ${allowedKeys.length ? allowedKeys.join(", ") : "(none)"}.`,
          path: [...pathPrefix, "required", index],
        });
      }
    });
  }

  if (properties && typeof properties === "object") {
    for (const key of Object.keys(properties)) {
      const nested = properties[key];
      if (nested && typeof nested === "object") {
        refineRequiredKeysInSchema(
          nested as Parameters<typeof refineRequiredKeysInSchema>[0],
          [...pathPrefix, "properties", key],
          ctx,
        );
      }
    }
  }

  if (items && typeof items === "object" && !Array.isArray(items)) {
    refineRequiredKeysInSchema(
      items as Parameters<typeof refineRequiredKeysInSchema>[0],
      [...pathPrefix, "items"],
      ctx,
    );
  }
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
  schemasByKey?: Record<string, Schema>,
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
        schemasByKey,
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
  schemasByKey?: Record<string, Schema>,
): void {
  const label = getVariableLabel(variableSchema, variableKey, path);
  const schemaProperties = variableSchema.properties;

  if (schemaProperties && typeof schemaProperties === "object") {
    const requiredKeys =
      variableSchema.required && variableSchema.required.length > 0
        ? variableSchema.required.filter((k) =>
            Object.prototype.hasOwnProperty.call(schemaProperties, k),
          )
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
          schemasByKey,
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
  schemasByKey?: Record<string, Schema>,
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

  const effectiveSchema = resolveVariableSchema(variableSchema, schemasByKey);
  if (variableSchema.schema && effectiveSchema === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Schema "${variableSchema.schema}" could not be loaded for value validation.`,
      path,
    });
    return;
  }

  if (!effectiveSchema) {
    return;
  }

  const effectiveConst = (effectiveSchema as { const?: unknown }).const;
  if (effectiveConst !== undefined) {
    if (!valueDeepEqual(variableValue, effectiveConst)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable "${label}" must equal the constant value defined in schema (got ${JSON.stringify(variableValue)}).`,
        path,
      });
    }
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

  const expectedType = effectiveSchema.type;
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
      effectiveSchema as { items?: unknown; type: string },
      variableValue,
      path,
      ctx,
      variableKey,
      schemasByKey,
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
      effectiveSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
        type: string;
      },
      variableValue as Record<string, unknown>,
      path,
      ctx,
      variableKey,
      schemasByKey,
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
  schemasByKey,
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
          schemasByKey,
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
  schemasByKey,
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
          schemasByKey,
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
  availableSchemaKeys: string[] = [],
  schemasByKey: Record<string, Schema> = {},
) {
  const schemaZodSchema = getSchemaZodSchema(availableSchemaKeys);
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
          variables: z.record(variableValueZodSchema).optional(),
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

              // Reference to a reusable schema (mutually exclusive with type/properties/required/items)
              schema: z
                .string()
                .refine(
                  (value) => availableSchemaKeys.includes(value),
                  (value) => ({ message: `Unknown schema "${value}"` }),
                )
                .optional(),

              // Inline schema (mutually exclusive with schema)
              type: z.union([z.literal("json"), propertyTypeEnum]).optional(),
              items: schemaZodSchema.optional(),
              properties: z.record(schemaZodSchema).optional(),
              required: z.array(z.string()).optional(),
              const: variableValueZodSchema.optional(),

              description: z.string().optional(),

              defaultValue: variableValueZodSchema,
              disabledValue: variableValueZodSchema.optional(),

              useDefaultWhenDisabled: z.boolean().optional(),
            })
            .strict()
            .superRefine((variableSchema, ctx) => {
              const hasRef = "schema" in variableSchema && variableSchema.schema != null;
              const hasInline =
                "type" in variableSchema &&
                variableSchema.type != null &&
                variableSchema.type !== undefined;
              if (hasRef && hasInline) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message:
                    "Variable schema cannot have both `schema` (reference) and inline properties (`type`, `properties`, `required`, `items`). Use one or the other.",
                  path: [],
                });
                return;
              }
              if (hasRef) {
                if (
                  "type" in variableSchema ||
                  "properties" in variableSchema ||
                  "required" in variableSchema ||
                  "items" in variableSchema
                ) {
                  ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                      "When `schema` is set, do not set `type`, `properties`, `required`, or `items`.",
                    path: [],
                  });
                }
                return;
              }
              if (!hasInline) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message:
                    "Variable schema must have either `schema` (reference to a schema key) or `type` (inline schema).",
                  path: [],
                });
                return;
              }
              // Validate required ⊆ properties at this level and in all nested object schemas
              refineRequiredKeysInSchema(
                variableSchema as Parameters<typeof refineRequiredKeysInSchema>[0],
                [],
                ctx,
              );
            }),
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
          schemasByKey,
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
            schemasByKey,
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
              schemasByKey,
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
                      schemasByKey,
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
              schemasByKey,
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
              schemasByKey,
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
            schemasByKey,
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
            schemasByKey,
          });
        }
      }
    });

  return featureZodSchema;
}
