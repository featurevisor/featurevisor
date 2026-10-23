import type { Ref } from "vue";
import type { FeatureKey } from "@featurevisor/types";

import { flagUntil } from "./flagUntil.js";
import type { ContextSource } from "./live.js";

/**
 * A list of feature keys that is not written as an empty literal. A list built
 * at runtime is accepted, and an empty one follows Array semantics.
 */
export type NonEmptyFeatureKeys<K extends readonly FeatureKey[]> = K &
  (K extends readonly [] ? never : unknown);

/**
 * Returns a readonly ref holding true when every feature is enabled, updating
 * like useFlag. Features are evaluated in order and evaluation stops at the
 * first disabled one, so later features are not evaluated, and modules do not
 * see them. An empty list holds true.
 */
export function useEveryFlag<K extends readonly FeatureKey[] | []>(
  featureKeys: NonEmptyFeatureKeys<K>,
  context?: ContextSource,
): Readonly<Ref<boolean>> {
  return flagUntil(featureKeys, context, false);
}
