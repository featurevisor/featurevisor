import type { Context, FeatureKey, VariationValue } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";
import { useEvaluationSubscription } from "./useEvaluationSubscription.js";

/**
 * Returns the evaluated variation and updates it when the feature changes. The
 * optional type parameter only narrows the compile time result.
 */
export function useVariation<TVariation extends VariationValue = VariationValue>(
  featureKey: FeatureKey,
  context: Context = {},
): TVariation | null {
  const sdk = useSdk();
  useEvaluationSubscription(sdk, featureKey);

  return sdk.getVariation<TVariation>(featureKey, context);
}
