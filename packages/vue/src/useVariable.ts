import type { Context, FeatureKey, VariableKey, VariableValue } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";

// Keep TValue unconstrained for interfaces without index signatures.
export function useVariable<TValue = VariableValue>(
  featureKey: FeatureKey,
  variableKey: VariableKey,
  context: Context = {},
): TValue | null {
  const sdk = useSdk();

  return sdk.getVariable<TValue>(featureKey, variableKey, context);
}
