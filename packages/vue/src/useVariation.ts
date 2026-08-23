import type { Context, FeatureKey, VariationValue } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";

/**
 * Returns the evaluated variation. The optional type parameter only narrows the
 * compile time result.
 */
export function useVariation<TVariation extends VariationValue = VariationValue>(
  featureKey: FeatureKey,
  context: Context = {},
): TVariation | null {
  const sdk = useSdk();

  return sdk.getVariation<TVariation>(featureKey, context);
}
