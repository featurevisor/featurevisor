import { z } from "zod";

import { ProjectConfig } from "../config";

export function getTestsZodSchema(
  projectConfig: ProjectConfig,
  availableFeatureKeys: [string, ...string[]],
  availableSegmentKeys: [string, ...string[]],
) {
  const scopeNames = projectConfig.scopes ? projectConfig.scopes.map((scope) => scope.name) : [];

  const matrixZodSchema = z.record(
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

  const segmentTestZodSchema = z
    .object({
      segment: z.string().refine(
        (value) => availableSegmentKeys.includes(value),
        (value) => ({
          message: `Unknown segment "${value}"`,
        }),
      ),
      assertions: z.array(
        z
          .object({
            matrix: matrixZodSchema.optional(),
            description: z.string().optional(),
            context: z.record(z.unknown()),
            expectedToMatch: z.boolean(),
          })
          .strict(),
      ),
    })
    .strict();

  const featureTestZodSchema = z
    .object({
      feature: z.string().refine(
        (value) => availableFeatureKeys.includes(value),
        (value) => ({
          message: `Unknown feature "${value}"`,
        }),
      ),
      assertions: z.array(
        z
          .object({
            matrix: matrixZodSchema.optional(),
            description: z.string().optional(),
            at: z.union([
              z.number().min(0).max(100),

              // because of supporting matrix
              z.string(),
            ]),
            environment: Array.isArray(projectConfig.environments)
              ? z.string().refine(
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
                  (value) => ({
                    message: `Unknown environment "${value}"`,
                  }),
                )
              : z.never().optional(),
            scope: z
              .string()
              .refine(
                (value) => scopeNames.includes(value),
                (value) => ({
                  message: `Unknown scope "${value}"`,
                }),
              )
              .optional(),

            // parent
            sticky: z.record(z.record(z.any())).optional(),
            context: z.record(z.unknown()).optional(),

            defaultVariationValue: z.string().optional(),
            defaultVariableValues: z.record(z.unknown()).optional(),

            expectedToBeEnabled: z.boolean().optional(),
            expectedVariation: z.string().nullable().optional(),
            expectedVariables: z.record(z.unknown()).optional(),
            expectedEvaluations: z
              .object({
                flag: z.record(z.any()).optional(),
                variation: z.record(z.any()).optional(),
                variables: z.record(z.record(z.any())).optional(),
              })
              .optional(),

            children: z
              .array(
                z.object({
                  // copied from parent
                  sticky: z.record(z.record(z.any())).optional(),
                  context: z.record(z.unknown()).optional(),

                  defaultVariationValue: z.string().optional(),
                  defaultVariableValues: z.record(z.unknown()).optional(),

                  expectedToBeEnabled: z.boolean().optional(),
                  expectedVariation: z.string().nullable().optional(),
                  expectedVariables: z.record(z.unknown()).optional(),

                  expectedEvaluations: z
                    .object({
                      flag: z.record(z.any()).optional(),
                      variation: z.record(z.any()).optional(),
                      variables: z.record(z.record(z.any())).optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
          })
          .strict(),
      ),
    })
    .strict();

  return z.union([segmentTestZodSchema, featureTestZodSchema]);
}
