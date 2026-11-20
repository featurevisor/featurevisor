import type { Ref } from "vue";
import type { FeatureKey, VariationValue } from "@featurevisor/types";

import { onFeatures, useLive, type ContextSource } from "./live.js";
import { injectEveryUpdate, usePrecise } from "./precise.js";
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
  const read = () => readScopedContext(scope, context);

  if (injectEveryUpdate()) {
    return useLive(sdk, onFeatures(sdk, [featureKey]), () =>
      sdk.getVariation<TVariation>(featureKey, read()),
    );
  }

  return usePrecise(sdk, (merged) => sdk.getVariation<TVariation>(featureKey, merged), read, {
    equals: Object.is,
    follows: { features: [featureKey] },
  });
}
