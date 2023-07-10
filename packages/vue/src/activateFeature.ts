import { Attributes, FeatureKey, VariationValue } from "@featurevisor/types";

import { useSdk } from "./useSdk";

export function activateFeature(
  featureKey: FeatureKey,
  attributes: Attributes = {},
): VariationValue | undefined {
  const sdk = useSdk();

  return sdk.activate(featureKey, attributes);
}
