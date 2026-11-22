import type { Featurevisor } from "@featurevisor/sdk";
import type { Context, FeatureKey, VariableKey, VariableValue } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useScopedContext } from "./scope.js";
import { useEvaluated, type Evaluated } from "./useEvaluated.js";

const EMPTY_CONTEXT: Context = {};

// Feature and variable keys come from file names, so they never contain this character.
const SEPARATOR = "\u0000";

function featureVariable(
  sdk: Featurevisor,
  featureKey: FeatureKey,
  variableKey: VariableKey,
): Evaluated<unknown> {
  return {
    compute: (merged) => sdk.getVariable(featureKey, variableKey, merged),
    options: { follows: { features: [featureKey] } },
  };
}

function globalVariable(sdk: Featurevisor, variableKey: VariableKey): Evaluated<unknown> {
  return {
    compute: (merged) => sdk.getVariable(variableKey, merged),
    options: { follows: { variables: [variableKey] } },
  };
}

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

  if (isStandaloneVariable) {
    return useEvaluated(
      sdk,
      SEPARATOR + featureKeyOrVariableKey,
      resolvedContext,
      globalVariable,
      featureKeyOrVariableKey,
    ) as TValue | null;
  }

  return useEvaluated(
    sdk,
    featureKeyOrVariableKey + SEPARATOR + variableKeyOrContext,
    resolvedContext,
    featureVariable,
    featureKeyOrVariableKey,
    variableKeyOrContext,
  ) as TValue | null;
}
