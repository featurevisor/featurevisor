import { useMemo } from "react";
import type { Context, FeatureKey } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useFeaturesSubscription } from "./useFeaturesSubscription.js";

const EMPTY_CONTEXT: Context = {};

/**
 * One boolean per feature key, in the same order. An inline list gives an exact
 * tuple, and a list built at runtime gives `readonly boolean[]`.
 */
export type FlagValues<K extends readonly FeatureKey[]> = { readonly [I in keyof K]: boolean };

/**
 * Returns whether each feature is enabled, in the order of the keys, and
 * updates when any of them changes. A key listed twice is evaluated once.
 */
export function useFlags<const K extends readonly FeatureKey[]>(
  featureKeys: K,
  context: Context = EMPTY_CONTEXT,
): FlagValues<K> {
  const sdk = useRequiredSdk();
  useFeaturesSubscription(sdk, featureKeys);

  const evaluated = new Map<FeatureKey, boolean>();
  const values = featureKeys.map((featureKey) => {
    let enabled = evaluated.get(featureKey);
    if (enabled === undefined) {
      enabled = sdk.isEnabled(featureKey, context);
      evaluated.set(featureKey, enabled);
    }

    return enabled;
  });

  // The same values keep the same array, so the result can sit in dependency
  // lists. Evaluation still runs on every render, as it does for useFlag.
  const signature = values.map((enabled) => (enabled ? "1" : "0")).join("");

  return useMemo(() => values, [signature]) as unknown as FlagValues<K>;
}
