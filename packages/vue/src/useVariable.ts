import { Attributes, FeatureKey, VariableKey, VariableValue } from "@featurevisor/types";

import { useSdk } from "./useSdk";

export function useVariable(
  featureKey: FeatureKey,
  variableKey: VariableKey,
  attributes: Attributes = {},
): VariableValue | undefined {
  const sdk = useSdk();

  return sdk.getVariable(featureKey, variableKey, attributes);
}
