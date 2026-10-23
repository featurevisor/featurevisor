import type { Context, FeatureKey } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useFeaturesSubscription } from "./useFeaturesSubscription.js";

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
  useFeaturesSubscription(sdk, featureKeys);

  for (let index = 0; index < featureKeys.length; index++) {
    const featureKey = featureKeys[index];

    // A key listed again was already evaluated and did not stop the loop.
    if (featureKeys.indexOf(featureKey) !== index) continue;
    if (sdk.isEnabled(featureKey, context) === stopAt) return stopAt;
  }

  return !stopAt;
}
