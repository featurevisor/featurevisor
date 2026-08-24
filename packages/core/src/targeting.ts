import type { ParsedFeature, ParsedVariable, Target } from "@featurevisor/types";

import type { Datasource } from "./datasource";

export type ResolvedTarget = Target & { key: string };

export function normalizeOptionValues(value: string | string[] | undefined): string[] {
  if (typeof value === "undefined") return [];
  return Array.isArray(value) ? value : [value];
}

export function matchesFeaturePatterns(
  featureKey: string,
  patterns: Target["includeFeatures"],
): boolean {
  if (!patterns) return false;
  return normalizeOptionValues(patterns).some((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(featureKey);
  });
}

export function matchesTargetTags(candidateTags: string[], selector: Target["tags"]): boolean {
  if (!selector) return true;
  if (Array.isArray(selector)) {
    return selector.some((tag) => candidateTags.includes(tag));
  }
  if ("or" in selector) {
    return selector.or.some((tag) => candidateTags.includes(tag));
  }
  return selector.and.every((tag) => candidateTags.includes(tag));
}

export function targetIncludesFeature(
  target: Target,
  featureKey: string,
  feature: ParsedFeature,
): boolean {
  if (feature.archived === true) return false;

  const featureTags = feature.tags || [];
  if (target.tag && !featureTags.includes(target.tag)) return false;
  if (target.tags && !matchesTargetTags(featureTags, target.tags)) return false;
  if (target.includeFeatures && !matchesFeaturePatterns(featureKey, target.includeFeatures)) {
    return false;
  }
  if (target.excludeFeatures && matchesFeaturePatterns(featureKey, target.excludeFeatures)) {
    return false;
  }

  return true;
}

export function targetIncludesVariable(target: Target, variable: ParsedVariable): boolean {
  if (variable.archived === true) return false;
  const tags = variable.tags || [];
  if (target.tag && !tags.includes(target.tag)) return false;
  return !target.tags || matchesTargetTags(tags, target.tags);
}

export async function resolveTargets(
  datasource: Datasource,
  requestedTargets?: string | string[],
  options: { defaultToAll?: boolean; requireTargets?: boolean } = {},
): Promise<ResolvedTarget[]> {
  const targetKeys = await datasource.listTargets();
  const requestedTargetKeys = normalizeOptionValues(requestedTargets);
  const selectedKeys =
    requestedTargetKeys.length > 0
      ? requestedTargetKeys
      : options.defaultToAll === false
        ? []
        : targetKeys;

  if (options.requireTargets !== false && targetKeys.length === 0) {
    throw new Error(
      'No targets found. Add at least one target definition, for example "targets/all.yml".',
    );
  }

  const uniqueKeys = Array.from(new Set(selectedKeys));
  for (const targetKey of uniqueKeys) {
    if (!targetKeys.includes(targetKey)) {
      throw new Error(
        `Unknown target "${targetKey}". Available targets: ${targetKeys.join(", ") || "none"}.`,
      );
    }
  }

  return Promise.all(
    uniqueKeys.map(async (targetKey) => ({
      ...(await datasource.readTarget(targetKey)),
      key: targetKey,
    })),
  );
}

export async function getTargetFeatureKeys(
  datasource: Datasource,
  targets: ResolvedTarget[],
): Promise<Set<string>> {
  const result = new Set<string>();
  const featureKeys = await datasource.listFeatures();

  for (const featureKey of featureKeys) {
    const feature = await datasource.readFeature(featureKey);
    if (targets.some((target) => targetIncludesFeature(target, featureKey, feature))) {
      result.add(featureKey);
    }
  }

  return result;
}

export async function getTargetVariableKeys(
  datasource: Datasource,
  targets: ResolvedTarget[],
): Promise<Set<string>> {
  const result = new Set<string>();
  const variableKeys = await datasource.listVariables();

  for (const variableKey of variableKeys) {
    const variable = await datasource.readVariable(variableKey);
    if (targets.some((target) => targetIncludesVariable(target, variable))) {
      result.add(variableKey);
    }
  }

  return result;
}
