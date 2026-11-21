import type { Featurevisor } from "@featurevisor/sdk";
import type { Context, FeatureKey } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useScopedContext } from "./scope.js";
import { useFeaturesSubscription } from "./useFeaturesSubscription.js";
import { flagUntil, useEvaluated, useEveryUpdate, type Evaluated } from "./useEvaluated.js";

// Feature keys come from file names, so they never contain this character.
const SEPARATOR = "\u0000";

function until(
  sdk: Featurevisor,
  featureKeys: readonly FeatureKey[],
  stopAt: boolean,
): Evaluated<boolean> {
  const keys = featureKeys.slice();

  return {
    compute: (merged) => flagUntil(sdk, keys, merged, stopAt),
    options: { equals: Object.is, follows: { features: keys } },
    // No keys read nothing: every flag of none is enabled, and none is some.
    constant: keys.length === 0,
  };
}

/**
 * Evaluates the features in order and returns `stopAt` at the first one whose
 * state is `stopAt`, without evaluating the rest. Otherwise it returns the
 * opposite. useEveryFlag stops at false and useSomeFlag at true. A key listed
 * twice is evaluated once.
 */
export function useFlagUntil(
  featureKeys: readonly FeatureKey[],
  context: Context,
  stopAt: boolean,
): boolean {
  const sdk = useRequiredSdk();
  const scopedContext = useScopedContext(context);

  if (useEveryUpdate()) {
    useFeaturesSubscription(sdk, featureKeys);

    for (let index = 0; index < featureKeys.length; index++) {
      const featureKey = featureKeys[index];

      // A key listed again was already evaluated and did not stop the loop.
      if (featureKeys.indexOf(featureKey) !== index) continue;
      if (sdk.isEnabled(featureKey, scopedContext) === stopAt) return stopAt;
    }

    return !stopAt;
  }

  return useEvaluated(
    sdk,
    `${stopAt}${SEPARATOR}${featureKeys.length}${SEPARATOR}${featureKeys.join(SEPARATOR)}`,
    scopedContext,
    until,
    featureKeys,
    stopAt,
  );
}
