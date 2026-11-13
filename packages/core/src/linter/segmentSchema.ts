import { z } from "zod";

import { ProjectConfig } from "../config";
import { removedConditionFields, refineRequiredConditions } from "./removedConditionFields";
import { getMetadataZodSchema, requiredMetadataChecks } from "./metadataSchema";

export function getSegmentZodSchema(projectConfig: ProjectConfig, conditionsZodSchema) {
  const segmentZodSchema = z
    .object({
      archived: z.boolean().optional(),
      promotable: z.boolean().optional(),
      description: z.string({
        error: (issue) => (issue.input === undefined ? "Required" : undefined),
      }),
      metadata: getMetadataZodSchema(projectConfig).optional(),
      conditions: conditionsZodSchema.optional(),
      ...removedConditionFields,
    })
    .strict()
    .superRefine(refineRequiredConditions)
    .check(...requiredMetadataChecks(projectConfig, "segments"));

  const editorSchema = z
    .object({
      ...segmentZodSchema.shape,
      conditions: conditionsZodSchema.editorSchema || conditionsZodSchema,
    })
    .omit({ segments: true, requiredFeatures: true, requiredVariables: true })
    .strict();
  return Object.assign(segmentZodSchema, { editorSchema });
}
