import { z } from "zod";

import type { ProjectConfig } from "../config";
import { refineWithMessage } from "./zodHelpers";

const targetTagSchema = (projectConfig: ProjectConfig) =>
  refineWithMessage(
    z.string(),
    (value) => projectConfig.tags.includes(value),
    (value) => `Unknown tag "${value}"`,
  );

export function getTargetZodSchema(projectConfig: ProjectConfig) {
  const tagSchema = targetTagSchema(projectConfig);
  const entityPatternSchema = z
    .string()
    .min(1)
    .refine((value) => value.trim() === value, "Entity patterns cannot have surrounding spaces")
    .refine((value) => !value.includes("**"), 'Use "*" for glob-like wildcard matching');
  const entityPatternsSchema = z.union([z.literal("*"), z.array(entityPatternSchema).min(1)]);

  return z
    .object({
      key: z.string().optional(),
      promotable: z.boolean().optional(),
      description: z.string({
        error: (issue) => (issue.input === undefined ? "Required" : undefined),
      }),
      tag: tagSchema.optional(),
      tags: z
        .union([
          z.array(tagSchema).min(1),
          z.object({ or: z.array(tagSchema).min(1) }).strict(),
          z.object({ and: z.array(tagSchema).min(1) }).strict(),
        ])
        .optional(),
      includeFeatures: entityPatternsSchema.optional(),
      excludeFeatures: entityPatternsSchema.optional(),
      includeVariables: entityPatternsSchema.optional(),
      excludeVariables: entityPatternsSchema.optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    })
    .strict()
    .refine((target) => !(target.tag && target.tags), {
      message: 'Only one of "tag" or "tags" can be defined',
      path: ["tags"],
    });
}
