import { Context, FeatureKey, VariableKey, VariableValue } from "@featurevisor/types";

import { useSdk } from "./useSdk";

export function useVariable(
  featureKey: FeatureKey,
  variableKey: VariableKey,
  context: Context = {},
): VariableValue {
  const sdk = useSdk();

  return sdk.getVariable(featureKey, variableKey, context);
}
