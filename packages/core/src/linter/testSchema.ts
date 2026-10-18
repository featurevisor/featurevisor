import { z } from "zod";
import { suggestKey } from "./diagnostics";
import type { ParsedFeature, Segment, Scenario } from "@featurevisor/types";

import { ProjectConfig } from "../config";
import { refineWithMessage } from "./zodHelpers";
import { checkOperators, getCheckReferences } from "../tester/checks";
import { applyCombinationToValue, getMatrixCombinations } from "../list/matrix";
import { scenarioToExecution } from "../list/scenarios";
import { classifyTestSpec } from "../datasource/testSpecs";
import { findDisallowedOperators } from "./comparisonOperators";

// Mirrors the SDK EvaluationReason union. Test specs compare these strings exactly.
const evaluationReasons = [
  "feature_not_found",
  "disabled",
  "no_variations",
  "variation_disabled",
  "variable_not_found",
  "variable_default",
  "variable_composed",
  "variable_disabled",
  "variable_override_variation",
  "variable_override_rule",
  "conditions_unmet",
  "no_match",
  "forced",
  "sticky",
  "rule",
  "allocated",
  "error",
];

/** Structural check grammar shared by linting and generated editor schemas. */
export function getChecksZodSchema() {
  const placeholder = z.string().regex(/^\${{\s*([^{}]+?)\s*}}$/);
  const operator = <T extends [string, ...string[]] | readonly [string, ...string[]]>(names: T) =>
    z.union([z.enum(names), placeholder]);
  const unary = ["exists", "notExists", "isNull", "notNull", "empty", "notEmpty"] as const;
  const regex = ["matches", "notMatches"] as const;
  const binary = checkOperators.filter(
    (operator) =>
      !unary.includes(operator as (typeof unary)[number]) &&
      !regex.includes(operator as (typeof regex)[number]),
  ) as [string, ...string[]];
  const metadata = { key: z.string().min(1).optional(), description: z.string().optional() };
  const reference = z
    .object({
      feature: z.string().min(1).optional(),
      variable: z.string().min(1).optional(),
      path: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).optional(),
    })
    .strict();
  const jsonValue: z.ZodType<unknown> = z.lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValue),
      z.record(z.string(), jsonValue),
    ]),
  );
  const variableBase = {
    ...metadata,
    feature: z.string().min(1).optional(),
    variable: z.string().min(1).optional(),
    path: reference.shape.path,
  };
  const flags = z.union([
    z
      .string()
      .regex(/^[gims]*$/)
      .refine((value) => new Set(value).size === value.length),
    placeholder,
  ]);
  const variableLeaves = [
    z.object({ ...variableBase, operator: operator(unary) }).strict(),
    z.object({ ...variableBase, operator: operator(binary), value: jsonValue }).strict(),
    z.object({ ...variableBase, operator: operator(binary), compareTo: reference }).strict(),
    z
      .object({
        ...variableBase,
        operator: operator(regex),
        value: jsonValue,
        regexFlags: flags.optional(),
      })
      .strict(),
    z
      .object({
        ...variableBase,
        operator: operator(regex),
        compareTo: reference,
        regexFlags: flags.optional(),
      })
      .strict(),
  ];
  const segment = z
    .object({
      ...metadata,
      segment: z.string().min(1),
      matches: z.union([z.boolean(), placeholder]),
    })
    .strict();
  const featureByEnabled = z
    .object({
      ...metadata,
      feature: z.string().min(1),
      enabled: z.union([z.boolean(), placeholder]),
      variation: z.union([z.string(), z.null()]).optional(),
    })
    .strict();
  const featureByVariation = z
    .object({
      ...metadata,
      feature: z.string().min(1),
      variation: z.union([z.string(), z.null()]),
      enabled: z.union([z.boolean(), placeholder]).optional(),
    })
    .strict();
  const check: z.ZodTypeAny = z.lazy(() =>
    z.union([
      z.object({ ...metadata, and: checks }).strict(),
      z.object({ ...metadata, or: checks }).strict(),
      z.object({ ...metadata, not: checks }).strict(),
      segment,
      featureByEnabled,
      featureByVariation,
      ...variableLeaves,
    ]),
  );
  const checks: z.ZodTypeAny = z
    .array(check)
    .min(1, "checks and logical groups must be nonempty arrays");
  return checks;
}

function rootOwnerSuggestion(value: unknown): { key: string; owner: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidates = ["feature", "segment", "variable"];
  for (const key of Object.keys(value)) {
    for (const owner of candidates) {
      if (key === owner) continue;
      const previous = Array.from({ length: owner.length + 1 }, (_, i) => i);
      let row = previous;
      for (let i = 0; i < key.length; i++) {
        const next = [i + 1];
        for (let j = 0; j < owner.length; j++) {
          next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (key[i] === owner[j] ? 0 : 1)));
        }
        row = next;
      }
      if (row[owner.length] <= 1) return { key, owner };
    }
  }
  return undefined;
}

export function getTestAuthoringShapes(
  projectConfig: ProjectConfig,
  availableFeatureKeys: [string, ...string[]],
  availableSegmentKeys: [string, ...string[]],
  availableTargetKeys: [string, ...string[]],
  availableVariableKeys: [string, ...string[]] = [] as unknown as [string, ...string[]],
  featuresByKey: Record<string, ParsedFeature> = {},
  segmentsByKey: Record<string, Segment> = {},
) {
  const checksZodSchema = getChecksZodSchema();
  /** Feature assertions named sticky features `sticky` before v4. */
  function refineRemovedSticky(
    assertion: { sticky?: unknown },
    path: (string | number)[],
    ctx: z.RefinementCtx,
  ) {
    if (assertion.sticky === undefined) return;
    ctx.addIssue({
      code: "custom",
      path: [...path, "sticky"],
      message: "Replace `sticky` with `stickyFeatures`, as in segment and variable specs.",
      params: { code: "removed_test_field" },
    });
  }
  const configuredEnvironments = Array.isArray(projectConfig.environments)
    ? projectConfig.environments
    : undefined;
  /** One environment field for every spec kind, with messages that say what to change. */
  function environmentZodSchema(required: boolean) {
    if (!configuredEnvironments) {
      return z
        .never({
          error: "Remove environment. This project does not configure environments.",
        })
        .optional();
    }
    const available = configuredEnvironments.join(", ");
    const schema = refineWithMessage(
      z.string({
        error: (issue) =>
          issue.input === undefined
            ? `Add environment. This project configures environments: ${available}.`
            : "environment must be a string",
      }),
      (value) => value.indexOf("${{") === 0 || configuredEnvironments.includes(value),
      (value) => `Unknown environment "${value}". Available environments: ${available}.`,
    );
    return required ? schema : schema.optional();
  }
  function validateAssertionKeys(
    assertions: Array<{ key?: string; promotable?: boolean }>,
    ctx: z.RefinementCtx,
  ) {
    const keyedAssertions = assertions.filter((assertion) => typeof assertion.key === "string");

    if (keyedAssertions.length > 0 && keyedAssertions.length !== assertions.length) {
      assertions.forEach((assertion, index) => {
        if (typeof assertion.key === "undefined") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "key"],
            message: "All assertions in a test spec must have a key when any assertion has one.",
          });
        }
      });
    }

    const seenKeys = new Set<string>();
    assertions.forEach((assertion, index) => {
      if (typeof assertion.promotable !== "undefined" && typeof assertion.key === "undefined") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key"],
          message: "Assertion key is required when promotable is set.",
        });
      }

      if (typeof assertion.key === "string") {
        if (seenKeys.has(assertion.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "key"],
            message: `Duplicate assertion key "${assertion.key}".`,
          });
        }
        seenKeys.add(assertion.key);
      }
    });
  }

  const matrixValueZodSchema: z.ZodType<unknown> = z.lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(matrixValueZodSchema),
      z.record(z.string(), matrixValueZodSchema),
    ]),
  );
  const matrixZodSchema = z
    .record(z.string(), z.array(matrixValueZodSchema).min(1, "Matrix values cannot be empty"))
    .refine((matrix) => Object.keys(matrix).length > 0, "Matrix must contain at least one key");

  const matrixPlaceholderPattern = /^\${{\s*([^{}]+?)\s*}}$/;
  const matrixPlaceholderZodSchema = z
    .string()
    .regex(matrixPlaceholderPattern, "Expected a matrix placeholder such as ${{ at }}");
  const atZodSchema = z.union([z.number().min(0).max(100), matrixPlaceholderZodSchema]);

  function getMatrixPlaceholderKey(value: string): string | undefined {
    return value.match(matrixPlaceholderPattern)?.[1]?.trim();
  }

  function validateMatrixPlaceholders(
    value: unknown,
    matrix: Record<string, unknown[]> | undefined,
    path: Array<string | number>,
    ctx: z.RefinementCtx,
  ) {
    if (typeof value === "string") {
      const placeholderPattern = /\${{\s*([^{}]+?)\s*}}/g;
      for (const match of value.matchAll(placeholderPattern)) {
        const matrixKey = match[1].trim();
        if (!matrix || !Object.prototype.hasOwnProperty.call(matrix, matrixKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: `Unknown matrix value "${matrixKey}"`,
          });
        }
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        validateMatrixPlaceholders(item, matrix, [...path, index], ctx),
      );
      return;
    }

    if (value && typeof value === "object" && !(value instanceof Date)) {
      Object.entries(value).forEach(([key, item]) => {
        if (key !== "matrix") {
          validateMatrixPlaceholders(item, matrix, [...path, key], ctx);
        }
      });
    }
  }

  function validateMatrixSelectorValues(
    value: string | undefined,
    matrix: Record<string, unknown[]> | undefined,
    allowedValues: string[],
    field: "environment" | "target",
    ctx: z.RefinementCtx,
  ) {
    if (typeof value !== "string" || !value.includes("${{")) return;

    const matrixKey = getMatrixPlaceholderKey(value);
    if (!matrixKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `Expected a complete matrix placeholder such as \${{ ${field} }}`,
      });
      return;
    }

    const values = matrix?.[matrixKey];
    if (!values) return;

    values.forEach((matrixValue, index) => {
      if (typeof matrixValue !== "string" || !allowedValues.includes(matrixValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["matrix", matrixKey, index],
          message: `Unknown ${field} "${String(matrixValue)}"`,
        });
      }
    });
  }

  function validateMatrixAt(
    assertion: { at?: number | string; matrix?: Record<string, unknown[]> },
    ctx: z.RefinementCtx,
  ) {
    if (typeof assertion.at !== "string") return;

    const match = assertion.at.match(matrixPlaceholderPattern);
    const matrixKey = match?.[1]?.trim();
    const values = matrixKey ? assertion.matrix?.[matrixKey] : undefined;
    if (!matrixKey || !values) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["at"],
        message: `Unknown matrix value "${matrixKey || assertion.at}"`,
      });
      return;
    }

    values.forEach((value, index) => {
      if (typeof value !== "number" || value < 0 || value > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["matrix", matrixKey, index],
          message: "Bucket positions must be numbers from 0 to 100",
        });
      }
    });
  }

  const stickyFeatureZodSchema = z
    .object({
      enabled: z.union([z.boolean(), matrixPlaceholderZodSchema]),
      variation: z.string().optional(),
      variables: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

  const stickyFeaturesZodSchema = z
    .record(z.string(), stickyFeatureZodSchema)
    .superRefine((stickyFeatures, ctx) => {
      Object.keys(stickyFeatures).forEach((featureKey) => {
        if (!availableFeatureKeys.includes(featureKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [featureKey],
            message: `Unknown feature "${featureKey}".${suggestKey(featureKey, availableFeatureKeys)}`,
          });
          return;
        }

        const feature = featuresByKey[featureKey];
        const stickyFeature = stickyFeatures[featureKey];
        if (!feature) return;

        const variation = stickyFeature.variation;
        if (variation && !matrixPlaceholderPattern.test(variation)) {
          const variationValues = [
            ...(feature.variations || []).map((item) => item.value),
            feature.disabledVariationValue,
          ].filter((value): value is string => typeof value === "string");
          if (!variationValues.includes(variation)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [featureKey, "variation"],
              message: `Unknown variation "${variation}" in feature "${featureKey}"`,
            });
          }
        }

        Object.keys(stickyFeature.variables || {}).forEach((variableKey) => {
          if (!feature.variablesSchema?.[variableKey]) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [featureKey, "variables", variableKey],
              message: `Unknown variable "${variableKey}" in feature "${featureKey}"`,
            });
          }
        });
      });
    });

  const stickyVariablesZodSchema = z
    .record(z.string(), z.unknown())
    .superRefine((stickyVariables, ctx) => {
      Object.keys(stickyVariables).forEach((variableKey) => {
        if (!availableVariableKeys.includes(variableKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [variableKey],
            message: `Unknown variable "${variableKey}"`,
          });
        }
      });
    });

  function validateVariableExpectations(
    assertion: { expectedValue?: unknown; expectedEvaluation?: unknown; checks?: unknown },
    ctx: z.RefinementCtx,
  ) {
    if (
      typeof assertion.expectedValue === "undefined" &&
      typeof assertion.checks === "undefined" &&
      typeof assertion.expectedEvaluation === "undefined"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected at least one of expectedValue, expectedEvaluation, or checks",
      });
    }
  }

  function validateStickyFeatureMatrixValues(
    stickyFeatures:
      | Record<
          string,
          { enabled?: boolean | string; variation?: string; variables?: Record<string, unknown> }
        >
      | undefined,
    matrix: Record<string, unknown[]> | undefined,
    path: Array<string | number>,
    ctx: z.RefinementCtx,
  ) {
    Object.entries(stickyFeatures || {}).forEach(([featureKey, stickyFeature]) => {
      (["enabled", "variation"] as const).forEach((field) => {
        const value = stickyFeature[field];
        if (typeof value !== "string") return;

        const match = value.match(matrixPlaceholderPattern);
        if (!match) return;

        const matrixKey = match[1].trim();
        const values = matrix?.[matrixKey];
        if (!values) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, featureKey, field],
            message: `Unknown matrix value "${matrixKey}"`,
          });
          return;
        }

        const expectedType = field === "enabled" ? "boolean" : "string";
        values.forEach((matrixValue, index) => {
          if (typeof matrixValue !== expectedType) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["matrix", matrixKey, index],
              message: `Sticky feature ${field} values must be ${expectedType}s`,
            });
            return;
          }

          if (field === "variation") {
            const feature = featuresByKey[featureKey];
            const variationValues = [
              ...(feature?.variations || []).map((item) => item.value),
              feature?.disabledVariationValue,
            ].filter((variationValue): variationValue is string => {
              return typeof variationValue === "string";
            });
            if (!variationValues.includes(matrixValue as string)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["matrix", matrixKey, index],
                message: `Unknown variation "${String(matrixValue)}" in feature "${featureKey}"`,
              });
            }
          }
        });
      });
    });
  }

  const expectedEvaluationZodSchema = z
    .object({
      type: z.enum(["flag", "variation", "variable"]).optional(),
      featureKey: z.string().optional(),
      reason: z
        .string()
        .superRefine((reason, ctx) => {
          if (evaluationReasons.includes(reason) || reason.includes("${{")) return;
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              reason === "required" || reason === "required_features_unmet"
                ? `Evaluation reason "${reason}" was removed in v4. Unmet feature dependencies are conditions now, so use "conditions_unmet".`
                : `Unknown evaluation reason "${reason}".${suggestKey(reason, evaluationReasons)}`,
            params: { code: "unknown_evaluation_reason" },
          });
        })
        .optional(),
      bucketKey: z.string().optional(),
      bucketValue: z.number().optional(),
      ruleKey: z.string().optional(),
      error: z.unknown().optional(),
      enabled: z.boolean().optional(),
      traffic: z.unknown().optional(),
      forceIndex: z.number().int().nonnegative().optional(),
      force: z.unknown().optional(),
      conditions: z.unknown().optional(),
      stickyFeature: z.unknown().optional(),
      variation: z.unknown().optional(),
      variationValue: z.string().optional(),
      variableKey: z.string().optional(),
      variableValue: z.unknown().optional(),
      variableSchema: z.unknown().optional(),
      variableOverrideIndex: z.number().int().nonnegative().optional(),
      variableOverrideKey: z.string().optional(),
      variableOverridePath: z.array(z.string()).optional(),
      variableOverridePaths: z.array(z.array(z.string()).min(1)).optional(),
      variable: z.unknown().optional(),
      requiredFeatures: z.unknown().optional(),
      requiredVariables: z.unknown().optional(),
    })
    .strict()
    .superRefine((expectedEvaluation, ctx) => {
      for (const key of ["requiredFeatures", "requiredVariables"] as const) {
        if (!Object.prototype.hasOwnProperty.call(expectedEvaluation, key)) continue;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `\`${key}\` was removed from evaluations in v4. Dependencies are conditions now. Assert \`reason: conditions_unmet\` for an unmet dependency.`,
          params: { code: "removed_evaluation_field" },
        });
      }
    })
    .refine(
      (expectedEvaluation) => Object.keys(expectedEvaluation).length > 0,
      "Expected evaluation must contain at least one field",
    );

  const expectedEvaluationsZodSchema = z
    .object({
      flag: expectedEvaluationZodSchema.optional(),
      variation: expectedEvaluationZodSchema.optional(),
      variables: z.record(z.string(), expectedEvaluationZodSchema).optional(),
    })
    .strict();

  const segmentTestZodSchema = z
    .object({
      promotable: z.boolean().optional(),
      segment: refineWithMessage(
        z.string(),
        (value) => availableSegmentKeys.includes(value),
        (value) => `Unknown segment "${value}".${suggestKey(value, availableSegmentKeys)}`,
      ),
      assertions: z
        .array(
          z
            .object({
              key: z.string().min(1).optional(),
              promotable: z.boolean().optional(),
              matrix: matrixZodSchema.optional(),
              description: z.string().optional(),
              context: z.record(z.string(), z.unknown()),
              environment: environmentZodSchema(false),
              at: atZodSchema.optional(),
              stickyFeatures: stickyFeaturesZodSchema.optional(),
              stickyVariables: stickyVariablesZodSchema.optional(),
              expectedToMatch: z.boolean(),
            })
            .strict()
            .superRefine((assertion, ctx) => {
              validateMatrixPlaceholders(assertion, assertion.matrix, [], ctx);
              validateMatrixAt(assertion, ctx);
              validateMatrixSelectorValues(
                assertion.environment,
                assertion.matrix,
                projectConfig.environments || [],
                "environment",
                ctx,
              );
              validateStickyFeatureMatrixValues(
                assertion.stickyFeatures,
                assertion.matrix,
                ["stickyFeatures"],
                ctx,
              );
            }),
        )
        .min(1, "Test spec must contain at least one assertion")
        .superRefine(validateAssertionKeys),
    })
    .strict()
    .superRefine((spec, ctx) => {
      function hasDependency(expression: unknown, seen = new Set<string>()): boolean {
        if (typeof expression === "string") {
          if (expression === "*" || seen.has(expression)) return false;
          return hasDependency(
            segmentsByKey[expression]?.conditions,
            new Set(seen).add(expression),
          );
        }
        if (Array.isArray(expression))
          return expression.some((child) => hasDependency(child, seen));
        if (!expression || typeof expression !== "object") return false;
        if ("feature" in expression || "variable" in expression) return true;
        return ["and", "or", "not"].some((key) => hasDependency(expression[key], seen));
      }
      if (
        Array.isArray(projectConfig.environments) &&
        hasDependency(segmentsByKey[spec.segment]?.conditions)
      ) {
        spec.assertions.forEach((assertion, index) => {
          if (assertion.environment === undefined)
            ctx.addIssue({
              code: "custom",
              path: ["assertions", index, "environment"],
              message:
                "An environment is required when a segment depends on a feature or variable.",
            });
        });
      }
    });

  const featureTestZodSchema = z
    .object({
      promotable: z.boolean().optional(),
      feature: refineWithMessage(
        z.string(),
        (value) => availableFeatureKeys.includes(value),
        (value) => `Unknown feature "${value}".${suggestKey(value, availableFeatureKeys)}`,
      ),
      assertions: z
        .array(
          z
            .object({
              key: z.string().min(1).optional(),
              promotable: z.boolean().optional(),
              matrix: matrixZodSchema.optional(),
              description: z.string().optional(),
              at: atZodSchema,
              environment: environmentZodSchema(true),
              target: refineWithMessage(
                z.string(),
                (value) => {
                  if (value.indexOf("${{") === 0) {
                    return true;
                  }

                  return availableTargetKeys.includes(value);
                },
                (value) => `Unknown target "${value}"`,
              ).optional(),

              // parent
              stickyFeatures: stickyFeaturesZodSchema.optional(),
              stickyVariables: stickyVariablesZodSchema.optional(),
              // Accepted only to explain the rename. See refineRemovedSticky.
              sticky: z.unknown().optional(),
              context: z.record(z.string(), z.unknown()).optional(),

              defaultVariationValue: z.string().optional(),
              defaultVariableValues: z.record(z.string(), z.unknown()).optional(),

              expectedToBeEnabled: z.boolean().optional(),
              expectedVariation: z.string().nullable().optional(),
              expectedVariables: z.record(z.string(), z.unknown()).optional(),
              expectedEvaluations: expectedEvaluationsZodSchema.optional(),

              children: z
                .array(
                  z
                    .object({
                      description: z.string().optional(),
                      // copied from parent
                      stickyFeatures: stickyFeaturesZodSchema.optional(),
                      stickyVariables: stickyVariablesZodSchema.optional(),
                      sticky: z.unknown().optional(),
                      context: z.record(z.string(), z.unknown()).optional(),

                      defaultVariationValue: z.string().optional(),
                      defaultVariableValues: z.record(z.string(), z.unknown()).optional(),

                      expectedToBeEnabled: z.boolean().optional(),
                      expectedVariation: z.string().nullable().optional(),
                      expectedVariables: z.record(z.string(), z.unknown()).optional(),

                      expectedEvaluations: expectedEvaluationsZodSchema.optional(),
                    })
                    .strict(),
                )
                .optional(),
            })
            .strict()
            .superRefine((assertion, ctx) => {
              refineRemovedSticky(assertion, [], ctx);
              assertion.children?.forEach((child, index) =>
                refineRemovedSticky(child, ["children", index], ctx),
              );
              validateMatrixPlaceholders(assertion, assertion.matrix, [], ctx);
              validateMatrixAt(assertion, ctx);
              validateMatrixSelectorValues(
                assertion.environment,
                assertion.matrix,
                projectConfig.environments || [],
                "environment",
                ctx,
              );
              validateMatrixSelectorValues(
                assertion.target,
                assertion.matrix,
                availableTargetKeys,
                "target",
                ctx,
              );
              validateStickyFeatureMatrixValues(
                assertion.stickyFeatures,
                assertion.matrix,
                ["stickyFeatures"],
                ctx,
              );
              assertion.children?.forEach((child, index) =>
                validateStickyFeatureMatrixValues(
                  child.stickyFeatures,
                  assertion.matrix,
                  ["children", index, "stickyFeatures"],
                  ctx,
                ),
              );
            }),
        )
        .min(1, "Test spec must contain at least one assertion")
        .superRefine(validateAssertionKeys),
    })
    .strict();

  const variableTestZodSchema = z
    .object({
      promotable: z.boolean().optional(),
      variable: refineWithMessage(
        z.string(),
        (value) => availableVariableKeys.includes(value),
        (value) => `Unknown variable "${value}"`,
      ),
      assertions: z
        .array(
          z
            .object({
              key: z.string().min(1).optional(),
              promotable: z.boolean().optional(),
              matrix: matrixZodSchema.optional(),
              description: z.string().optional(),
              environment: environmentZodSchema(true),
              target: refineWithMessage(
                z.string(),
                (value) => value.indexOf("${{") === 0 || availableTargetKeys.includes(value),
                (value) => `Unknown target "${value}"`,
              ).optional(),
              at: atZodSchema.optional(),
              stickyFeatures: stickyFeaturesZodSchema.optional(),
              stickyVariables: stickyVariablesZodSchema.optional(),
              context: z.record(z.string(), z.unknown()).optional(),
              defaultVariableValue: z.unknown().optional(),
              expectedValue: z.unknown().optional(),
              expectedEvaluation: expectedEvaluationZodSchema.optional(),
              checks: checksZodSchema.optional(),
              children: z
                .array(
                  z
                    .object({
                      description: z.string().optional(),
                      stickyFeatures: stickyFeaturesZodSchema.optional(),
                      stickyVariables: stickyVariablesZodSchema.optional(),
                      context: z.record(z.string(), z.unknown()).optional(),
                      defaultVariableValue: z.unknown().optional(),
                      expectedValue: z.unknown().optional(),
                      expectedEvaluation: expectedEvaluationZodSchema.optional(),
                      checks: checksZodSchema.optional(),
                    })
                    .strict()
                    .superRefine(validateVariableExpectations),
                )
                .min(1)
                .optional(),
            })
            .strict()
            .superRefine((assertion, ctx) => {
              validateMatrixPlaceholders(assertion, assertion.matrix, [], ctx);
              validateMatrixAt(assertion, ctx);
              validateMatrixSelectorValues(
                assertion.environment,
                assertion.matrix,
                projectConfig.environments || [],
                "environment",
                ctx,
              );
              validateMatrixSelectorValues(
                assertion.target,
                assertion.matrix,
                availableTargetKeys,
                "target",
                ctx,
              );
              validateStickyFeatureMatrixValues(
                assertion.stickyFeatures,
                assertion.matrix,
                ["stickyFeatures"],
                ctx,
              );
              assertion.children?.forEach((child, index) => {
                validateStickyFeatureMatrixValues(
                  child.stickyFeatures,
                  assertion.matrix,
                  ["children", index, "stickyFeatures"],
                  ctx,
                );
              });
              if (
                typeof assertion.expectedValue === "undefined" &&
                typeof assertion.expectedEvaluation === "undefined" &&
                typeof assertion.checks === "undefined" &&
                !assertion.children?.length
              ) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message:
                    "Expected at least one of expectedValue, expectedEvaluation, checks, or children",
                });
              }
            }),
        )
        .min(1, "Test spec must contain at least one assertion")
        .superRefine(validateAssertionKeys),
    })
    .strict();

  const scenarioTestZodSchema = z
    .object({
      scenario: z.string().min(1),
      promotable: z.boolean().optional(),
      assertions: z
        .array(
          z
            .object({
              key: z.string().min(1).optional(),
              promotable: z.boolean().optional(),
              description: z.string().optional(),
              matrix: matrixZodSchema.optional(),
              environment: environmentZodSchema(true),
              target: z.string().optional(),
              at: atZodSchema.optional(),
              context: z.record(z.string(), z.unknown()).optional(),
              stickyFeatures: stickyFeaturesZodSchema.optional(),
              stickyVariables: stickyVariablesZodSchema.optional(),
              checks: checksZodSchema.optional(),
              children: z
                .array(
                  z
                    .object({
                      description: z.string().optional(),
                      context: z.record(z.string(), z.unknown()).optional(),
                      stickyFeatures: stickyFeaturesZodSchema.optional(),
                      stickyVariables: stickyVariablesZodSchema.optional(),
                      checks: checksZodSchema,
                    })
                    .strict(),
                )
                .min(1)
                .optional(),
            })
            .strict()
            .superRefine((assertion, ctx) => {
              if (assertion.checks === undefined && !assertion.children?.length)
                ctx.addIssue({
                  code: "custom",
                  message: "Scenario assertions require checks or children",
                });
              validateMatrixPlaceholders(assertion, assertion.matrix, [], ctx);
              validateMatrixAt(assertion, ctx);
              validateMatrixSelectorValues(
                assertion.environment,
                assertion.matrix,
                projectConfig.environments || [],
                "environment",
                ctx,
              );
              validateMatrixSelectorValues(
                assertion.target,
                assertion.matrix,
                availableTargetKeys,
                "target",
                ctx,
              );
              if (
                assertion.environment &&
                !assertion.environment.startsWith("${{") &&
                !(projectConfig.environments || []).includes(assertion.environment)
              )
                ctx.addIssue({
                  code: "custom",
                  path: ["environment"],
                  message: `Unknown environment "${assertion.environment}"`,
                });
              if (
                assertion.target &&
                !assertion.target.startsWith("${{") &&
                !availableTargetKeys.includes(assertion.target)
              )
                ctx.addIssue({
                  code: "custom",
                  path: ["target"],
                  message: `Unknown target "${assertion.target}"`,
                });
              validateStickyFeatureMatrixValues(
                assertion.stickyFeatures,
                assertion.matrix,
                ["stickyFeatures"],
                ctx,
              );
              assertion.children?.forEach((child, i) =>
                validateStickyFeatureMatrixValues(
                  child.stickyFeatures,
                  assertion.matrix,
                  ["children", i, "stickyFeatures"],
                  ctx,
                ),
              );
            }),
        )
        .min(1)
        .superRefine(validateAssertionKeys),
    })
    .strict();

  const schema = z.unknown().superRefine((value, ctx) => {
    const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const schema = Object.prototype.hasOwnProperty.call(candidate, "feature")
      ? featureTestZodSchema
      : Object.prototype.hasOwnProperty.call(candidate, "segment")
        ? segmentTestZodSchema
        : Object.prototype.hasOwnProperty.call(candidate, "variable")
          ? variableTestZodSchema
          : Object.prototype.hasOwnProperty.call(candidate, "scenario")
            ? scenarioTestZodSchema
            : z.never();
    const result = schema.safeParse(value);
    if (!result.success) {
      result.error.issues.forEach((issue) => ctx.addIssue({ ...issue }));
      if (result.error.issues.some((issue) => issue.path.includes("checks"))) {
        const owner = typeof candidate.variable === "string" ? candidate.variable : undefined;
        (Array.isArray(candidate.assertions) ? candidate.assertions : []).forEach(
          (assertion, index) => {
            const entries = [
              { value: assertion, path: ["assertions", index] as Array<string | number> },
              ...(Array.isArray(assertion?.children)
                ? assertion.children.map((child, childIndex) => ({
                    value: child,
                    path: ["assertions", index, "children", childIndex] as Array<string | number>,
                  }))
                : []),
            ];
            for (const entry of entries) {
              if (entry.value?.checks === undefined) continue;
              try {
                getCheckReferences(entry.value.checks, owner);
              } catch (error) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: [...entry.path, "checks"],
                  message: error instanceof Error ? error.message : String(error),
                });
              }
            }
          },
        );
      }
      return;
    }
    if (typeof candidate.feature === "string") {
      const feature = featuresByKey[candidate.feature];
      // Definition metadata is optional for callers generating editor schemas.
      if (feature) {
        const assertions = (candidate as z.infer<typeof featureTestZodSchema>).assertions;
        assertions.forEach((assertion, index) => {
          const expectations = [
            { value: assertion, path: ["assertions", index] },
            ...(assertion.children || []).map((child, i) => ({
              value: child,
              path: ["assertions", index, "children", i],
            })),
          ];
          for (const item of expectations) {
            if (
              Object.prototype.hasOwnProperty.call(item.value, "expectedVariation") &&
              !feature.variations?.length &&
              feature.disabledVariationValue === undefined
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...item.path, "expectedVariation"],
                message: `Feature "${candidate.feature}" has no variations. Use expectedToBeEnabled to test its flag.`,
              });
            }
            for (const key of Object.keys(item.value.expectedVariables || {})) {
              if (!Object.prototype.hasOwnProperty.call(feature.variablesSchema || {}, key)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: [...item.path, "expectedVariables", key],
                  message: `Unknown variable "${key}" in feature "${candidate.feature}".${suggestKey(key, Object.keys(feature.variablesSchema || {}))}`,
                });
              }
            }
          }
        });
      }
    }
    if ("variable" in candidate || "scenario" in candidate) {
      const owner = typeof candidate.variable === "string" ? candidate.variable : undefined;
      (candidate.assertions as Array<any>).forEach((assertion, index) => {
        const combinations = assertion.matrix ? getMatrixCombinations(assertion.matrix) : [{}];
        for (const combination of combinations) {
          const expanded = applyCombinationToValue(assertion, combination);
          const expectations = [
            { value: expanded, path: ["assertions", index] },
            ...(expanded.children || []).map((child, i) => ({
              value: child,
              path: ["assertions", index, "children", i],
            })),
          ];
          for (const item of expectations) {
            if (item.value.checks === undefined) continue;
            for (const issue of findDisallowedOperators(
              item.value.checks,
              projectConfig.disallowOperators || [],
              [...item.path, "checks"],
            )) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: issue.path,
                message: `Operator "${issue.operator}" is disallowed by project configuration.`,
              });
            }
            try {
              const references = getCheckReferences(item.value.checks, owner);
              for (const reference of references) {
                if (reference.segment !== undefined) {
                  if (!availableSegmentKeys.includes(reference.segment))
                    throw new Error(
                      `Unknown segment "${reference.segment}".${suggestKey(reference.segment, availableSegmentKeys)}`,
                    );
                } else if (reference.feature !== undefined) {
                  if (!availableFeatureKeys.includes(reference.feature))
                    throw new Error(
                      `Unknown feature "${reference.feature}".${suggestKey(reference.feature, availableFeatureKeys)}`,
                    );
                  if (reference.variable === undefined) continue;
                  const feature = featuresByKey[reference.feature];
                  if (
                    feature &&
                    !Object.prototype.hasOwnProperty.call(
                      feature.variablesSchema || {},
                      reference.variable,
                    )
                  )
                    throw new Error(
                      `Unknown variable "${reference.variable}" in feature "${reference.feature}"`,
                    );
                } else {
                  const key = reference.variable || owner!;
                  if (!availableVariableKeys.includes(key))
                    throw new Error(`Unknown global variable "${key}"`);
                }
              }
            } catch (error) {
              ctx.addIssue({
                code: "custom",
                path: [...item.path, "checks"],
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      });
    }
  });
  return {
    schema,
    featureTestZodSchema,
    segmentTestZodSchema,
    variableTestZodSchema,
    scenarioTestZodSchema,
  };
}

function getExecutionTestSchema(...args: Parameters<typeof getTestAuthoringShapes>) {
  return getTestAuthoringShapes(...args).schema;
}

/** Classify authored specs by their root shape, independently of their directory. */
export function getTestsZodSchema(...args: Parameters<typeof getExecutionTestSchema>) {
  const schema = getExecutionTestSchema(...args);
  const scenarioSchema = getScenarioAuthoringSchema(schema);
  return z.unknown().superRefine((value, ctx) => {
    let entityType;
    try {
      entityType = classifyTestSpec(value);
    } catch (error) {
      const suggestion = rootOwnerSuggestion(value);
      ctx.addIssue({
        code: "custom",
        path: suggestion ? [suggestion.key] : [],
        message: suggestion
          ? `Unknown root owner "${suggestion.key}". Did you mean "${suggestion.owner}"?`
          : (error as Error).message,
      });
      return;
    }
    const result = (entityType === "scenario" ? scenarioSchema : schema).safeParse(value);
    if (!result.success) result.error.issues.forEach((issue) => ctx.addIssue({ ...issue }));
  });
}

/** Reuse assertion validation while reporting paths in the authored root shape. */
export function getScenariosZodSchema(...args: Parameters<typeof getExecutionTestSchema>) {
  return getScenarioAuthoringSchema(getExecutionTestSchema(...args));
}

function getScenarioAuthoringSchema(schema: ReturnType<typeof getExecutionTestSchema>) {
  return z.unknown().superRefine((value, ctx) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      ctx.addIssue({ code: "custom", message: "Scenario must be an object" });
      return;
    }
    const assertion = value as Record<string, unknown>;
    if ("key" in assertion) {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message: "A scenario is identified by its filename; do not author a key.",
      });
      return;
    }
    if ("assertions" in assertion) {
      ctx.addIssue({
        code: "custom",
        path: ["assertions"],
        message: "Scenarios use checks at the root, without assertions.",
      });
      return;
    }
    if (!Array.isArray(assertion.checks) || !assertion.checks.length) {
      ctx.addIssue({
        code: "custom",
        path: ["checks"],
        message: "Scenarios require nonempty checks at the root",
      });
    }
    if (Array.isArray(assertion.children)) {
      assertion.children.forEach((child, index) => {
        if (!child || typeof child !== "object" || Array.isArray(child)) return;
        if ("assertions" in child) {
          ctx.addIssue({
            code: "custom",
            path: ["children", index, "assertions"],
            message: "Scenario children use checks, without assertions.",
          });
        }
        if (!Array.isArray(child.checks) || !child.checks.length) {
          ctx.addIssue({
            code: "custom",
            path: ["children", index, "checks"],
            message: "Scenario children require nonempty checks",
          });
        }
      });
    }
    const result = schema.safeParse(scenarioToExecution(value as Scenario, "scenario"));
    if (!result.success)
      result.error.issues.forEach((issue) => {
        const path =
          issue.path[0] === "assertions" && issue.path[1] === 0 ? issue.path.slice(2) : issue.path;
        const message =
          issue.message === "Scenario assertions require checks or children"
            ? "Scenarios require nonempty checks at the root"
            : issue.message;
        ctx.addIssue({ ...issue, path, message });
      });
  });
}
