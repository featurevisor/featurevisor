import { useEffect, useState } from "react";

import type {
  Context,
  FeatureKey,
  GlobalVariableKey,
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
  variableKey: GlobalVariableKey,
  context?: Context,
): TValue | null;
export function useVariable<TValue = VariableValue>(
  featureKeyOrVariableKey: FeatureKey | GlobalVariableKey,
  variableKeyOrContext: VariableKey | Context = EMPTY_CONTEXT,
  context: Context = EMPTY_CONTEXT,
): TValue | null {
  const sdk = useSdk();
  const isGlobal = typeof variableKeyOrContext !== "string";
  const resolvedContext = isGlobal ? variableKeyOrContext : context;
  const evaluate = () =>
    isGlobal
      ? sdk.getVariable<TValue>(featureKeyOrVariableKey, resolvedContext)
      : sdk.getVariable<TValue>(featureKeyOrVariableKey, variableKeyOrContext, resolvedContext);
  const [variableValue, setVariableValue] = useState<TValue | null>(() => evaluate());

  useEffect(() => {
    setVariableValue(evaluate());

    const onChange = () => {
      const newValue = evaluate();
      setVariableValue((prev) => (newValue !== prev ? newValue : prev));
    };
    const unsubscribe = isGlobal
      ? onVariableChange(sdk, featureKeyOrVariableKey, onChange)
      : onFeatureChange(sdk, featureKeyOrVariableKey, onChange);

    return unsubscribe;
  }, [sdk, featureKeyOrVariableKey, variableKeyOrContext, context]);

  return variableValue;
}

/** Explicit form of the global variable overload. */
export function useGlobalVariable<TValue = VariableValue>(
  variableKey: GlobalVariableKey,
  context: Context = EMPTY_CONTEXT,
): TValue | null {
  return useVariable<TValue>(variableKey, context);
}
