import type { Ref } from "vue";
import type { FeatureKey } from "@featurevisor/types";

import { onFeatures, readContext, useLive, type ContextSource } from "./live.js";
import { useSdk } from "./useSdk.js";

/**
 * Returns a readonly ref holding whether the feature is enabled. It updates when
 * a datafile changes the feature, when the context or sticky values change, and
 * when a ref or prop the context reads changes.
 */
export function useFlag(featureKey: FeatureKey, context?: ContextSource): Readonly<Ref<boolean>> {
  const sdk = useSdk();

  return useLive(sdk, onFeatures(sdk, [featureKey]), () =>
    sdk.isEnabled(featureKey, readContext(context)),
  );
}
