import type { Context, FeatureKey } from "@featurevisor/types";

import { flagUntil } from "./flagUntil.js";
import type { NonEmptyFeatureKeys } from "./useEveryFlag.js";

/**
 * Returns true when at least one feature is enabled, as a plain value. Features
 * are evaluated in order and evaluation stops at the first enabled one, so later
 * features are not evaluated, and modules do not see them. An empty list
 * returns false.
 */
export function useSomeFlag<K extends readonly FeatureKey[] | []>(
  featureKeys: NonEmptyFeatureKeys<K>,
  context: Context = {},
): boolean {
  return flagUntil(featureKeys, context, true);
}
