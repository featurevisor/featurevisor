import type { ParsedFeature } from "@featurevisor/types";
import { z } from "zod";

import { refineWithMessage } from "./zodHelpers";

export function getRequiredFeaturesZodSchema(
  featuresByKey: Record<string, ParsedFeature>,
  availableFeatureKeys: string[] = Object.keys(featuresByKey),
) {
  const featureKeySchema = refineWithMessage(
    z.string().min(1),
    (key) => availableFeatureKeys.indexOf(key) !== -1 && featuresByKey[key]?.archived !== true,
    (key) =>
      availableFeatureKeys.indexOf(key) !== -1
        ? `Required feature "${key}" is archived`
        : `Unknown required feature "${key}"`,
  );

  const itemSchema = z.union([
    featureKeySchema,
    z
      .object({
        feature: featureKeySchema,
        enabled: z.boolean().optional(),
        variation: z.string().min(1).optional(),
      })
      .strict()
      .superRefine((required, ctx) => {
        if (typeof required.variation === "undefined") return;
        const values = (featuresByKey[required.feature]?.variations || []).map(
          (item) => item.value,
        );
        if (values.indexOf(required.variation) === -1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown variation "${required.variation}" for required feature "${required.feature}"`,
            path: ["variation"],
          });
        }
      }),
  ]);

  return z.union([featureKeySchema, z.array(itemSchema).min(1)]);
}
