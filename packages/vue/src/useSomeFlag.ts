import type { Ref } from "vue";
import type { FeatureKey } from "@featurevisor/types";

import { flagUntil } from "./flagUntil.js";
import type { ContextSource } from "./live.js";
import type { NonEmptyFeatureKeys } from "./useEveryFlag.js";

/**
 * Returns a readonly ref holding true when at least one feature is enabled,
 * updating like useFlag. Features are evaluated in order and evaluation stops at
 * the first enabled one, so later features are not evaluated, and modules do
 * not see them. An empty list holds false.
 */
export function useSomeFlag<K extends readonly FeatureKey[] | []>(
  featureKeys: NonEmptyFeatureKeys<K>,
  context?: ContextSource,
): Readonly<Ref<boolean>> {
  return flagUntil(featureKeys, context, true);
}
