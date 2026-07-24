import type { FeatureKey, ParsedFeature, Required } from "@featurevisor/types";

interface RequiredFeatureDatasource {
  featureExists(featureKey: FeatureKey): Promise<boolean>;
  readFeature(featureKey: FeatureKey): Promise<ParsedFeature>;
}

function getRequiredKey(required: Required): FeatureKey {
  return typeof required === "string" ? required : required.key;
}

export async function collectRequiredFeatureKeys(
  datasource: RequiredFeatureDatasource,
  featureKey: FeatureKey,
  required?: Required[],
): Promise<Set<FeatureKey>> {
  const result = new Set<FeatureKey>();
  const visited = new Set<FeatureKey>();
  const visiting: FeatureKey[] = [];

  async function visit(key: FeatureKey, knownRequired?: Required[]) {
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

      dependencies = (await datasource.readFeature(key)).required;
    }

    result.add(key);
    visiting.push(key);

    for (const dependency of dependencies || []) {
      await visit(getRequiredKey(dependency));
    }

    visiting.pop();
    visited.add(key);
  }

  await visit(featureKey, required);

  return result;
}
