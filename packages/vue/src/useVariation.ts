import type { Ref } from "vue";
import type { FeatureKey, VariationValue } from "@featurevisor/types";

import { onFeatures, useLive, type ContextSource } from "./live.js";
import { injectScope, readScopedContext } from "./scope.js";
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
  const scope = injectScope();

  return useLive(sdk, onFeatures(sdk, [featureKey]), () =>
    sdk.getVariation<TVariation>(featureKey, readScopedContext(scope, context)),
  );
}
