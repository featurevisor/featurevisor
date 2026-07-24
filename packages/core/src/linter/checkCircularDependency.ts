import type { FeatureKey, Required } from "@featurevisor/types";

import { Datasource } from "../datasource";
import { collectRequiredFeatureKeys } from "../datasource/requiredFeatures";

export async function checkForCircularDependencyInRequired(
  datasource: Datasource,
  featureKey: FeatureKey,
  required?: Required[],
) {
  await collectRequiredFeatureKeys(datasource, featureKey, required);
}
