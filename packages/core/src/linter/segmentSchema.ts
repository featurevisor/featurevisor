import { z } from "zod";

import { ProjectConfig } from "../config";

export function getSegmentZodSchema(projectConfig: ProjectConfig, conditionsZodSchema) {
  const segmentZodSchema = z
    .object({
      archived: z.boolean().optional(),
      promotable: z.boolean().optional(),
      description: z.string({
        error: (issue) => (issue.input === undefined ? "Required" : undefined),
      }),
      conditions: conditionsZodSchema,
    })
    .strict();

  return segmentZodSchema;
}
