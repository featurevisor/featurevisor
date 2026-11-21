import { useMemo } from "react";
import type { Featurevisor } from "@featurevisor/sdk";
import type { Context, FeatureKey } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useScopedContext } from "./scope.js";
import { useFeaturesSubscription } from "./useFeaturesSubscription.js";
import { useEvaluated, useEveryUpdate, type Evaluated } from "./useEvaluated.js";

const EMPTY_CONTEXT: Context = {};

// Feature keys come from file names, so they never contain this character.
const SEPARATOR = "\u0000";

/**
 * One boolean per feature key, in the same order. An inline list gives an exact
 * tuple, and a list built at runtime gives `readonly boolean[]`.
 */
export type FlagValues<K extends readonly FeatureKey[]> = { readonly [I in keyof K]: boolean };

function evaluateFlags(
  isEnabled: (featureKey: FeatureKey, context: Context) => boolean,
  featureKeys: readonly FeatureKey[],
  context: Context,
): boolean[] {
  const evaluated = new Map<FeatureKey, boolean>();

  return featureKeys.map((featureKey) => {
    let enabled = evaluated.get(featureKey);
    if (enabled === undefined) {
      enabled = isEnabled(featureKey, context);
      evaluated.set(featureKey, enabled);
    }

    return enabled;
  });
}

function flags(sdk: Featurevisor, featureKeys: readonly FeatureKey[]): Evaluated<boolean[]> {
  const keys = featureKeys.slice();

  return {
    compute: (merged) => evaluateFlags((key, own) => sdk.isEnabled(key, own), keys, merged),
    options: { follows: { features: keys } },
    // No keys read nothing, so nothing can change the answer.
    constant: keys.length === 0,
  };
}

/**
 * Returns whether each feature is enabled, in the order of the keys, and
 * updates when any of them changes. A key listed twice is evaluated once.
 */
export function useFlags<K extends readonly FeatureKey[] | []>(
  featureKeys: K,
  context: Context = EMPTY_CONTEXT,
): FlagValues<K> {
  const sdk = useRequiredSdk();
  const scopedContext = useScopedContext(context);

  if (useEveryUpdate()) {
    useFeaturesSubscription(sdk, featureKeys);

    const values = evaluateFlags(
      (key, merged) => sdk.isEnabled(key, merged),
      featureKeys,
      scopedContext,
    );

    // The same values keep the same array, so the result can sit in dependency
    // lists. Evaluation still runs on every render, as it does for useFlag.
    const signature = values.map((enabled) => (enabled ? "1" : "0")).join("");

    return useMemo(() => values, [signature]) as unknown as FlagValues<K>;
  }

  // An inline list is a new array on every render, so the source follows the
  // keys it holds. The same values keep the same array, so the result can sit
  // in dependency lists.
  return useEvaluated(
    sdk,
    `${featureKeys.length}${SEPARATOR}${featureKeys.join(SEPARATOR)}`,
    scopedContext,
    flags,
    featureKeys,
  ) as unknown as FlagValues<K>;
}
