import type { Context, FeatureKey } from "@featurevisor/types";

import { useFlagUntil } from "./useFlagUntil.js";

const EMPTY_CONTEXT: Context = {};

/**
 * A list of feature keys that is not written as an empty literal. A list built
 * at runtime is accepted, and an empty one follows Array semantics.
 */
export type NonEmptyFeatureKeys<K extends readonly FeatureKey[]> = K &
  (K extends readonly [] ? never : unknown);

/**
 * Returns true when every feature is enabled. Features are evaluated in order
 * and evaluation stops at the first disabled one, so later features are not
 * evaluated, and modules do not see them. An empty list returns true.
 */
export function useEveryFlag<const K extends readonly FeatureKey[]>(
  featureKeys: NonEmptyFeatureKeys<K>,
  context: Context = EMPTY_CONTEXT,
): boolean {
  return useFlagUntil(featureKeys, context, false);
}
