import type { Context, FeatureKey, VariableKey, VariableValue } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useScopedContext } from "./scope.js";
import { useEvaluationSubscription } from "./useEvaluationSubscription.js";

const EMPTY_CONTEXT: Context = {};

/**
 * Returns the evaluated variable and updates it when the feature changes. The
 * optional type parameter only describes the expected compile time result.
 * TValue stays unconstrained so interfaces without index signatures are accepted.
 */
export function useVariable<TValue = VariableValue>(
  featureKey: FeatureKey,
  variableKey: VariableKey,
  context?: Context,
): TValue | null;
export function useVariable<TValue = VariableValue>(
  variableKey: VariableKey,
  context?: Context,
): TValue | null;
export function useVariable<TValue = VariableValue>(
  featureKeyOrVariableKey: FeatureKey | VariableKey,
  variableKeyOrContext: VariableKey | Context = EMPTY_CONTEXT,
  context: Context = EMPTY_CONTEXT,
): TValue | null {
  const sdk = useRequiredSdk();
  const isStandaloneVariable = typeof variableKeyOrContext !== "string";
  const resolvedContext = useScopedContext(isStandaloneVariable ? variableKeyOrContext : context);
  useEvaluationSubscription(sdk, featureKeyOrVariableKey, isStandaloneVariable);

  // Context and module inputs are evaluated on every render. Runtime programs
  // can return fresh objects, so storing their results in an effect would loop
  // with inline contexts. Values, including functions, never enter React state.
  return isStandaloneVariable
    ? sdk.getVariable<TValue>(featureKeyOrVariableKey, resolvedContext)
    : sdk.getVariable<TValue>(featureKeyOrVariableKey, variableKeyOrContext, resolvedContext);
}
