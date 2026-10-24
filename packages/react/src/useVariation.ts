import type { Context, FeatureKey, VariationValue } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useScopedContext } from "./scope.js";
import { useEvaluationSubscription } from "./useEvaluationSubscription.js";

/**
 * Returns the evaluated variation and updates it when the feature changes. The
 * optional type parameter only narrows the compile time result.
 */
export function useVariation<TVariation extends VariationValue = VariationValue>(
  featureKey: FeatureKey,
  context: Context = {},
): TVariation | null {
  const sdk = useRequiredSdk();
  const scopedContext = useScopedContext(context);
  useEvaluationSubscription(sdk, featureKey);

  return sdk.getVariation<TVariation>(featureKey, scopedContext);
}
