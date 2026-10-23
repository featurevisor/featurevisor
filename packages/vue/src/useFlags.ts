import type { Context, FeatureKey } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";

/**
 * One boolean per feature key, in the same order. An inline list gives an exact
 * tuple, and a list built at runtime gives `readonly boolean[]`.
 */
export type FlagValues<K extends readonly FeatureKey[]> = { readonly [I in keyof K]: boolean };

/**
 * Returns whether each feature is enabled, in the order of the keys. Like
 * useFlag, the values are plain, evaluated when called, and do not update. A
 * key listed twice is evaluated once.
 */
export function useFlags<const K extends readonly FeatureKey[]>(
  featureKeys: K,
  context: Context = {},
): FlagValues<K> {
  const sdk = useSdk();

  const evaluated = new Map<FeatureKey, boolean>();
  return featureKeys.map((featureKey) => {
    let enabled = evaluated.get(featureKey);
    if (enabled === undefined) {
      enabled = sdk.isEnabled(featureKey, context);
      evaluated.set(featureKey, enabled);
    }

    return enabled;
  }) as unknown as FlagValues<K>;
}
