import type { Context, FeatureKey } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useScopedContext } from "./scope.js";
import { useFeaturesSubscription } from "./useFeaturesSubscription.js";
import { flagUntil, useEvaluated, useEveryUpdate } from "./useEvaluated.js";

// Feature keys come from file names, so they never contain this character.
const SEPARATOR = "\u0000";

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

  const signature = featureKeys.join(SEPARATOR);
  const count = featureKeys.length;

  const keys = count === 0 ? [] : signature.split(SEPARATOR);

  return useEvaluated(
    sdk,
    `${stopAt}${SEPARATOR}${count}${SEPARATOR}${signature}`,
    scopedContext,
    (merged) => flagUntil(sdk, keys, merged, stopAt),
    // No keys read nothing: every flag of none is enabled, and none is some.
    { equals: Object.is, follows: { features: keys }, constant: count === 0 },
  );
}
