import { useEffect, useState } from "react";

import type { Context, FeatureKey, VariableKey, VariableValue } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";
import { onFeatureChange } from "./onFeatureChange.js";

export function useVariable<TValue = VariableValue>(
  featureKey: FeatureKey,
  variableKey: VariableKey,
  context: Context = {},
): TValue | null {
  const sdk = useSdk();
  const [variableValue, setVariableValue] = useState<TValue | null>(() =>
    sdk.getVariable<TValue>(featureKey, variableKey, context),
  );

  useEffect(() => {
    setVariableValue(sdk.getVariable<TValue>(featureKey, variableKey, context));

    const unsubscribe = onFeatureChange(sdk, featureKey, () => {
      const newValue = sdk.getVariable<TValue>(featureKey, variableKey, context);
      setVariableValue((prev) => (newValue !== prev ? newValue : prev));
    });

    return unsubscribe;
  }, [sdk, featureKey, variableKey, context]);

  return variableValue;
}
