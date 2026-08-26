import type {
  Attribute,
  ParsedFeature,
  ParsedVariable,
  Schema,
  VariableValue,
} from "@featurevisor/types";
import { z } from "zod";

import type { ProjectConfig } from "../config";
import { mutate } from "../builder/mutator";
import { getConditionsZodSchema } from "./conditionSchema";
import {
  refineRequiredKeysInSchema,
  resolveVariableSchema,
  superRefineVariableValue,
} from "./featureSchema";
import { validateMutationKey } from "./mutationNotation";
import {
  getSchemaZodSchema,
  propertyTypeEnum,
  refineArrayItems,
  refineEnumMatchesType,
  refineMinimumMaximum,
  refineStringLengthPattern,
  valueZodSchema,
} from "./schema";
import { refineWithMessage } from "./zodHelpers";

function getRequiredFeatureSchema(featuresByKey: Record<string, ParsedFeature>) {
  const featureKeys = Object.keys(featuresByKey);
  const featureKeySchema = refineWithMessage(
    z.string(),
    (key) => Boolean(featuresByKey[key]) && featuresByKey[key].archived !== true,
    (key) =>
      featureKeys.includes(key)
        ? `Required feature "${key}" is archived`
        : `Unknown required feature "${key}"`,
  );

  return z.union([
    featureKeySchema,
    z
      .object({
        key: featureKeySchema,
        variation: z.string().min(1).optional(),
      })
      .strict()
      .superRefine((required, ctx) => {
        if (!required.variation) return;
        const values = (featuresByKey[required.key]?.variations || []).map((item) => item.value);
        if (values.indexOf(required.variation) === -1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown variation "${required.variation}" for required feature "${required.key}"`,
            path: ["variation"],
          });
        }
      }),
  ]);
}

function mutationKeyForRoot(key: string): string {
  return key.startsWith("[") || key.startsWith(":") ? `value${key}` : `value.${key}`;
}

export function getVariableZodSchema(
  projectConfig: ProjectConfig,
  attributesByKey: Record<string, Attribute>,
  segmentKeys: string[],
  featuresByKey: Record<string, ParsedFeature>,
  schemasByKey: Record<string, Schema>,
) {
  const schemaKeys = Object.keys(schemasByKey);
  const nestedSchema = getSchemaZodSchema(schemaKeys);
  const conditionsSchema = getConditionsZodSchema(projectConfig, attributesByKey, schemasByKey);
  const valueSchema = z.union([valueZodSchema, z.null()]);
  const requiredFeatureSchema = getRequiredFeatureSchema(featuresByKey);
  const requiredFeaturesSchema = z.array(requiredFeatureSchema).optional();

  const plainSegmentSchema = refineWithMessage(
    z.string(),
    (key) => key === "*" || segmentKeys.includes(key),
    (key) => `Unknown segment key "${key}"`,
  );
  const groupSegmentSchema: z.ZodTypeAny = z.lazy(() =>
    z.union([
      plainSegmentSchema,
      z.object({ and: z.array(groupSegmentSchema).min(1) }).strict(),
      z.object({ or: z.array(groupSegmentSchema).min(1) }).strict(),
      z.object({ not: z.array(groupSegmentSchema).min(1) }).strict(),
    ]),
  );
  const segmentsSchema = z.union([groupSegmentSchema, z.array(groupSegmentSchema).min(1)]);

  const overrideSchema = z
    .object({
      key: z.string().min(1),
      description: z.string().optional(),
      promotable: z.boolean().optional(),
      segments: segmentsSchema.optional(),
      conditions: conditionsSchema.optional(),
      requiredFeatures: requiredFeaturesSchema,
      value: valueSchema.optional(),
      mutate: z.record(z.string(), valueSchema).optional(),
    })
    .strict()
    .superRefine((override, ctx) => {
      if (!override.segments && !override.conditions) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'An override must define `segments`, `conditions`, or both. Use `segments: "*"` for a catch-all override.',
          path: ["segments"],
        });
      }

      const hasValue = Object.prototype.hasOwnProperty.call(override, "value");
      const hasMutate = Object.prototype.hasOwnProperty.call(override, "mutate");
      if (hasValue === hasMutate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "An override must define exactly one of `value` or `mutate`.",
          path: hasValue ? ["mutate"] : ["value"],
        });
      }
    });

  const overridesArraySchema = z.array(overrideSchema).superRefine((overrides, ctx) => {
    const keys = overrides.map((override) => override.key);
    if (keys.length !== new Set(keys).size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate override keys found: ${keys.join(", ")}`,
      });
    }

    overrides.forEach((override, index) => {
      const isCatchAll = override.segments === "*" && !override.conditions;
      if (isCatchAll && index !== overrides.length - 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "A catch-all override must be the final override because subsequent overrides are unreachable.",
          path: [index, "segments"],
        });
      }
    });
  });

  const overridesSchema = Array.isArray(projectConfig.environments)
    ? z.partialRecord(
        z.enum(projectConfig.environments as [string, ...string[]]),
        overridesArraySchema,
      )
    : overridesArraySchema;

  const variableSchema = z
    .object({
      archived: z.boolean().optional(),
      deprecated: z.boolean().optional(),
      promotable: z.boolean().optional(),
      description: z.string().min(1),
      tags: z
        .array(
          refineWithMessage(
            z.string(),
            (tag) => projectConfig.tags.includes(tag),
            (tag) => `Unknown tag "${tag}"`,
          ),
        )
        .optional(),
      schema: refineWithMessage(
        z.string(),
        (key) => schemaKeys.includes(key),
        (key) => `Unknown schema "${key}"`,
      ).optional(),
      type: z.union([z.literal("json"), propertyTypeEnum]).optional(),
      items: nestedSchema.optional(),
      properties: z.record(z.string(), nestedSchema).optional(),
      additionalProperties: nestedSchema.optional(),
      required: z.array(z.string()).optional(),
      enum: z.array(valueSchema).optional(),
      const: valueSchema.optional(),
      oneOf: z.array(nestedSchema).min(2).optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      pattern: z.string().optional(),
      minItems: z.number().optional(),
      maxItems: z.number().optional(),
      uniqueItems: z.boolean().optional(),
      defaultValue: valueSchema,
      disabledValue: valueSchema.optional(),
      useDefaultWhenDisabled: z.boolean().optional(),
      requiredFeatures: requiredFeaturesSchema,
      overrides: overridesSchema.optional(),
    })
    .strict()
    .superRefine((variable, ctx) => {
      const hasReference = Boolean(variable.schema);
      const inlineFields = [
        "type",
        "items",
        "properties",
        "additionalProperties",
        "required",
        "enum",
        "const",
        "oneOf",
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "pattern",
        "minItems",
        "maxItems",
        "uniqueItems",
      ];
      const hasInline = inlineFields.some(
        (field) => typeof variable[field as keyof typeof variable] !== "undefined",
      );

      if (hasReference && hasInline) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "When `schema` is set, do not define inline schema fields.",
          path: ["schema"],
        });
      } else if (!hasReference && !variable.type && !variable.oneOf) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A variable must define `type`, `oneOf`, or a reusable `schema` reference.",
          path: ["type"],
        });
      } else if (!hasReference && variable.type && variable.oneOf) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A variable cannot define both `type` and `oneOf`. Use one or the other.",
          path: ["oneOf"],
        });
      }

      if (!hasReference) {
        refineEnumMatchesType(variable, [], ctx);
        refineMinimumMaximum(variable, [], ctx);
        refineStringLengthPattern(variable, [], ctx);
        refineArrayItems(variable, [], ctx);
        refineRequiredKeysInSchema(variable, [], ctx, schemasByKey);
      }

      const parsedVariable = variable as unknown as ParsedVariable;
      superRefineVariableValue(
        projectConfig,
        parsedVariable,
        variable.defaultValue,
        ["defaultValue"],
        ctx,
        "value",
        schemasByKey,
      );
      if (typeof variable.disabledValue !== "undefined") {
        superRefineVariableValue(
          projectConfig,
          parsedVariable,
          variable.disabledValue,
          ["disabledValue"],
          ctx,
          "value",
          schemasByKey,
        );
      }

      const overrideGroups: Array<[string | undefined, z.infer<typeof overridesArraySchema>]> =
        Array.isArray(variable.overrides)
          ? [[undefined, variable.overrides]]
          : Object.entries(variable.overrides || {});
      overrideGroups.forEach(([environment, overrides]) => {
        overrides.forEach((override, overrideIndex) => {
          const pathPrefix: (string | number)[] = ["overrides"];
          if (environment) pathPrefix.push(environment);
          pathPrefix.push(overrideIndex);
          if (Object.prototype.hasOwnProperty.call(override, "value")) {
            superRefineVariableValue(
              projectConfig,
              parsedVariable,
              override.value,
              [...pathPrefix, "value"],
              ctx,
              "value",
              schemasByKey,
            );
          }

          if (override.mutate) {
            let resolved = JSON.parse(JSON.stringify(variable.defaultValue)) as VariableValue;
            for (const [key, mutationValue] of Object.entries(override.mutate)) {
              const validation = validateMutationKey(
                mutationKeyForRoot(key),
                { value: parsedVariable as Schema },
                schemasByKey,
              );
              if (!validation.valid) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: validation.error || `Invalid mutation path "${key}"`,
                  path: [...pathPrefix, "mutate", key],
                });
                continue;
              }
              resolved = mutate(parsedVariable, resolved, key, mutationValue);
            }
            superRefineVariableValue(
              projectConfig,
              parsedVariable,
              resolved,
              [...pathPrefix, "mutate"],
              ctx,
              "value",
              schemasByKey,
            );
          }
        });
      });

      if (variable.schema && !resolveVariableSchema(variable, schemasByKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Schema "${variable.schema}" could not be loaded.`,
          path: ["schema"],
        });
      }
    });

  return variableSchema;
}
