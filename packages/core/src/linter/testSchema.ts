import { z } from "zod";

import { ProjectConfig } from "../config";
import { refineWithMessage } from "./zodHelpers";

export function getTestsZodSchema(
  projectConfig: ProjectConfig,
  availableFeatureKeys: [string, ...string[]],
  availableSegmentKeys: [string, ...string[]],
  availableTargetKeys: [string, ...string[]],
  availableVariableKeys: [string, ...string[]] = [] as unknown as [string, ...string[]],
) {
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

  const matrixZodSchema = z.record(
    z.string(),
    z.array(
      z.union([
        // allowed values in arrays
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
      ]),
    ),
  );

  const expectedEvaluationZodSchema = z
    .object({
      type: z.enum(["flag", "variation", "variable"]).optional(),
      featureKey: z.string().optional(),
      reason: z.string().optional(),
      bucketKey: z.string().optional(),
      bucketValue: z.number().optional(),
      ruleKey: z.string().optional(),
      error: z.unknown().optional(),
      enabled: z.boolean().optional(),
      traffic: z.unknown().optional(),
      forceIndex: z.number().int().nonnegative().optional(),
      force: z.unknown().optional(),
      required: z.unknown().optional(),
      requiredFeatures: z.unknown().optional(),
      stickyFeature: z.unknown().optional(),
      sticky: z.unknown().optional(),
      variation: z.unknown().optional(),
      variationValue: z.string().optional(),
      variableKey: z.string().optional(),
      variableValue: z.unknown().optional(),
      variableSchema: z.unknown().optional(),
      variableOverrideIndex: z.number().int().nonnegative().optional(),
      variableOverrideKey: z.string().optional(),
      variableOverridePath: z.array(z.string()).optional(),
      variable: z.unknown().optional(),
    })
    .strict();

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
        (value) => `Unknown segment "${value}"`,
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
              expectedToMatch: z.boolean(),
            })
            .strict(),
        )
        .superRefine(validateAssertionKeys),
    })
    .strict();

  const featureTestZodSchema = z
    .object({
      promotable: z.boolean().optional(),
      feature: refineWithMessage(
        z.string(),
        (value) => availableFeatureKeys.includes(value),
        (value) => `Unknown feature "${value}"`,
      ),
      assertions: z
        .array(
          z
            .object({
              key: z.string().min(1).optional(),
              promotable: z.boolean().optional(),
              matrix: matrixZodSchema.optional(),
              description: z.string().optional(),
              at: z.union([
                z.number().min(0).max(100),

                // because of supporting matrix
                z.string(),
              ]),
              environment: Array.isArray(projectConfig.environments)
                ? refineWithMessage(
                    z.string(),
                    (value) => {
                      if (value.indexOf("${{") === 0) {
                        // allow unknown strings for matrix
                        return true;
                      }

                      // otherwise only known environments should be passed
                      if (
                        Array.isArray(projectConfig.environments) &&
                        projectConfig.environments.includes(value)
                      ) {
                        return true;
                      }

                      return false;
                    },
                    (value) => `Unknown environment "${value}"`,
                  )
                : z.never().optional(),
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
              sticky: z.record(z.string(), z.record(z.string(), z.any())).optional(),
              context: z.record(z.string(), z.unknown()).optional(),

              defaultVariationValue: z.string().optional(),
              defaultVariableValues: z.record(z.string(), z.unknown()).optional(),

              expectedToBeEnabled: z.boolean().optional(),
              expectedVariation: z.string().nullable().optional(),
              expectedVariables: z.record(z.string(), z.unknown()).optional(),
              expectedEvaluations: expectedEvaluationsZodSchema.optional(),

              children: z
                .array(
                  z.object({
                    // copied from parent
                    sticky: z.record(z.string(), z.record(z.string(), z.any())).optional(),
                    context: z.record(z.string(), z.unknown()).optional(),

                    defaultVariationValue: z.string().optional(),
                    defaultVariableValues: z.record(z.string(), z.unknown()).optional(),

                    expectedToBeEnabled: z.boolean().optional(),
                    expectedVariation: z.string().nullable().optional(),
                    expectedVariables: z.record(z.string(), z.unknown()).optional(),

                    expectedEvaluations: expectedEvaluationsZodSchema.optional(),
                  }),
                )
                .optional(),
            })
            .strict(),
        )
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
              environment: Array.isArray(projectConfig.environments)
                ? refineWithMessage(
                    z.string(),
                    (value) =>
                      value.indexOf("${{") === 0 || projectConfig.environments.includes(value),
                    (value) => `Unknown environment "${value}"`,
                  )
                : z.never().optional(),
              target: refineWithMessage(
                z.string(),
                (value) => value.indexOf("${{") === 0 || availableTargetKeys.includes(value),
                (value) => `Unknown target "${value}"`,
              ).optional(),
              stickyVariables: z.record(z.string(), z.unknown()).optional(),
              context: z.record(z.string(), z.unknown()).optional(),
              defaultVariableValue: z.unknown().optional(),
              expectedValue: z.unknown().optional(),
              expectedEvaluation: expectedEvaluationZodSchema.optional(),
            })
            .strict()
            .superRefine((assertion, ctx) => {
              if (
                typeof assertion.expectedValue === "undefined" &&
                typeof assertion.expectedEvaluation === "undefined"
              ) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: "Expected at least one of expectedValue or expectedEvaluation",
                });
              }
            }),
        )
        .superRefine(validateAssertionKeys),
    })
    .strict();

  return z.unknown().superRefine((value, ctx) => {
    const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const schema = Object.prototype.hasOwnProperty.call(candidate, "feature")
      ? featureTestZodSchema
      : Object.prototype.hasOwnProperty.call(candidate, "segment")
        ? segmentTestZodSchema
        : Object.prototype.hasOwnProperty.call(candidate, "variable")
          ? variableTestZodSchema
          : z.never();
    const result = schema.safeParse(value);
    if (!result.success) {
      result.error.issues.forEach((issue) => ctx.addIssue({ ...issue }));
    }
  });
}
