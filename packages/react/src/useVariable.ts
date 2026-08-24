import { useEffect, useState } from "react";

import type {
  Context,
  FeatureKey,
  TopLevelVariableKey,
  VariableKey,
  VariableValue,
} from "@featurevisor/types";

import { useSdk } from "./useSdk.js";
import { onFeatureChange } from "./onFeatureChange.js";
import { onVariableChange } from "./onVariableChange.js";

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
  variableKey: TopLevelVariableKey,
  context?: Context,
): TValue | null;
export function useVariable<TValue = VariableValue>(
  featureKeyOrVariableKey: FeatureKey | TopLevelVariableKey,
  variableKeyOrContext: VariableKey | Context = EMPTY_CONTEXT,
  context: Context = EMPTY_CONTEXT,
): TValue | null {
  const sdk = useSdk();
  const isTopLevel = typeof variableKeyOrContext !== "string";
  const resolvedContext = isTopLevel ? variableKeyOrContext : context;
  const evaluate = () =>
    isTopLevel
      ? sdk.getVariable<TValue>(featureKeyOrVariableKey, resolvedContext)
      : sdk.getVariable<TValue>(featureKeyOrVariableKey, variableKeyOrContext, resolvedContext);
  const [variableValue, setVariableValue] = useState<TValue | null>(() => evaluate());

  useEffect(() => {
    setVariableValue(evaluate());

    const onChange = () => {
      const newValue = evaluate();
      setVariableValue((prev) => (newValue !== prev ? newValue : prev));
    };
    const unsubscribe = isTopLevel
      ? onVariableChange(sdk, featureKeyOrVariableKey, onChange)
      : onFeatureChange(sdk, featureKeyOrVariableKey, onChange);

    return unsubscribe;
  }, [sdk, featureKeyOrVariableKey, variableKeyOrContext, context]);

  return variableValue;
}
