import { FeatureKey, Required } from "@featurevisor/types";

import { Datasource } from "../datasource/datasource";

export function checkForCircularDependencyInRequired(
  datasource: Datasource,
  featureKey: FeatureKey,
  required?: Required[],
  chain: FeatureKey[] = [],
) {
  if (!required) {
    return;
  }

  const requiredKeys = required.map((r) => (typeof r === "string" ? r : r.key));

  if (requiredKeys.length === 0) {
    return;
  }

  for (const requiredKey of requiredKeys) {
    chain.push(requiredKey);

    if (chain.indexOf(featureKey) > -1) {
      throw new Error(`circular dependency found: ${chain.join(" -> ")}`);
    }

    const requiredFeatureExists = datasource.entityExists("feature", requiredKey);

    if (!requiredFeatureExists) {
      throw new Error(`required feature "${requiredKey}" not found`);
    }

    const requiredParsedFeature = datasource.readFeature(requiredKey);

    if (requiredParsedFeature.required) {
      checkForCircularDependencyInRequired(
        datasource,
        featureKey,
        requiredParsedFeature.required,
        chain,
      );
    }
  }
}
