import type { ParsedFeature, ParsedVariable, Schema, Target } from "@featurevisor/types";

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

export function targetIncludesVariable(
  target: Target,
  variableKey: string,
  variable: ParsedVariable,
): boolean {
  if (variable.archived === true) return false;
  const tags = variable.tags || [];
  if (target.tag && !tags.includes(target.tag)) return false;
  if (target.tags && !matchesTargetTags(tags, target.tags)) return false;
  if (target.includeVariables && !matchesFeaturePatterns(variableKey, target.includeVariables)) {
    return false;
  }
  if (target.excludeVariables && matchesFeaturePatterns(variableKey, target.excludeVariables)) {
    return false;
  }
  return true;
}

/**
 * Whether a target delivers a schema itself, before references bring others
 * along. Tag selectors take schemas with matching tags, `includeSchemas` adds
 * schemas whatever their tags, and `excludeSchemas` removes them, winning over
 * both. A target without a tag selector or `includeSchemas` delivers none.
 */
export function targetIncludesSchema(
  target: Pick<Target, "tag" | "tags" | "includeSchemas" | "excludeSchemas">,
  schemaKey: string,
  schema: Pick<Schema, "tags">,
): boolean {
  if (target.excludeSchemas && matchesFeaturePatterns(schemaKey, target.excludeSchemas)) {
    return false;
  }
  if (target.includeSchemas && matchesFeaturePatterns(schemaKey, target.includeSchemas)) {
    return true;
  }
  if (!target.tag && !target.tags) return false;

  const tags = schema.tags || [];
  if (target.tag && !tags.includes(target.tag)) return false;
  if (target.tags && !matchesTargetTags(tags, target.tags)) return false;
  return true;
}

/** The keys a schema references through `schema`, at any depth, not following them. */
export function getSchemaReferences(schema: unknown, references = new Set<string>()): Set<string> {
  if (!schema || typeof schema !== "object") return references;
  if (Array.isArray(schema)) {
    for (const item of schema) getSchemaReferences(item, references);
    return references;
  }
  const node = schema as Record<string, unknown>;
  if (typeof node.schema === "string") references.add(node.schema);
  getSchemaReferences(node.items, references);
  getSchemaReferences(node.additionalProperties, references);
  getSchemaReferences(node.oneOf, references);
  if (node.properties && typeof node.properties === "object") {
    for (const property of Object.values(node.properties))
      getSchemaReferences(property, references);
  }
  return references;
}

/**
 * The schemas a target's datafile carries: those it selects, and every schema
 * they reference at any depth, even an excluded one, so each can be validated
 * on its own. Keys keep the order of `schemaKeys`.
 */
export function getTargetSchemaKeys(
  target: Pick<Target, "tag" | "tags" | "includeSchemas" | "excludeSchemas">,
  schemaKeys: string[],
  schemasByKey: Record<string, Pick<Schema, "tags">>,
): string[] {
  const selected = new Set<string>();
  const pending: string[] = [];
  for (const key of schemaKeys) {
    const schema = schemasByKey[key];
    if (schema && targetIncludesSchema(target, key, schema)) pending.push(key);
  }
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (selected.has(key) || !schemasByKey[key]) continue;
    selected.add(key);
    for (const reference of getSchemaReferences(schemasByKey[key])) pending.push(reference);
  }
  return schemaKeys.filter((key) => selected.has(key));
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
    if (targets.some((target) => targetIncludesVariable(target, variableKey, variable))) {
      result.add(variableKey);
    }
  }

  return result;
}
