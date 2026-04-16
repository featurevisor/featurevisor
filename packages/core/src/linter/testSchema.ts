import { z } from "zod";

import { ProjectConfig } from "../config";
import { refineWithMessage } from "./zodHelpers";

export function getTestsZodSchema(
  projectConfig: ProjectConfig,
  availableFeatureKeys: [string, ...string[]],
  availableSegmentKeys: [string, ...string[]],
) {
  const scopeNames = projectConfig.scopes ? projectConfig.scopes.map((scope) => scope.name) : [];

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

  const segmentTestZodSchema = z
    .object({
      segment: refineWithMessage(
        z.string(),
        (value) => availableSegmentKeys.includes(value),
        (value) => `Unknown segment "${value}"`,
      ),
      assertions: z.array(
        z
          .object({
            matrix: matrixZodSchema.optional(),
            description: z.string().optional(),
            context: z.record(z.string(), z.unknown()),
            expectedToMatch: z.boolean(),
          })
          .strict(),
      ),
    })
    .strict();

  const featureTestZodSchema = z
    .object({
      feature: refineWithMessage(
        z.string(),
        (value) => availableFeatureKeys.includes(value),
        (value) => `Unknown feature "${value}"`,
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
            tag: refineWithMessage(
              z.string(),
              (value) => projectConfig.tags.includes(value),
              (value) => `Unknown tag "${value}"`,
            ).optional(),
            scope: refineWithMessage(
              z.string(),
              (value) => scopeNames.includes(value),
              (value) => `Unknown scope "${value}"`,
            ).optional(),

            // parent
            sticky: z.record(z.string(), z.record(z.string(), z.any())).optional(),
            context: z.record(z.string(), z.unknown()).optional(),

            defaultVariationValue: z.string().optional(),
            defaultVariableValues: z.record(z.string(), z.unknown()).optional(),

            expectedToBeEnabled: z.boolean().optional(),
            expectedVariation: z.string().nullable().optional(),
            expectedVariables: z.record(z.string(), z.unknown()).optional(),
            expectedEvaluations: z
              .object({
                flag: z.record(z.string(), z.any()).optional(),
                variation: z.record(z.string(), z.any()).optional(),
                variables: z.record(z.string(), z.record(z.string(), z.any())).optional(),
              })
              .optional(),

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

                  expectedEvaluations: z
                    .object({
                      flag: z.record(z.string(), z.any()).optional(),
                      variation: z.record(z.string(), z.any()).optional(),
                      variables: z.record(z.string(), z.record(z.string(), z.any())).optional(),
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
