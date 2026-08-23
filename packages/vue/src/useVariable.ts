import type { Context, FeatureKey, VariableKey, VariableValue } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";

/**
 * Returns the evaluated variable. The optional type parameter only describes the
 * expected compile time result. TValue stays unconstrained so interfaces without
 * index signatures are accepted.
 */
export function useVariable<TValue = VariableValue>(
  featureKey: FeatureKey,
  variableKey: VariableKey,
  context: Context = {},
): TValue | null {
  const sdk = useSdk();

  return sdk.getVariable<TValue>(featureKey, variableKey, context);
}
