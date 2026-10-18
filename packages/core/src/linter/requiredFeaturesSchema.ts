import type { ParsedFeature } from "@featurevisor/types";
import { z } from "zod";

import { refineWithMessage, UNKNOWN_REFERENCE } from "./zodHelpers";
import { suggestKey } from "./diagnostics";

export function getFeatureConditionZodSchema(
  featuresByKey: Record<string, ParsedFeature>,
  availableFeatureKeys: string[] = Object.keys(featuresByKey),
) {
  // References to archived features are checked separately, see definitionReferences.
  const featureKeySchema = refineWithMessage(
    z.string().min(1),
    (key) => availableFeatureKeys.indexOf(key) !== -1,
    (key) => `Unknown feature "${key}".${suggestKey(key, availableFeatureKeys)}`,
    () => UNKNOWN_REFERENCE,
  );

  const objectSchema = z
    .object({
      feature: featureKeySchema,
      enabled: z.boolean().optional(),
      variation: z.string().min(1).optional(),
    })
    .strict()
    .superRefine((required, ctx) => {
      if (typeof required.variation === "undefined") return;
      // An unknown feature is reported once, by the key itself.
      if (!Object.prototype.hasOwnProperty.call(featuresByKey, required.feature)) return;
      const feature = featuresByKey[required.feature];
      const values = [
        ...(feature?.variations || []).map((item) => item.value),
        ...(feature?.disabledVariationValue !== undefined ? [feature.disabledVariationValue] : []),
      ];
      if (values.indexOf(required.variation) === -1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown variation "${required.variation}" for feature "${required.feature}"`,
          path: ["variation"],
        });
      }
    });
  return objectSchema;
}
