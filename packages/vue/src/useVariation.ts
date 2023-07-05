import { Attributes, FeatureKey, VariationValue } from "@featurevisor/types";

import { useSdk } from "./useSdk";

export function useVariation(
  featureKey: FeatureKey,
  attributes: Attributes = {},
): VariationValue | undefined {
  const sdk = useSdk();

  return sdk.getVariation(featureKey, attributes);
}
