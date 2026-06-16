import type { Context, FeatureKey, VariationValue } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";

export function useVariation(
  featureKey: FeatureKey,
  context: Context = {},
): VariationValue | undefined {
  const sdk = useSdk();

  return sdk.getVariation(featureKey, context);
}
