import { computed, type Ref } from "vue";
import type { Context, FeatureKey } from "@featurevisor/types";

import { onFeatures, useLive, type ContextSource } from "./live.js";
import { injectEveryUpdate, usePrecise } from "./precise.js";
import { injectScope, readScopedContext } from "./scope.js";
import { useSdk } from "./useSdk.js";

/**
 * One readonly ref per feature key, in the same order. An inline list gives an
 * exact tuple, and a list built at runtime gives an array.
 */
export type FlagRefs<K extends readonly FeatureKey[]> = {
  readonly [I in keyof K]: Readonly<Ref<boolean>>;
};

function evaluate(
  isEnabled: (featureKey: FeatureKey, context: Context) => boolean,
  keys: readonly FeatureKey[],
  context: Context,
): boolean[] {
  const evaluated = new Map<FeatureKey, boolean>();

  return keys.map((featureKey) => {
    let enabled = evaluated.get(featureKey);
    if (enabled === undefined) {
      enabled = isEnabled(featureKey, context);
      evaluated.set(featureKey, enabled);
    }

    return enabled;
  });
}

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
  const scope = injectScope();
  const keys = featureKeys.slice();
  const read = () => readScopedContext(scope, context);
  const isEnabled = (featureKey: FeatureKey, merged: Context) => sdk.isEnabled(featureKey, merged);

  const values: Readonly<Ref<boolean[]>> = injectEveryUpdate()
    ? useLive(sdk, keys.length === 0 ? undefined : onFeatures(sdk, keys), () =>
        evaluate(isEnabled, keys, read()),
      )
    : usePrecise(sdk, (merged) => evaluate(isEnabled, keys, merged), read, {
        follows: { features: keys },
        // No keys read nothing, so nothing can change the answer.
        constant: keys.length === 0,
      });

  return keys.map((_, index) => computed(() => values.value[index])) as unknown as FlagRefs<K>;
}
