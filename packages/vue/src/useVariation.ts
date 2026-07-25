import type { Context, FeatureKey, VariationValue } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";

export function useVariation(featureKey: FeatureKey, context: Context = {}): VariationValue | null {
  const sdk = useSdk();

  return sdk.getVariation(featureKey, context);
}
