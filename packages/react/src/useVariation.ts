import type { Context, FeatureKey, VariationValue } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useScopedContext } from "./scope.js";
import { useEvaluationSubscription } from "./useEvaluationSubscription.js";
import { useEvaluated, useEveryUpdate } from "./useEvaluated.js";

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

  if (useEveryUpdate()) {
    useEvaluationSubscription(sdk, featureKey);
    return sdk.getVariation<TVariation>(featureKey, scopedContext);
  }

  return useEvaluated(
    sdk,
    featureKey,
    scopedContext,
    (merged) => sdk.getVariation<TVariation>(featureKey, merged),
    { equals: Object.is, follows: { features: [featureKey] } },
  );
}
