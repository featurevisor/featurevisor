import type {
  Attribute,
  ComposedParsedVariable,
  ParsedFeature,
  ParsedVariable,
  OrdinaryParsedVariable,
  ParsedVariableOverride,
  Schema,
  VariableValue,
} from "@featurevisor/types";
import { z } from "zod";

import type { ProjectConfig } from "../config";
import { mutate } from "../builder/mutator";
import { mutationEntries, mutationEntryPath } from "../builder/mutationEntries";
import { getMutationSchema } from "./mutationSchema";
import { withMutationResultPaths } from "./mutationResultPaths";
import {
  buildVariableOverrideProgram,
  compileVariableMutation,
  hasContinuingVariableOverrides,
} from "../builder/variableOverrideProgram";
import { applyVariableOperations } from "@featurevisor/sdk";
import { getConditionsZodSchema } from "./conditionSchema";
import {
  refineRequiredKeysInSchema,
  resolveVariableSchema,
  superRefineVariableValue,
} from "./featureSchema";
import { getMutationPath, validateMutationKey } from "./mutationNotation";
import { refineRemovedSchemaType } from "./schemaFormats";
import {
  countZodSchema,
  getSchemaZodSchema,
  propertyTypeEnum,
  refineArrayItems,
  refineEnumMatchesType,
  refineMinimumMaximum,
  refineStringLengthPattern,
  refineSchemaFormat,
  schemaFormatZodSchema,
} from "./schema";
import { refineWithMessage, UNKNOWN_REFERENCE } from "./zodHelpers";
import { diagnosticParseOptions, suggestKey } from "./diagnostics";
import {
  removedConditionFields,
  refineRemovedConditionFields,
  refineRequiredConditions,
} from "./removedConditionFields";
import { refineComposedOverrides } from "./composedOverrideSchema";
import { getCompositionEntries } from "../datasource/composition";

// Evaluated composition members can be null at any depth, including inside a
// replacement object. Typed schema validation still rejects incompatible nulls.
const variableValueSchema: z.ZodType<VariableValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.string(),
    z.number(),
    z.array(variableValueSchema),
    z.record(z.string(), variableValueSchema),
  ]),
);

function mutationKeyForRoot(key: string): string {
  return key.startsWith("[") || key.startsWith(":") ? `value${key}` : `value.${key}`;
}

function getStaticExpressionValue(value: unknown): boolean | undefined {
  if (value === "*") return true;
  if (Array.isArray(value)) {
    // A leaf AND its negation is false without evaluating dependencies. This
    // preserves dead continuation analysis without allowing nested wildcards.
    const positive = new Set(value.map((entry) => JSON.stringify(entry)));
    if (
      value.some(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          "not" in entry &&
          Array.isArray(entry.not) &&
          entry.not.length === 1 &&
          positive.has(JSON.stringify(entry.not[0])),
      )
    )
      return false;
    const values = value.map(getStaticExpressionValue);
    if (values.indexOf(false) !== -1) return false;
    return values.every((item) => item === true) ? true : undefined;
  }
  if (!value || typeof value !== "object") return undefined;

  const expression = value as Record<string, unknown>;
  if (Array.isArray(expression.and)) return getStaticExpressionValue(expression.and);
  if (Array.isArray(expression.or)) {
    const values = expression.or.map(getStaticExpressionValue);
    if (values.indexOf(true) !== -1) return true;
    return values.every((item) => item === false) ? false : undefined;
  }
  if (Array.isArray(expression.not)) {
    const child = getStaticExpressionValue(expression.not);
    return typeof child === "boolean" ? !child : undefined;
  }
  return undefined;
}

function getStaticOverrideMatch(override: ParsedVariableOverride): boolean | undefined {
  return getStaticExpressionValue(override.conditions);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Continuation programs may reach a later override with values produced by more
 * than one earlier match. Explore every statically possible route, while keeping
 * a finite set of index/value states so authored input cannot cause unbounded
 * linter work.
 */
function validateAccumulatingOverrides(
  overrides: ParsedVariableOverride[],
  rootPath: (string | number)[],
  defaultValue: VariableValue,
  parsedVariable: OrdinaryParsedVariable,
  projectConfig: ProjectConfig,
  schemasByKey: Record<string, Schema>,
  ctx: z.RefinementCtx,
  variableKey = "value",
  stateBudget = 4096,
): void {
  const pathsByKeyPath = new Map<string, (string | number)[]>();
  const overridesByKeyPath = new Map<string, ParsedVariableOverride>();
  const seenKeys = new Map<string, (string | number)[]>();
  let hasCompilationError = false;
  const inspectionContext: z.RefinementCtx = {
    ...ctx,
    addIssue(issue) {
      hasCompilationError = true;
      ctx.addIssue(issue);
    },
  };

  const inspect = (
    entries: ParsedVariableOverride[],
    parentPath: (string | number)[],
    parentKeyPath: string[],
  ) => {
    entries.forEach((override, overrideIndex) => {
      const pathPrefix = [...parentPath, overrideIndex];
      const keyPath = [...parentKeyPath, override.key];
      const serializedKeyPath = JSON.stringify(keyPath);
      pathsByKeyPath.set(serializedKeyPath, pathPrefix);
      overridesByKeyPath.set(serializedKeyPath, override);

      if (seenKeys.has(override.key)) {
        inspectionContext.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate override key found in tree: ${override.key}`,
          path: [...pathPrefix, "key"],
        });
      } else {
        seenKeys.set(override.key, pathPrefix);
      }

      if (Object.prototype.hasOwnProperty.call(override, "value")) {
        superRefineVariableValue(
          projectConfig,
          parsedVariable,
          override.value,
          [...pathPrefix, "value"],
          inspectionContext,
          variableKey,
          schemasByKey,
        );
      }

      if (override.mutate) {
        for (const [entryIndex, [mutationKey, mutationValue]] of mutationEntries(
          override.mutate,
        ).entries()) {
          const mutationPath = [
            ...pathPrefix,
            "mutate",
            ...mutationEntryPath(override.mutate, entryIndex, mutationKey),
          ];
          try {
            compileVariableMutation(mutationKey, mutationValue);
          } catch (error) {
            hasCompilationError = true;
            inspectionContext.addIssue({
              code: z.ZodIssueCode.custom,
              message: getErrorMessage(error),
              path: mutationPath,
            });
          }

          const validation = validateMutationKey(
            mutationKeyForRoot(mutationKey),
            { value: parsedVariable as Schema },
            schemasByKey,
            { variableKey, path: mutationKey },
          );
          if (!validation.valid) {
            inspectionContext.addIssue({
              code: z.ZodIssueCode.custom,
              message: validation.error || `Invalid mutation path "${mutationKey}"`,
              path: mutationPath,
            });
          } else if (validation.operation !== "remove") {
            superRefineVariableValue(
              projectConfig,
              validation.valueSchema,
              mutationValue,
              mutationPath,
              inspectionContext,
              variableKey,
              schemasByKey,
              { variableKey, path: getMutationPath(mutationKey), operation: validation.operation },
            );
          }
        }
      }

      inspect(override.overrides || [], [...pathPrefix, "overrides"], keyPath);
    });
  };

  inspect(overrides, rootPath, []);
  if (hasCompilationError) return;

  let program;
  try {
    program = buildVariableOverrideProgram(overrides);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: getErrorMessage(error),
      path: rootPath,
    });
    return;
  }

  type State = { index: number; value: VariableValue };
  const states: State[] = [{ index: 0, value: defaultValue }];
  const visited = new Set<string>();
  let exceededBudget = false;

  const stateKey = (state: State) => `${state.index}:${JSON.stringify(state.value)}`;
  visited.add(stateKey(states[0]));

  const addState = (state: State, path: (string | number)[]) => {
    const key = stateKey(state);
    if (visited.has(key) || exceededBudget) return;
    if (visited.size >= stateBudget) {
      exceededBudget = true;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Accumulating variable overrides exceed the validation state budget (${stateBudget}). Simplify the continuing override composition.`,
        path,
      });
      return;
    }
    visited.add(key);
    states.push(state);
  };

  while (states.length > 0 && !exceededBudget) {
    const state = states.pop()!;
    const step = program[state.index];
    if (!step) continue;

    const serializedKeyPath = JSON.stringify(step.keyPath);
    const pathPrefix = pathsByKeyPath.get(serializedKeyPath) || rootPath;
    const authoredOverride = overridesByKeyPath.get(serializedKeyPath);
    const staticMatch = authoredOverride ? getStaticOverrideMatch(authoredOverride) : undefined;

    if (staticMatch !== false) {
      try {
        const value = applyVariableOperations(state.value, step.operations);
        superRefineVariableValue(
          projectConfig,
          parsedVariable,
          value,
          [...pathPrefix, authoredOverride?.mutate ? "mutate" : "value"],
          withMutationResultPaths(
            ctx,
            authoredOverride?.mutate,
            [...pathPrefix, "mutate"],
            state.value,
          ),
          variableKey,
          schemasByKey,
        );
        addState({ index: step.onMatch, value }, pathPrefix);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unable to apply accumulating override "${step.key}": ${getErrorMessage(error)}`,
          path: authoredOverride?.mutate ? [...pathPrefix, "mutate"] : [...pathPrefix, "value"],
        });
      }
    }

    if (staticMatch !== true) {
      addState({ index: step.onMiss, value: state.value }, pathPrefix);
    }
  }
}

export function getVariableZodSchema(
  projectConfig: ProjectConfig,
  attributesByKey: Record<string, Attribute>,
  segmentKeys: string[],
  featuresByKey: Record<string, ParsedFeature>,
  schemasByKey: Record<string, Schema>,
  variablesByKey: Record<string, ParsedVariable> = {},
  getVariableKey: () => string = () => "value",
) {
  const schemaKeys = Object.keys(schemasByKey);
  const nestedSchema = getSchemaZodSchema(schemaKeys, schemasByKey);
  const conditionsSchema = getConditionsZodSchema(
    projectConfig,
    attributesByKey,
    schemasByKey,
    featuresByKey,
    variablesByKey,
    segmentKeys,
  );
  const valueSchema = variableValueSchema;
  const mutationMapSchema = z
    .unknown()
    .superRefine((value, ctx) => {
      if (
        value &&
        typeof value === "object" &&
        Object.prototype.hasOwnProperty.call(value, "__proto__")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Unsafe mutation key "__proto__" is not allowed.',
          path: ["__proto__"],
        });
      }
    })
    .pipe(z.record(z.string(), valueSchema));
  let overridesArraySchema: z.ZodType<ParsedVariableOverride[]>;
  const overrideSchema: z.ZodType<ParsedVariableOverride> = z.lazy(
    () =>
      z
        .object({
          key: z.string().min(1),
          description: z.string().optional(),
          promotable: z.boolean().optional(),
          conditions: conditionsSchema.optional(),
          ...removedConditionFields,
          continue: z.boolean().optional(),
          value: valueSchema.optional(),
          mutate: getMutationSchema(mutationMapSchema).optional(),
          overrides: overridesArraySchema.optional(),
        })
        .strict()
        .superRefine((override, ctx) => {
          refineRequiredConditions(override, ctx);
          const hasValue = Object.prototype.hasOwnProperty.call(override, "value");
          const hasMutate = Object.prototype.hasOwnProperty.call(override, "mutate");
          if (hasValue === hasMutate) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "An override must define exactly one of `value` or `mutate`.",
              path: hasValue ? ["mutate"] : ["value"],
            });
          }
        }) as unknown as z.ZodType<ParsedVariableOverride>,
  );

  overridesArraySchema = z.array(overrideSchema).superRefine((overrides, ctx) => {
    const keys = overrides.map((override) => override.key);
    if (keys.length !== new Set(keys).size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate override keys found: ${keys.join(", ")}`,
      });
    }

    overrides.forEach((override, index) => {
      const isCatchAll = getStaticExpressionValue(override.conditions) === true;
      if (isCatchAll && override.continue !== true && index !== overrides.length - 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "A catch-all override must be the final override because subsequent overrides are unreachable.",
          path: [index, "conditions"],
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
      minLength: countZodSchema.optional(),
      maxLength: countZodSchema.optional(),
      pattern: z.string().optional(),
      format: schemaFormatZodSchema.optional(),
      minItems: countZodSchema.optional(),
      maxItems: countZodSchema.optional(),
      uniqueItems: z.boolean().optional(),
      defaultValue: valueSchema,
      disabledValue: valueSchema.optional(),
      useDefaultWhenDisabled: z.boolean().optional(),
      conditions: conditionsSchema.optional(),
      ...removedConditionFields,
      overrides: overridesSchema.optional(),
    })
    .strict()
    .superRefine((variable, ctx) => {
      refineRemovedConditionFields(variable, ctx);
      const variableKey = getVariableKey();
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
        "format",
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

      refineRemovedSchemaType(variable, ctx);
      if (!hasReference) {
        refineEnumMatchesType(variable, [], ctx);
        refineMinimumMaximum(variable, [], ctx);
        refineStringLengthPattern(variable, [], ctx);
        refineSchemaFormat(variable, [], ctx, schemasByKey);
        refineArrayItems(variable, [], ctx);
        refineRequiredKeysInSchema(variable, [], ctx, schemasByKey);
      }

      const parsedVariable = variable as unknown as OrdinaryParsedVariable;
      superRefineVariableValue(
        projectConfig,
        parsedVariable,
        variable.defaultValue,
        ["defaultValue"],
        ctx,
        variableKey,
        schemasByKey,
      );
      if (typeof variable.disabledValue !== "undefined") {
        superRefineVariableValue(
          projectConfig,
          parsedVariable,
          variable.disabledValue,
          ["disabledValue"],
          ctx,
          variableKey,
          schemasByKey,
        );
      }

      const overrideGroups: Array<[string | undefined, z.infer<typeof overridesArraySchema>]> =
        Array.isArray(variable.overrides)
          ? [[undefined, variable.overrides]]
          : Object.entries(variable.overrides || {});
      overrideGroups.forEach(([environment, overrides]) => {
        const rootPath: (string | number)[] = ["overrides"];
        if (environment) rootPath.push(environment);

        if (hasContinuingVariableOverrides(overrides)) {
          validateAccumulatingOverrides(
            overrides,
            rootPath,
            variable.defaultValue,
            parsedVariable,
            projectConfig,
            schemasByKey,
            ctx,
            variableKey,
          );
          return;
        }

        const seenKeys = new Map<string, (string | number)[]>();
        const validateOverrides = (
          entries: ParsedVariableOverride[],
          baseValue: VariableValue,
          parentPath: (string | number)[],
        ) => {
          entries.forEach((override, overrideIndex) => {
            const pathPrefix = [...parentPath, overrideIndex];
            const existingPath = seenKeys.get(override.key);
            if (existingPath) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Duplicate override key found in tree: ${override.key}`,
                path: [...pathPrefix, "key"],
              });
            } else {
              seenKeys.set(override.key, pathPrefix);
            }

            let resolvedValue = override.value as VariableValue;
            if (Object.prototype.hasOwnProperty.call(override, "value")) {
              superRefineVariableValue(
                projectConfig,
                parsedVariable,
                override.value,
                [...pathPrefix, "value"],
                ctx,
                variableKey,
                schemasByKey,
              );
            }

            if (override.mutate) {
              resolvedValue = JSON.parse(JSON.stringify(baseValue)) as VariableValue;
              let invalidMutation = false;
              for (const [entryIndex, [key, mutationValue]] of mutationEntries(
                override.mutate,
              ).entries()) {
                let invalidOperand = false;
                const operandContext: z.RefinementCtx = {
                  ...ctx,
                  addIssue(issue) {
                    invalidOperand = true;
                    invalidMutation = true;
                    ctx.addIssue(issue);
                  },
                };
                const mutationPath = [
                  ...pathPrefix,
                  "mutate",
                  ...mutationEntryPath(override.mutate, entryIndex, key),
                ];
                const validation = validateMutationKey(
                  mutationKeyForRoot(key),
                  { value: parsedVariable as Schema },
                  schemasByKey,
                  { variableKey, path: key },
                );
                if (!validation.valid) {
                  operandContext.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: validation.error || `Invalid mutation path "${key}"`,
                    path: mutationPath,
                  });
                  continue;
                }
                try {
                  // Validate operands even if an index or selector cannot match the current value.
                  compileVariableMutation(key, mutationValue);
                  if (validation.operation !== "remove" && validation.valueSchema) {
                    superRefineVariableValue(
                      projectConfig,
                      validation.valueSchema,
                      mutationValue,
                      mutationPath,
                      operandContext,
                      variableKey,
                      schemasByKey,
                      { variableKey, path: getMutationPath(key), operation: validation.operation },
                    );
                  }
                  if (invalidOperand) continue;
                  resolvedValue = mutate(parsedVariable, resolvedValue, key, mutationValue);
                } catch (error) {
                  operandContext.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: getErrorMessage(error),
                    path: mutationPath,
                  });
                }
              }
              if (invalidMutation) resolvedValue = baseValue;
              else
                superRefineVariableValue(
                  projectConfig,
                  parsedVariable,
                  resolvedValue,
                  [...pathPrefix, "mutate"],
                  withMutationResultPaths(
                    ctx,
                    override.mutate,
                    [...pathPrefix, "mutate"],
                    baseValue,
                  ),
                  variableKey,
                  schemasByKey,
                );
            }

            validateOverrides(override.overrides || [], resolvedValue, [
              ...pathPrefix,
              "overrides",
            ]);
          });
        };

        validateOverrides(overrides, variable.defaultValue, rootPath);
      });

      if (variable.schema && !resolveVariableSchema(variable, schemasByKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Schema "${variable.schema}" could not be loaded.`,
          path: ["schema"],
        });
      }
    });

  const referenceKey = z.string().min(1, "Reference keys must be nonempty strings.");
  const referenceSchema = z.union(
    [
      z.object({ feature: referenceKey }).strict(),
      z.object({ feature: referenceKey, variation: z.literal(true) }).strict(),
      z.object({ feature: referenceKey, variable: referenceKey }).strict(),
      z.object({ variable: referenceKey }).strict(),
    ],
    {
      error:
        "Composition members must be exactly { feature }, { feature, variation: true }, { feature, variable }, or { variable }, with nonempty string keys and no unknown fields.",
    },
  );
  const forbiddenFields = [
    "type",
    "schema",
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
    "format",
    "minItems",
    "maxItems",
    "uniqueItems",
    "defaultValue",
    "useDefaultWhenDisabled",
    "mutate",
    "continue",
    "value",
  ];
  const composeMapSchema = z
    .record(
      z
        .string()
        .min(1)
        .refine(
          (alias) => !["__proto__", "constructor", "prototype"].includes(alias),
          "Unsafe composition property is not allowed.",
        ),
      referenceSchema,
    )
    .refine((members) => Object.keys(members).length > 0, "compose must be a nonempty map.");
  const composedShape = z
    .object({
      description: z.string().min(1),
      tags: variableSchema.shape.tags,
      archived: z.boolean().optional(),
      deprecated: z.boolean().optional(),
      promotable: z.boolean().optional(),
      overrides: overridesSchema.optional(),
      compose: z.union([referenceKey, composeMapSchema]),
      conditions: conditionsSchema.optional(),
      disabledValue: valueSchema.optional(),
      ...removedConditionFields,
    })
    .strict();
  const composedSchema = z
    .unknown()
    .superRefine((value, ctx) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      // Zod records deliberately omit __proto__. Inspect authored keys first so
      // the diagnostic names the rejected property rather than an empty result.
      if ("compose" in value && value.compose && typeof value.compose === "object") {
        for (const alias of Object.keys(value.compose)) {
          if (["__proto__", "prototype", "constructor"].includes(alias))
            ctx.addIssue({
              code: "custom",
              path: ["compose", alias],
              message: `Composition property ${JSON.stringify(alias)} is not allowed.`,
            });
        }
      }
      for (const field of forbiddenFields) {
        if (Object.prototype.hasOwnProperty.call(value, field)) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `\`${field}\` is not supported on a composed variable.`,
          });
        }
      }
    })
    .pipe(
      composedShape.extend({
        // Select the authored form before parsing so map diagnostics retain their paths.
        compose: z.unknown().transform((value, ctx) => {
          if (
            typeof value !== "string" &&
            (!value ||
              typeof value !== "object" ||
              Array.isArray(value) ||
              ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
          ) {
            ctx.addIssue({
              code: "custom",
              message: "compose must be a global variable key or a nonempty map of references.",
            });
            return z.NEVER;
          }
          const result = (typeof value === "string" ? referenceKey : composeMapSchema).safeParse(
            value,
            diagnosticParseOptions,
          );
          if (!result.success) {
            for (const issue of result.error.issues) ctx.addIssue({ ...issue });
            return z.NEVER;
          }
          return result.data;
        }),
      }),
    )
    .superRefine((variable, ctx) => {
      refineRemovedConditionFields(variable, ctx);
      for (const [alias, reference] of getCompositionEntries(variable)) {
        if (!referenceSchema.safeParse(reference).success) continue;
        if ("feature" in reference) {
          const feature = Object.prototype.hasOwnProperty.call(featuresByKey, reference.feature)
            ? featuresByKey[reference.feature]
            : undefined;
          if (!feature) {
            ctx.addIssue({
              code: "custom",
              path: ["compose", alias, "feature"],
              message: `Unknown feature "${reference.feature}".${suggestKey(reference.feature, Object.keys(featuresByKey))}`,
              params: UNKNOWN_REFERENCE,
            });
          } else if (
            "variation" in reference &&
            !feature.variations?.length &&
            feature.disabledVariationValue === undefined
          ) {
            ctx.addIssue({
              code: "custom",
              path: ["compose", alias, "variation"],
              message: `Feature "${reference.feature}" has no variations, so this member is always null. Reference its flag instead.`,
            });
          } else if (
            "variable" in reference &&
            !Object.prototype.hasOwnProperty.call(feature.variablesSchema || {}, reference.variable)
          ) {
            ctx.addIssue({
              code: "custom",
              path: alias === undefined ? ["compose"] : ["compose", alias, "variable"],
              message: `Unknown feature variable "${reference.variable}" in feature "${reference.feature}".${suggestKey(reference.variable, Object.keys(feature.variablesSchema || {}))}`,
              params: UNKNOWN_REFERENCE,
            });
          }
        } else {
          const source = Object.prototype.hasOwnProperty.call(variablesByKey, reference.variable)
            ? variablesByKey[reference.variable]
            : undefined;
          if (!source) {
            ctx.addIssue({
              code: "custom",
              path: alias === undefined ? ["compose"] : ["compose", alias, "variable"],
              message: `Unknown global variable "${reference.variable}".${
                alias === undefined &&
                Object.prototype.hasOwnProperty.call(featuresByKey, reference.variable)
                  ? ` "${reference.variable}" is a feature. Use { enabled: { feature: ${JSON.stringify(reference.variable)} } } in compose to read its flag.`
                  : suggestKey(reference.variable, Object.keys(variablesByKey))
              }`,
              params: UNKNOWN_REFERENCE,
            });
          }
        }
      }
      refineComposedOverrides(
        { ...variable, compose: variable.compose! } as unknown as ComposedParsedVariable,
        featuresByKey,
        variablesByKey,
        schemasByKey,
        projectConfig,
        ctx,
        getVariableKey(),
      );
    });

  const editorConditions = conditionsSchema.editorSchema;
  const editorOverride: z.ZodTypeAny = z.lazy(() =>
    z
      .object({
        key: z.string().min(1),
        description: z.string().optional(),
        promotable: z.boolean().optional(),
        conditions: editorConditions,
        continue: z.boolean().optional(),
        value: valueSchema.optional(),
        mutate: getMutationSchema(mutationMapSchema).optional(),
        overrides: z.array(editorOverride).optional(),
      })
      .strict(),
  );
  const editorOverrides = (
    Array.isArray(projectConfig.environments)
      ? z.partialRecord(
          z.enum(projectConfig.environments as [string, ...string[]]),
          z.array(editorOverride),
        )
      : z.array(editorOverride)
  ).optional();
  const editorOrdinary = z
    .object({
      ...variableSchema.shape,
      conditions: editorConditions.optional(),
      overrides: editorOverrides,
    })
    .omit({ segments: true, requiredFeatures: true, requiredVariables: true })
    .strict();
  const editorComposed = z
    .object({
      ...composedShape.shape,
      conditions: editorConditions.optional(),
      overrides: editorOverrides,
    })
    .omit({ segments: true, requiredFeatures: true, requiredVariables: true })
    .strict();
  const editorSchema = z.union([editorOrdinary, editorComposed]);
  const authoredSchema = z.unknown().transform((value, ctx) => {
    const isComposed =
      value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "compose");
    const result = (isComposed ? composedSchema : variableSchema).safeParse(
      value,
      diagnosticParseOptions,
    );
    if (!result.success) {
      result.error.issues.forEach((issue) => ctx.addIssue({ ...issue }));
      return z.NEVER;
    }
    return result.data as ParsedVariable;
  });
  return Object.assign(authoredSchema, { editorSchema });
}
