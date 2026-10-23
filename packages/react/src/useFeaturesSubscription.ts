import type { Featurevisor } from "@featurevisor/sdk";
import type { FeatureKey } from "@featurevisor/types";

import { useSubscription } from "./changeTracker.js";
import { onFeaturesChange } from "./onFeaturesChange.js";

// Feature keys come from file names, so they never contain this character.
const SEPARATOR = "\u0000";

/**
 * Subscribes once for a list of features, whatever its length. An inline list
 * is a new array on every render, so the subscription follows the keys it
 * holds rather than its identity. An empty list subscribes to nothing.
 */
export function useFeaturesSubscription(
  sdk: Featurevisor,
  featureKeys: readonly FeatureKey[],
): void {
  const signature = featureKeys.join(SEPARATOR);
  const count = featureKeys.length;

  useSubscription(
    sdk,
    count === 0
      ? undefined
      : (refresh) => onFeaturesChange(sdk, signature.split(SEPARATOR), refresh),
    [signature, count],
  );
}
