import type {
  Context,
  FeatureKey,
  TopLevelVariableKey,
  VariableKey,
  VariableValue,
} from "@featurevisor/types";

import { useSdk } from "./useSdk.js";

/**
 * Returns the evaluated variable. The optional type parameter only describes the
 * expected compile time result. TValue stays unconstrained so interfaces without
 * index signatures are accepted.
 */
export function useVariable<TValue = VariableValue>(
  featureKey: FeatureKey,
  variableKey: VariableKey,
  context?: Context,
): TValue | null;
export function useVariable<TValue = VariableValue>(
  variableKey: TopLevelVariableKey,
  context?: Context,
): TValue | null;
export function useVariable<TValue = VariableValue>(
  featureKeyOrVariableKey: FeatureKey | TopLevelVariableKey,
  variableKeyOrContext: VariableKey | Context = {},
  context: Context = {},
): TValue | null {
  const sdk = useSdk();

  return typeof variableKeyOrContext === "string"
    ? sdk.getVariable<TValue>(featureKeyOrVariableKey, variableKeyOrContext, context)
    : sdk.getVariable<TValue>(featureKeyOrVariableKey, variableKeyOrContext);
}
