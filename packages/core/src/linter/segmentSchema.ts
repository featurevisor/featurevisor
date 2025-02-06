import { z } from "zod";

import { ProjectConfig } from "../config";

export function getSegmentZodSchema(projectConfig: ProjectConfig, conditionsZodSchema) {
  const segmentZodSchema = z
    .object({
      archived: z.boolean().optional(),
      description: z.string(),
      conditions: conditionsZodSchema,
    })
    .strict();

  return segmentZodSchema;
}
