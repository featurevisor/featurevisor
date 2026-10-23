import type { Ref } from "vue";
import type { FeatureKey, VariationValue } from "@featurevisor/types";

import { onFeatures, readContext, useLive, type ContextSource } from "./live.js";
import { useSdk } from "./useSdk.js";

/**
 * Returns a readonly ref holding the evaluated variation, updating like useFlag.
 * The optional type parameter only narrows the compile time result.
 */
export function useVariation<TVariation extends VariationValue = VariationValue>(
  featureKey: FeatureKey,
  context?: ContextSource,
): Readonly<Ref<TVariation | null>> {
  const sdk = useSdk();

  return useLive(sdk, onFeatures(sdk, [featureKey]), () =>
    sdk.getVariation<TVariation>(featureKey, readContext(context)),
  );
}
