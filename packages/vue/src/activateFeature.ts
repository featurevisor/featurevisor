import { Context, FeatureKey, VariationValue } from "@featurevisor/types";

import { useSdk } from "./useSdk";

export function activateFeature(
  featureKey: FeatureKey,
  context: Context = {},
): VariationValue | undefined {
  const sdk = useSdk();

  return sdk.activate(featureKey, context);
}
