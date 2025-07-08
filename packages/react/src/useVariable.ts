import { useEffect, useState } from "react";

import type { Context, FeatureKey, VariableKey, VariableValue } from "@featurevisor/types";

import { useSdk } from "./useSdk";
import { onFeatureChange } from "./onFeatureChange";

export function useVariable(
  featureKey: FeatureKey,
  variableKey: VariableKey,
  context: Context = {},
): VariableValue | null {
  const sdk = useSdk();
  const initialValue = sdk.getVariable(featureKey, variableKey, context);
  const [variableValue, setVariableValue] = useState<VariableValue | null>(initialValue);

  useEffect(() => {
    const unsubscribe = onFeatureChange(sdk, featureKey, () => {
      const newValue = sdk.getVariable(featureKey, variableKey, context);

      if (newValue !== variableValue) {
        setVariableValue(newValue);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [featureKey, variableKey, context]);

  return variableValue;
}
