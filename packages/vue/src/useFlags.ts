import { computed, type Ref } from "vue";
import type { FeatureKey } from "@featurevisor/types";

import { onFeatures, readContext, useLive, type ContextSource } from "./live.js";
import { useSdk } from "./useSdk.js";

/**
 * One readonly ref per feature key, in the same order. An inline list gives an
 * exact tuple, and a list built at runtime gives an array.
 */
export type FlagRefs<K extends readonly FeatureKey[]> = {
  readonly [I in keyof K]: Readonly<Ref<boolean>>;
};

/**
 * Returns a readonly ref for each feature, in the order of the keys, so the
 * result can be destructured. They update when a datafile changes any of the
 * features, when the context or sticky values change, and when a ref or prop
 * the context reads changes. The keys are read once. A key listed twice is
 * evaluated once.
 */
export function useFlags<K extends readonly FeatureKey[] | []>(
  featureKeys: K,
  context?: ContextSource,
): FlagRefs<K> {
  const sdk = useSdk();
  const keys = featureKeys.slice();

  const values = useLive(sdk, keys.length === 0 ? undefined : onFeatures(sdk, keys), () => {
    const resolved = readContext(context);
    const evaluated = new Map<FeatureKey, boolean>();

    return keys.map((featureKey) => {
      let enabled = evaluated.get(featureKey);
      if (enabled === undefined) {
        enabled = sdk.isEnabled(featureKey, resolved);
        evaluated.set(featureKey, enabled);
      }

      return enabled;
    });
  });

  return keys.map((_, index) => computed(() => values.value[index])) as unknown as FlagRefs<K>;
}
