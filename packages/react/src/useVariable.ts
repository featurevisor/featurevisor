import { useEffect, useState } from "react";

import type { Context, FeatureKey, VariableKey, VariableValue } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";
import { onFeatureChange } from "./onFeatureChange.js";

export function useVariable(
  featureKey: FeatureKey,
  variableKey: VariableKey,
  context: Context = {},
): VariableValue | null {
  const sdk = useSdk();
  const [variableValue, setVariableValue] = useState<VariableValue | null>(() =>
    sdk.getVariable(featureKey, variableKey, context),
  );

  useEffect(() => {
    setVariableValue(sdk.getVariable(featureKey, variableKey, context));

    const unsubscribe = onFeatureChange(sdk, featureKey, () => {
      const newValue = sdk.getVariable(featureKey, variableKey, context);
      setVariableValue((prev) => (newValue !== prev ? newValue : prev));
    });

    return unsubscribe;
  }, [sdk, featureKey, variableKey, context]);

  return variableValue;
}
