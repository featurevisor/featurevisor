import type { Context, FeatureKey } from "@featurevisor/types";

import { useFlagUntil } from "./useFlagUntil.js";
import type { NonEmptyFeatureKeys } from "./useEveryFlag.js";

const EMPTY_CONTEXT: Context = {};

/**
 * Returns true when at least one feature is enabled. Features are evaluated in
 * order and evaluation stops at the first enabled one, so later features are not
 * evaluated, and modules do not see them. An empty list returns false.
 */
export function useSomeFlag<const K extends readonly FeatureKey[]>(
  featureKeys: NonEmptyFeatureKeys<K>,
  context: Context = EMPTY_CONTEXT,
): boolean {
  return useFlagUntil(featureKeys, context, true);
}
