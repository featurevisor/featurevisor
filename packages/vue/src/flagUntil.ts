import type { Ref } from "vue";
import type { FeatureKey } from "@featurevisor/types";

import { onFeatures, readContext, useLive, type ContextSource } from "./live.js";
import { useSdk } from "./useSdk.js";

/**
 * A readonly ref that evaluates the features in order and holds `stopAt` at the
 * first one whose state is `stopAt`, without evaluating the rest. Otherwise it
 * holds the opposite. useEveryFlag stops at false and useSomeFlag at true. A key
 * listed twice is evaluated once.
 */
export function flagUntil(
  featureKeys: readonly FeatureKey[],
  context: ContextSource | undefined,
  stopAt: boolean,
): Readonly<Ref<boolean>> {
  const sdk = useSdk();
  const keys = featureKeys.slice();

  return useLive(sdk, keys.length === 0 ? undefined : onFeatures(sdk, keys), () => {
    const resolved = readContext(context);

    for (let index = 0; index < keys.length; index++) {
      const featureKey = keys[index];

      // A key listed again was already evaluated and did not stop the loop.
      if (keys.indexOf(featureKey) !== index) continue;
      if (sdk.isEnabled(featureKey, resolved) === stopAt) return stopAt;
    }

    return !stopAt;
  });
}
