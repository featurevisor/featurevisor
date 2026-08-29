import type { FeatureKey, RequiredFeature } from "@featurevisor/types";

import { Datasource } from "../datasource";
import { collectRequiredFeatureKeys } from "../datasource/requiredFeatures";

export async function checkForCircularDependencyInRequired(
  datasource: Datasource,
  featureKey: FeatureKey,
  requiredFeatures?: RequiredFeature[],
) {
  await collectRequiredFeatureKeys(datasource, featureKey, requiredFeatures);
}
