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
          z.array(tagSchema),
          z.object({ or: z.array(tagSchema) }).strict(),
          z.object({ and: z.array(tagSchema) }).strict(),
        ])
        .optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    })
    .strict()
    .refine((target) => !(target.tag && target.tags), {
      message: 'Only one of "tag" or "tags" can be defined',
      path: ["tags"],
    });
}
