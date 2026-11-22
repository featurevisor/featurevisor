import type { Featurevisor } from "@featurevisor/sdk";
import type { Context, FeatureKey, VariationValue } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useScopedContext } from "./scope.js";
import { useEvaluated, type Evaluated } from "./useEvaluated.js";

function variation(sdk: Featurevisor, featureKey: FeatureKey): Evaluated<VariationValue | null> {
  return {
    compute: (merged) => sdk.getVariation(featureKey, merged),
    options: { equals: Object.is, follows: { features: [featureKey] } },
  };
}

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

  return useEvaluated(sdk, featureKey, scopedContext, variation, featureKey) as TVariation | null;
}
