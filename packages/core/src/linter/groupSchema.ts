import { z } from "zod";

import { ProjectConfig } from "../config";
import { Datasource } from "../datasource";

export function getGroupZodSchema(
  projectConfig: ProjectConfig,
  datasource: Datasource,
  availableFeatureKeys: string[],
) {
  const groupZodSchema = z
    .object({
      description: z.string(),
      slots: z
        .array(
          z
            .object({
              feature: z
                .string()
                .optional()
                .refine(
                  (value) => {
                    if (value && availableFeatureKeys.indexOf(value) === -1) {
                      return false;
                    }

                    return true;
                  },
                  (value) => ({ message: `Unknown feature "${value}"` }),
                ),
              percentage: z.number().min(0).max(100),
            })
            .strict(),
        )
        .refine(
          (value) => {
            const totalPercentage = value.reduce((acc, slot) => acc + slot.percentage, 0);

            return totalPercentage === 100;
          },
          { message: "Total percentage of all slots is not 100" },
        ),
    })
    .strict();

  return groupZodSchema;
}
