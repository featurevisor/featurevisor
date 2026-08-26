import type {
  FeatureKey,
  ParsedFeature,
  Required,
  RequiredFeature,
  RequiredFeatures,
} from "@featurevisor/types";

interface RequiredFeatureDatasource {
  featureExists(featureKey: FeatureKey): Promise<boolean>;
  readFeature(featureKey: FeatureKey): Promise<ParsedFeature>;
}

export function normalizeRequiredFeatures(
  requiredFeatures: RequiredFeatures | undefined,
): RequiredFeature[] {
  if (typeof requiredFeatures === "undefined") return [];
  return Array.isArray(requiredFeatures) ? requiredFeatures : [requiredFeatures];
}

export function normalizeFeatureRequirements(feature: {
  requiredFeatures?: RequiredFeatures;
  required?: Required[];
}): RequiredFeature[] {
  if (typeof feature.requiredFeatures !== "undefined") {
    return normalizeRequiredFeatures(feature.requiredFeatures);
  }

  return (feature.required || []).map((required) =>
    typeof required === "string"
      ? required
      : { feature: required.key, variation: required.variation },
  );
}

export function getRequiredFeatureKey(required: RequiredFeature): FeatureKey {
  return typeof required === "string" ? required : required.feature;
}

export async function collectRequiredFeatureKeys(
  datasource: RequiredFeatureDatasource,
  featureKey: FeatureKey,
  requiredFeatures: RequiredFeature[] = [],
): Promise<Set<FeatureKey>> {
  const result = new Set<FeatureKey>();
  const visited = new Set<FeatureKey>();
  const visiting: FeatureKey[] = [];

  async function visit(key: FeatureKey, knownRequired?: RequiredFeature[]) {
    const cycleStart = visiting.indexOf(key);

    if (cycleStart !== -1) {
      const cycle = [...visiting.slice(cycleStart), key];
      throw new Error(`circular dependency found: ${cycle.join(" -> ")}`);
    }

    if (visited.has(key)) {
      return;
    }

    let dependencies = knownRequired;

    if (key !== featureKey) {
      if (!(await datasource.featureExists(key))) {
        throw new Error(`required feature "${key}" not found`);
      }

      dependencies = normalizeFeatureRequirements(await datasource.readFeature(key));
    }

    result.add(key);
    visiting.push(key);

    for (const dependency of dependencies || []) {
      await visit(getRequiredFeatureKey(dependency));
    }

    visiting.pop();
    visited.add(key);
  }

  await visit(featureKey, requiredFeatures);

  return result;
}
