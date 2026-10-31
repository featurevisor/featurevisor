import * as fs from "fs";
import * as path from "path";

import type {
  Attribute,
  EntityType,
  FeatureAssertion,
  ParsedFeature,
  Rule,
  RulesByEnvironment,
  Schema,
  Scenario,
  ScenarioAssertion,
  Segment,
  SegmentAssertion,
  VariableAssertion,
  Target,
  Test,
  TestCheckReference,
  ParsedVariable,
  ParsedVariableOverride,
  VariableOverride,
  Variation,
} from "@featurevisor/types";

import type { CustomParser } from "@featurevisor/parsers";

import type { ProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { lintProject, type LintErrorItem } from "../linter";
import {
  CLI_COLOR_CYAN,
  CLI_COLOR_DIM,
  CLI_COLOR_GREEN,
  CLI_COLOR_YELLOW,
  CLI_FORMAT_BOLD,
  CLI_FORMAT_GREEN,
  colorize,
} from "../tester/cliFormat";
import { prettyDuration } from "../tester/prettyDuration";
import { getCheckReferences } from "../tester/checks";
import type { Plugin } from "../cli";
import { applyCombinationToValue, getMatrixCombinations } from "../list/matrix";
import { extractSchemaReferences } from "../utils/schemaReferences";
import { classifyTestSpec } from "../datasource/testSpecs";
import { conditionLeaves, definitionConditionLeaves } from "../utils/conditionReferences";
import {
  collectDependencyClosure,
  buildDependencyGraph,
  featureFlagNode,
  variableNode,
} from "../datasource/dependencies";

type ConflictPolicy = "source" | "destination" | "fail";
type PromotionAuditFormat = "json" | "markdown";
type EntityValue =
  | Attribute
  | Segment
  | ParsedFeature
  | Record<string, unknown>
  | Schema
  | Target
  | Test
  | Scenario
  | ParsedVariable;

interface PromotionConflict {
  type: EntityType;
  key: string;
  path: string;
  source: unknown;
  destination: unknown;
}

interface EntityPlan {
  type: EntityType;
  key: string;
  source: EntityValue;
  destination?: EntityValue;
  merged: EntityValue;
  conflicts: PromotionConflict[];
}

export interface PromoteProjectSetsOptions {
  from?: string;
  to?: string;
  includeFeatures?: string | string[];
  excludeFeatures?: string | string[];
  target?: string | string[];
  tag?: string | string[];
  conflicts?: ConflictPolicy;
  allowEmpty?: boolean;
  apply?: boolean;
  audit?: boolean | PromotionAuditFormat;
  showUnchanged?: boolean;
}

export interface PromoteProjectSetsResult {
  from: string;
  to: string;
  apply: boolean;
  duration: number;
  filters: {
    includeFeatures: string[];
    excludeFeatures: string[];
    targets: string[];
    tags: string[];
    conflicts: ConflictPolicy;
  };
  dependencies: Record<EntityType, number>;
  files: {
    created: string[];
    updated: string[];
    unchanged: string[];
  };
  conflicts: PromotionConflict[];
  auditFilePath?: string;
}

function isPromotable(entity: { promotable?: boolean } | undefined) {
  return entity?.promotable !== false;
}

function toArray(value: string | string[] | undefined): string[] {
  if (typeof value === "undefined") {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deepMergeWithPolicy(
  destination: unknown,
  source: unknown,
  policy: ConflictPolicy,
  conflicts: Array<Omit<PromotionConflict, "type" | "key">>,
  pathSegments: string[] = [],
  selectorFields = true,
  conditionExpression = false,
): unknown {
  if (typeof destination === "undefined") return source;
  if (typeof source === "undefined") return destination;

  const conflictPath = pathSegments.join(".") || "<root>";

  // A selector is a complete boolean expression, never a partial object patch.
  if (conditionExpression) {
    if (!deepEqual(destination, source))
      conflicts.push({ path: conflictPath, source, destination });
    return policy === "destination" ? destination : source;
  }

  if (Array.isArray(destination) && Array.isArray(source)) {
    if (!deepEqual(destination, source)) {
      conflicts.push({ path: conflictPath, source, destination });
    }

    return policy === "destination" ? destination : source;
  }

  if (isPlainObject(destination) && isPlainObject(source)) {
    const result: Record<string, unknown> = { ...destination };

    for (const key of Object.keys(source)) {
      result[key] = deepMergeWithPolicy(
        result[key],
        source[key],
        policy,
        conflicts,
        [...pathSegments, key],
        selectorFields &&
          ![
            "value",
            "defaultValue",
            "disabledValue",
            "mutate",
            "variables",
            "variablesSchema",
            "compose",
            "properties",
            "items",
            "enum",
            "const",
          ].includes(key),
        selectorFields && key === "conditions",
      );
    }

    return result;
  }

  if (!deepEqual(destination, source)) {
    conflicts.push({ path: conflictPath, source, destination });
  }

  return policy === "destination" ? destination : source;
}

/** Switching an override's form replaces that form, rather than combining selectors or actions. */
function mergeOverrideBody(
  destination: unknown,
  source: unknown,
  policy: ConflictPolicy,
  conflicts: Array<Omit<PromotionConflict, "type" | "key">>,
  pathSegments: string[],
): unknown {
  if (!isPlainObject(destination) || !isPlainObject(source))
    return deepMergeWithPolicy(destination, source, policy, conflicts, pathSegments);
  const from = { ...source };
  const to = { ...destination };
  for (const names of [["value", "mutate"]]) {
    const sourceField = names.find((name) => from[name] !== undefined);
    const destinationField = names.find((name) => to[name] !== undefined);
    if (sourceField && destinationField && sourceField !== destinationField) {
      conflicts.push({
        path: [...pathSegments, sourceField].join("."),
        source: { [sourceField]: from[sourceField] },
        destination: { [destinationField]: to[destinationField] },
      });
      if (policy === "destination") delete from[sourceField];
      else delete to[destinationField];
    }
  }
  return deepMergeWithPolicy(to, from, policy, conflicts, pathSegments);
}

function matchesPattern(key: string, patterns: string[]) {
  if (patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(key);
  });
}

function matchesTags(candidateTags: string[], selector: Target["tags"]): boolean {
  if (!selector) return true;
  if (Array.isArray(selector)) {
    return selector.some((tag) => candidateTags.includes(tag));
  }
  if ("or" in selector) {
    return selector.or.some((tag) => candidateTags.includes(tag));
  }
  return selector.and.every((tag) => candidateTags.includes(tag));
}

function matchesTarget(featureKey: string, feature: ParsedFeature, target: Target): boolean {
  const featureTags = feature.tags || [];
  if (feature.archived === true) return false;
  if (target.tag && !featureTags.includes(target.tag)) return false;
  if (target.tags && !matchesTags(featureTags, target.tags)) return false;

  const included = target.includeFeatures
    ? matchesPattern(featureKey, toArray(target.includeFeatures))
    : true;
  const excluded = target.excludeFeatures
    ? matchesPattern(featureKey, toArray(target.excludeFeatures))
    : false;

  return included && !excluded;
}

function variableMatchesTarget(
  variableKey: string,
  variable: ParsedVariable,
  target: Target,
): boolean {
  const tags = variable.tags || [];
  if (variable.archived === true) return false;
  if (target.tag && !tags.includes(target.tag)) return false;
  if (target.tags && !matchesTags(tags, target.tags)) return false;
  if (target.includeVariables && !matchesPattern(variableKey, toArray(target.includeVariables))) {
    return false;
  }
  if (target.excludeVariables && matchesPattern(variableKey, toArray(target.excludeVariables))) {
    return false;
  }
  return true;
}

function getPromotableVariableOverrides(
  overrides: ParsedVariableOverride[] | undefined,
): ParsedVariableOverride[] {
  const result: ParsedVariableOverride[] = [];
  for (const override of overrides || []) {
    if (!isPromotable(override)) continue;
    result.push(override);
    result.push(...getPromotableVariableOverrides(override.overrides));
  }
  return result;
}

function getAllPromotableVariableOverrides(variable: ParsedVariable): ParsedVariableOverride[] {
  const groups = Array.isArray(variable.overrides)
    ? [variable.overrides]
    : Object.values(variable.overrides || {});
  return groups.flatMap(getPromotableVariableOverrides);
}

function mergeVariableOverrideArray(
  destination: ParsedVariableOverride[] | undefined,
  source: ParsedVariableOverride[] | undefined,
  policy: ConflictPolicy,
  conflicts: PromotionConflict[],
  variableKey: string,
  pathSegments: string[] = ["overrides"],
): ParsedVariableOverride[] | undefined {
  if (!source) return destination;
  const result = [...(destination || [])];
  for (const sourceOverride of source) {
    if (!isPromotable(sourceOverride)) continue;
    const index = result.findIndex((entry) => entry.key === sourceOverride.key);
    if (index !== -1 && !isPromotable(result[index])) continue;
    const sourceWithoutOverrides = { ...sourceOverride, overrides: undefined };
    const destinationWithoutOverrides =
      index === -1 ? undefined : { ...result[index], overrides: undefined };
    const localConflicts: Array<Omit<PromotionConflict, "type" | "key">> = [];
    const merged = mergeOverrideBody(
      destinationWithoutOverrides,
      sourceWithoutOverrides,
      policy,
      localConflicts,
      [...pathSegments, sourceOverride.key],
    ) as ParsedVariableOverride;
    merged.overrides = mergeVariableOverrideArray(
      index === -1 ? undefined : result[index].overrides,
      sourceOverride.overrides,
      policy,
      conflicts,
      variableKey,
      [...pathSegments, sourceOverride.key, "overrides"],
    );
    conflicts.push(
      ...localConflicts.map((conflict) => ({
        type: "variable" as const,
        key: variableKey,
        ...conflict,
      })),
    );
    if (index === -1) result.push(merged);
    else result[index] = merged;
  }
  const movable = source.filter(
    (entry) =>
      isPromotable(entry) && isPromotable(destination?.find((item) => item.key === entry.key)),
  );
  const movableKeys = new Set(movable.map((entry) => entry.key));
  const previousOrder = (destination || [])
    .filter((entry) => movableKeys.has(entry.key))
    .map((entry) => entry.key);
  const sourceOrder = movable
    .filter((entry) => destination?.some((item) => item.key === entry.key))
    .map((entry) => entry.key);
  if (!deepEqual(previousOrder, sourceOrder)) {
    conflicts.push({
      type: "variable",
      key: variableKey,
      path: [...pathSegments, "order"].join("."),
      source: sourceOrder,
      destination: previousOrder,
    });
  }
  if (policy !== "destination") {
    const byKey = new Map(result.map((entry) => [entry.key, entry]));
    const ordered = movable.map((entry) => byKey.get(entry.key)!);
    let index = 0;
    // Protected and destination only entries keep their positions. The remaining
    // slots follow source order, including newly introduced overrides.
    for (let position = 0; position < result.length; position++) {
      if (movableKeys.has(result[position].key)) result[position] = ordered[index++];
    }
  }
  return result;
}

function mergeVariable(
  key: string,
  destination: ParsedVariable | undefined,
  source: ParsedVariable,
  policy: ConflictPolicy,
  conflicts: PromotionConflict[],
): ParsedVariable {
  const sourceWithoutOverrides = { ...source, overrides: undefined };
  const destinationWithoutOverrides = destination
    ? { ...destination, overrides: undefined }
    : undefined;
  if (source.compose !== undefined) {
    sourceWithoutOverrides.compose = undefined;
    if (destinationWithoutOverrides) destinationWithoutOverrides.compose = undefined;
  }
  const localConflicts: Array<Omit<PromotionConflict, "type" | "key">> = [];
  const merged = deepMergeWithPolicy(
    destinationWithoutOverrides,
    sourceWithoutOverrides,
    policy,
    localConflicts,
  ) as ParsedVariable;

  if (typeof source.compose === "string") {
    merged.compose = deepMergeWithPolicy(
      destination?.compose,
      source.compose,
      policy,
      localConflicts,
      ["compose"],
    ) as string;
  } else if (source.compose !== undefined) {
    const compose = { ...(typeof destination?.compose === "object" ? destination.compose : {}) };
    for (const [alias, reference] of Object.entries(source.compose)) {
      if (compose[alias] !== undefined && !deepEqual(compose[alias], reference)) {
        localConflicts.push({
          path: `compose.${alias}`,
          source: reference,
          destination: compose[alias],
        });
      }
      if (compose[alias] === undefined || policy !== "destination") compose[alias] = reference;
    }
    merged.compose = compose;
  }
  conflicts.push(
    ...localConflicts.map((conflict) => ({ type: "variable" as const, key, ...conflict })),
  );

  if (Array.isArray(source.overrides) || Array.isArray(destination?.overrides)) {
    merged.overrides = mergeVariableOverrideArray(
      Array.isArray(destination?.overrides) ? destination.overrides : undefined,
      Array.isArray(source.overrides) ? source.overrides : undefined,
      policy,
      conflicts,
      key,
    );
  } else if (source.overrides || destination?.overrides) {
    const environments = new Set([
      ...Object.keys(destination?.overrides || {}),
      ...Object.keys(source.overrides || {}),
    ]);
    const overrides: Record<string, ParsedVariableOverride[]> = {};
    for (const environment of environments) {
      overrides[environment] =
        mergeVariableOverrideArray(
          destination?.overrides?.[environment],
          source.overrides?.[environment],
          policy,
          conflicts,
          key,
        ) || [];
    }
    merged.overrides = Object.keys(overrides).length > 0 ? overrides : undefined;
  }

  return merged;
}

function withoutKey<T extends Record<string, unknown>>(entity: T): T {
  const { key: _key, ...rest } = entity; // eslint-disable-line @typescript-eslint/no-unused-vars

  return rest as T;
}

async function safeRead<T>(
  keys: string[],
  read: (key: string) => Promise<T>,
): Promise<Record<string, T>> {
  const entries = await Promise.all(keys.map(async (key) => [key, await read(key)] as const));
  return Object.fromEntries(entries);
}

async function readDestination<T>(
  key: string,
  read: (key: string) => Promise<T>,
): Promise<T | undefined> {
  try {
    return await read(key);
  } catch {
    return undefined;
  }
}

function formatLintPreflightErrors(set: string, errors: LintErrorItem[]) {
  const preview = errors
    .slice(0, 5)
    .map((error) => `${error.filePath}: ${error.message}`)
    .join("\n");
  const suffix = errors.length > 5 ? `\n...and ${errors.length - 5} more` : "";

  return `Set "${set}" failed preflight lint with ${errors.length} error(s).\n${preview}${suffix}`;
}

async function assertSetLintsClean(
  set: string,
  projectConfig: ProjectConfig,
  datasource: Datasource,
) {
  const result = await lintProject(
    {
      rootDirectoryPath: path.resolve(projectConfig.setsDirectoryPath, ".."),
      projectConfig,
      datasource,
      options: {},
    },
    { json: true },
  );

  if (result.hasError) {
    throw new Error(formatLintPreflightErrors(set, result.errors));
  }
}

async function assertPromotionLintsClean(
  set: string,
  destination: Datasource,
  plans: EntityPlan[],
) {
  const config = destination.getConfig();
  const OriginalAdapter = config.adapter;
  const definitions = plans.map((plan) => ({
    ...plan,
    type:
      plan.type === "test" || plan.type === "scenario"
        ? ((classifyTestSpec(plan.merged) === "scenario" ? "scenario" : "test") as EntityType)
        : plan.type,
  }));
  const entries = new Map(
    definitions.map((plan) => [JSON.stringify([plan.type, plan.key]), plan.merged]),
  );
  const replacedSpec = (type: EntityType, key: string) =>
    (type === "test" || type === "scenario") &&
    entries.has(JSON.stringify([type === "test" ? "scenario" : "test", key]));
  class PlannedAdapter extends OriginalAdapter {
    async listEntities(type: EntityType): Promise<string[]> {
      return [
        ...new Set([
          ...(await super.listEntities(type)).filter((key) => !replacedSpec(type, key)),
          ...definitions.filter((plan) => plan.type === type).map((plan) => plan.key),
        ]),
      ].sort();
    }
    async entityExists(type: EntityType, key: string): Promise<boolean> {
      if (replacedSpec(type, key)) return false;
      return entries.has(JSON.stringify([type, key])) || super.entityExists(type, key);
    }
    async readEntity<T>(type: EntityType, key: string): Promise<T> {
      const id = JSON.stringify([type, key]);
      if (!entries.has(id)) return super.readEntity(type, key);
      // Lint what will be written, not the in memory plan. Serialize and parse
      // it the way writeEntity will, so a value the parser cannot represent,
      // such as undefined, is checked in its written form.
      const parser = config.parser as CustomParser;
      const filePath = this.getEntityPath?.(type, key);
      return parser.parse<T>(
        parser.stringify(structuredClone(entries.get(id)), filePath),
        filePath,
      );
    }
  }
  const planned = new Datasource(
    { ...config, adapter: PlannedAdapter },
    destination.getRootDirectoryPath(),
  );
  await assertSetLintsClean(`${set} (promotion result)`, config, planned);
}

function assertAllowedPromotionFlow(projectConfig: ProjectConfig, from: string, to: string) {
  const allowedFlows = projectConfig.promotionFlows;

  if (typeof allowedFlows === "undefined") {
    return;
  }

  const isAllowed = allowedFlows.some((flow) => flow.from === from && flow.to === to);

  if (isAllowed) {
    return;
  }

  const allowedList = allowedFlows.map((flow) => `${flow.from} -> ${flow.to}`).join(", ") || "none";

  throw new Error(
    `Promotion from "${from}" to "${to}" is not allowed by this project's configured promotionFlows.\nAllowed flows: ${allowedList}.\nChoose one of the allowed promotion paths or update featurevisor.config.js if this flow should be permitted.`,
  );
}

function collectConditionDependencies(
  value: unknown,
  segments: Set<string>,
  attributes: Set<string>,
) {
  for (const leaf of conditionLeaves(value)) {
    if (typeof leaf === "string") segments.add(leaf);
    else if ("attribute" in leaf) attributes.add(leaf.attribute.split(".")[0]);
  }
}

function collectFeatureDependencies(
  feature: ParsedFeature,
  _features: Record<string, ParsedFeature>,
  _featureKeys: Set<string>,
  segmentKeys: Set<string>,
  attributeKeys: Set<string>,
  schemaKeys: Set<string>,
) {
  if (typeof feature.bucketBy === "string") attributeKeys.add(feature.bucketBy);
  else if (Array.isArray(feature.bucketBy))
    feature.bucketBy.forEach((key) => attributeKeys.add(key));
  else feature.bucketBy?.or.forEach((key) => attributeKeys.add(key));
  Object.values(feature.variablesSchema || {}).forEach((schema) =>
    extractSchemaReferences(schema).forEach((key) => schemaKeys.add(key)),
  );
  for (const leaf of definitionConditionLeaves(promotableFeature(feature))) {
    if (typeof leaf === "string") segmentKeys.add(leaf);
    else if ("attribute" in leaf) attributeKeys.add(leaf.attribute.split(".")[0]);
  }
}

/** Protection applies before the structural graph visits rules and their overrides. */
function promotableFeature(feature: ParsedFeature): ParsedFeature {
  const overrides = (value: Record<string, VariableOverride[]> | undefined) =>
    value &&
    Object.fromEntries(
      Object.entries(value).map(([key, entries]) => [key, entries.filter(isPromotable)]),
    );
  const rules = (entries: any[]) =>
    entries.filter(isPromotable).map((rule) => ({
      ...rule,
      variableOverrides: overrides(rule.variableOverrides),
    }));
  const groups = (value: any, filter: (entries: any[]) => any[]) =>
    Array.isArray(value)
      ? filter(value)
      : value &&
        Object.fromEntries(
          Object.entries(value).map(([key, entries]) => [key, filter(entries as any[])]),
        );
  return {
    ...feature,
    rules: groups(feature.rules, rules),
    force: groups(feature.force, (entries) => entries.filter(isPromotable)),
    variations: feature.variations?.map((variation) => ({
      ...variation,
      variableOverrides: overrides(variation.variableOverrides),
    })),
  };
}

function hasOverridePromotion(overrides: Record<string, VariableOverride[]> | undefined): boolean {
  return Object.values(overrides || {}).some((entries) =>
    entries.some((entry) => typeof entry.promotable !== "undefined"),
  );
}

function mergeFeatureVariableOverrideArray(
  destination: VariableOverride[] | undefined,
  source: VariableOverride[] | undefined,
  policy: ConflictPolicy,
  conflicts: Array<Omit<PromotionConflict, "type" | "key">>,
  pathSegments: string[],
): VariableOverride[] | undefined {
  if (typeof source === "undefined") return destination;
  const usesPromotion = [...(destination || []), ...source].some(
    (override) => typeof override.promotable !== "undefined",
  );
  if (!usesPromotion) {
    return deepMergeWithPolicy(destination, source, policy, conflicts, pathSegments) as
      | VariableOverride[]
      | undefined;
  }

  const allKeyed = [...(destination || []), ...source].every(
    (override) => typeof override.key === "string",
  );
  if (!allKeyed) {
    throw new Error(
      "Cannot merge protected feature variable overrides when keys are missing. Add stable keys to every override in the list.",
    );
  }

  const result = [...(destination || [])];
  for (const sourceOverride of source) {
    if (!isPromotable(sourceOverride)) continue;
    const index = result.findIndex((entry) => entry.key === sourceOverride.key);
    if (index !== -1 && !isPromotable(result[index])) continue;
    const merged = mergeOverrideBody(
      index === -1 ? undefined : result[index],
      sourceOverride,
      policy,
      conflicts,
      [...pathSegments, sourceOverride.key!],
    ) as VariableOverride;
    if (index === -1) result.push(merged);
    else result[index] = merged;
  }
  return result;
}

function mergeFeatureVariableOverrideRecord(
  destination: Record<string, VariableOverride[]> | undefined,
  source: Record<string, VariableOverride[]> | undefined,
  policy: ConflictPolicy,
  conflicts: Array<Omit<PromotionConflict, "type" | "key">>,
  pathSegments: string[],
): Record<string, VariableOverride[]> | undefined {
  if (!source) return destination;
  const variableKeys = new Set([...Object.keys(destination || {}), ...Object.keys(source)]);
  const result: Record<string, VariableOverride[]> = {};
  for (const variableKey of variableKeys) {
    const merged = mergeFeatureVariableOverrideArray(
      destination?.[variableKey],
      source[variableKey],
      policy,
      conflicts,
      [...pathSegments, variableKey],
    );
    if (merged) result[variableKey] = merged;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function mergeRule(
  destination: Rule | undefined,
  source: Rule,
  policy: ConflictPolicy,
  conflicts: Array<Omit<PromotionConflict, "type" | "key">>,
  pathSegments: string[],
): Rule {
  if (
    !hasOverridePromotion(source.variableOverrides) &&
    !hasOverridePromotion(destination?.variableOverrides)
  ) {
    return deepMergeWithPolicy(destination, source, policy, conflicts, pathSegments) as Rule;
  }

  const merged = deepMergeWithPolicy(
    destination ? { ...destination, variableOverrides: undefined } : undefined,
    { ...source, variableOverrides: undefined },
    policy,
    conflicts,
    pathSegments,
  ) as Rule;
  merged.variableOverrides = mergeFeatureVariableOverrideRecord(
    destination?.variableOverrides,
    source.variableOverrides,
    policy,
    conflicts,
    [...pathSegments, "variableOverrides"],
  );
  return merged;
}

function mergeRuleArray(
  destination: Rule[] | undefined,
  source: Rule[] | undefined,
  policy: ConflictPolicy,
  conflicts: Array<Omit<PromotionConflict, "type" | "key">>,
  pathSegments: string[],
) {
  if (typeof source === "undefined") return destination;
  if (typeof destination === "undefined") {
    return source
      .filter((rule) => isPromotable(rule))
      .map((rule) => mergeRule(undefined, rule, policy, conflicts, [...pathSegments, rule.key]));
  }

  // Start from the destination's order. Rules only the destination has, and
  // protected destination rules, keep their slots, because the first matching
  // rule decides and moving one changes who gets the feature.
  const result = [...destination];
  const added = new Set<string>();

  for (const sourceRule of source) {
    if (!isPromotable(sourceRule)) continue;
    const index = result.findIndex((rule) => rule.key === sourceRule.key);
    if (index !== -1) {
      if (!isPromotable(result[index])) continue;
      result[index] = mergeRule(result[index], sourceRule, policy, conflicts, [
        ...pathSegments,
        sourceRule.key,
      ]);
      continue;
    }

    // A new rule goes before the next source rule the result already has, so
    // it keeps its place relative to the source and never lands after a
    // catch all it preceded. Without one, it follows the previous such rule.
    const merged = mergeRule(undefined, sourceRule, policy, conflicts, [
      ...pathSegments,
      sourceRule.key,
    ]);
    const sourceIndex = source.indexOf(sourceRule);
    const next = source
      .slice(sourceIndex + 1)
      .find((rule) => result.some((entry) => entry.key === rule.key));
    const previous = source
      .slice(0, sourceIndex)
      .reverse()
      .find((rule) => result.some((entry) => entry.key === rule.key));
    if (next) {
      result.splice(
        result.findIndex((entry) => entry.key === next.key),
        0,
        merged,
      );
    } else if (previous) {
      result.splice(result.findIndex((entry) => entry.key === previous.key) + 1, 0, merged);
    } else {
      result.push(merged);
    }
    added.add(sourceRule.key);
  }

  // Rules both sides have, and may move, follow the conflict policy. A change
  // in their relative order is a conflict, as it is for global overrides.
  const movable = source.filter(
    (rule) =>
      !added.has(rule.key) &&
      isPromotable(rule) &&
      destination.some((entry) => entry.key === rule.key && isPromotable(entry)),
  );
  const movableKeys = new Set(movable.map((rule) => rule.key));
  const previousOrder = destination
    .filter((rule) => movableKeys.has(rule.key))
    .map((rule) => rule.key);
  const sourceOrder = movable.map((rule) => rule.key);
  if (!deepEqual(previousOrder, sourceOrder)) {
    conflicts.push({
      path: [...pathSegments, "order"].join("."),
      source: sourceOrder,
      destination: previousOrder,
    });
    if (policy !== "destination") {
      const byKey = new Map(result.map((rule) => [rule.key, rule]));
      const ordered = sourceOrder.map((key) => byKey.get(key)!);
      let next = 0;
      for (let position = 0; position < result.length; position++) {
        if (movableKeys.has(result[position].key)) result[position] = ordered[next++];
      }
    }
  }

  return result;
}

function isRulesByEnvironment(value: ParsedFeature["rules"]): value is RulesByEnvironment {
  return isPlainObject(value) && !Array.isArray(value);
}

function mergeRules(
  destination: ParsedFeature["rules"] | undefined,
  source: ParsedFeature["rules"] | undefined,
  policy: ConflictPolicy,
  conflicts: Array<Omit<PromotionConflict, "type" | "key">>,
) {
  if (Array.isArray(source) || Array.isArray(destination)) {
    return mergeRuleArray(
      Array.isArray(destination) ? destination : undefined,
      Array.isArray(source) ? source : undefined,
      policy,
      conflicts,
      ["rules"],
    );
  }

  if (isRulesByEnvironment(source) || isRulesByEnvironment(destination)) {
    const environmentKeys = new Set([
      ...Object.keys((destination || {}) as RulesByEnvironment),
      ...Object.keys((source || {}) as RulesByEnvironment),
    ]);
    const result: RulesByEnvironment = {};

    for (const environment of Array.from(environmentKeys).sort()) {
      const merged = mergeRuleArray(
        (destination as RulesByEnvironment | undefined)?.[environment],
        (source as RulesByEnvironment | undefined)?.[environment],
        policy,
        conflicts,
        ["rules", environment],
      );

      if (typeof merged !== "undefined") {
        result[environment] = merged;
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  return source;
}

function mergeVariations(
  destination: Variation[] | undefined,
  source: Variation[] | undefined,
  policy: ConflictPolicy,
  conflicts: Array<Omit<PromotionConflict, "type" | "key">>,
): Variation[] | undefined {
  if (typeof source === "undefined") return destination;
  const usesPromotion = [...(destination || []), ...source].some((variation) =>
    hasOverridePromotion(variation.variableOverrides),
  );
  if (!usesPromotion) {
    return deepMergeWithPolicy(destination, source, policy, conflicts, ["variations"]) as
      | Variation[]
      | undefined;
  }

  const mergedValues = new Set<string>();
  const result: Variation[] = [];
  for (const sourceVariation of source) {
    const destinationVariation = destination?.find(
      (variation) => variation.value === sourceVariation.value,
    );
    const pathSegments = ["variations", sourceVariation.value];
    const merged = deepMergeWithPolicy(
      destinationVariation ? { ...destinationVariation, variableOverrides: undefined } : undefined,
      { ...sourceVariation, variableOverrides: undefined },
      policy,
      conflicts,
      pathSegments,
    ) as Variation;
    merged.variableOverrides = mergeFeatureVariableOverrideRecord(
      destinationVariation?.variableOverrides,
      sourceVariation.variableOverrides,
      policy,
      conflicts,
      [...pathSegments, "variableOverrides"],
    );
    result.push(merged);
    mergedValues.add(sourceVariation.value);
  }
  for (const destinationVariation of destination || []) {
    if (!mergedValues.has(destinationVariation.value)) result.push(destinationVariation);
  }
  return result;
}

function mergeFeature(
  featureKey: string,
  destination: ParsedFeature | undefined,
  source: ParsedFeature,
  policy: ConflictPolicy,
  conflicts: PromotionConflict[],
): ParsedFeature {
  const sourceWithoutRules = { ...source, rules: undefined, variations: undefined };
  const destinationWithoutRules = destination
    ? { ...destination, rules: undefined, variations: undefined }
    : undefined;
  const featureConflicts: Array<Omit<PromotionConflict, "type" | "key">> = [];
  const mergedFeature = deepMergeWithPolicy(
    destinationWithoutRules,
    sourceWithoutRules,
    policy,
    featureConflicts,
  ) as ParsedFeature;
  const ruleConflicts: Array<Omit<PromotionConflict, "type" | "key">> = [];
  const mergedRules = mergeRules(destination?.rules, source.rules, policy, ruleConflicts);
  const variationConflicts: Array<Omit<PromotionConflict, "type" | "key">> = [];
  const mergedVariations = mergeVariations(
    destination?.variations,
    source.variations,
    policy,
    variationConflicts,
  );

  conflicts.push(
    ...featureConflicts.map((conflict) => ({
      type: "feature" as const,
      key: featureKey,
      ...conflict,
    })),
    ...ruleConflicts.map((conflict) => ({
      type: "feature" as const,
      key: featureKey,
      ...conflict,
    })),
    ...variationConflicts.map((conflict) => ({
      type: "feature" as const,
      key: featureKey,
      ...conflict,
    })),
  );

  const result: ParsedFeature = { ...mergedFeature };
  // Leave absent fields out rather than writing them as undefined
  if (typeof mergedRules !== "undefined") result.rules = mergedRules;
  if (typeof mergedVariations !== "undefined") result.variations = mergedVariations;
  return result;
}

type TestAssertion = FeatureAssertion | SegmentAssertion | VariableAssertion | ScenarioAssertion;

function getTestCheckReferences(test: Test): TestCheckReference[] {
  if (!("variable" in test)) {
    return [];
  }

  const owner = test.variable;
  return test.assertions.flatMap((assertion) => {
    const combinations = assertion.matrix ? getMatrixCombinations(assertion.matrix) : [{}];
    return combinations.flatMap((combination) => {
      const expanded = applyCombinationToValue(assertion, combination);
      return [
        ...(expanded.checks ? getCheckReferences(expanded.checks, owner) : []),
        ...(expanded.children || []).flatMap((child) =>
          child.checks ? getCheckReferences(child.checks, owner) : [],
        ),
      ];
    });
  });
}

function getScenarioCheckReferences(scenario: Scenario): TestCheckReference[] {
  const combinations = scenario.matrix ? getMatrixCombinations(scenario.matrix) : [{}];

  return combinations.flatMap((combination) => {
    const expanded = applyCombinationToValue(scenario, combination);

    return [
      ...getCheckReferences(expanded.checks),
      ...(expanded.children || []).flatMap((child) => getCheckReferences(child.checks)),
    ];
  });
}

function getTestTargetReferences(test: Test): string[] {
  return test.assertions.flatMap((assertion) => {
    const combinations = assertion.matrix ? getMatrixCombinations(assertion.matrix) : [{}];

    return combinations.flatMap((combination) => {
      const expanded = applyCombinationToValue(assertion, combination);
      return "target" in expanded && typeof expanded.target === "string" ? [expanded.target] : [];
    });
  });
}

function getScenarioTargetReferences(scenario: Scenario): string[] {
  const combinations = scenario.matrix ? getMatrixCombinations(scenario.matrix) : [{}];

  return combinations.flatMap((combination) => {
    const expanded = applyCombinationToValue(scenario, combination);
    return typeof expanded.target === "string" ? [expanded.target] : [];
  });
}

function getSpecTargetReferences(spec: Test | Scenario): string[] {
  return classifyTestSpec(spec) === "scenario"
    ? getScenarioTargetReferences(spec as Scenario)
    : getTestTargetReferences(spec as Test);
}

function assertionsAreKeyed(
  assertions: TestAssertion[],
): assertions is Array<TestAssertion & { key: string }> {
  return (
    assertions.length > 0 && assertions.every((assertion) => typeof assertion.key === "string")
  );
}

function mergeAssertionArray(
  testKey: string,
  destination: TestAssertion[] | undefined,
  source: TestAssertion[] | undefined,
  policy: ConflictPolicy,
  conflicts: Array<Omit<PromotionConflict, "type" | "key">>,
) {
  if (typeof source === "undefined") return destination;
  if (typeof destination === "undefined" || destination.length === 0) {
    return source.filter((assertion) => isPromotable(assertion));
  }

  const sourceIsKeyed = assertionsAreKeyed(source);
  const destinationIsKeyed = assertionsAreKeyed(destination);

  if (sourceIsKeyed && destinationIsKeyed) {
    const mergedAssertionKeys = new Set<string>();
    const mergedAssertions: TestAssertion[] = [];

    for (const sourceAssertion of source) {
      if (!isPromotable(sourceAssertion)) {
        continue;
      }

      const destinationAssertion = destination.find(
        (assertion) => assertion.key === sourceAssertion.key,
      );
      mergedAssertionKeys.add(sourceAssertion.key);

      if (destinationAssertion && !isPromotable(destinationAssertion)) {
        mergedAssertions.push(destinationAssertion);
        continue;
      }

      mergedAssertions.push(
        deepMergeWithPolicy(destinationAssertion, sourceAssertion, policy, conflicts, [
          "assertions",
          sourceAssertion.key,
        ]) as TestAssertion,
      );
    }

    for (const destinationAssertion of destination) {
      if (destinationAssertion.key && !mergedAssertionKeys.has(destinationAssertion.key)) {
        mergedAssertions.push(destinationAssertion);
      }
    }

    return mergedAssertions;
  }

  const hasAssertionProtection = [...source, ...destination].some(
    (assertion) => assertion.promotable === false,
  );
  if (hasAssertionProtection && sourceIsKeyed !== destinationIsKeyed) {
    throw new Error(
      `Cannot merge protected assertions in test "${testKey}" because assertion keys are present in only one set. Add stable keys to every assertion in both source and destination test specs.`,
    );
  }

  return deepMergeWithPolicy(destination, source, policy, conflicts, ["assertions"]);
}

function mergeTest(
  testKey: string,
  destination: Test | undefined,
  source: Test,
  policy: ConflictPolicy,
  conflicts: PromotionConflict[],
): Test {
  const sourceWithoutAssertions = { ...source, assertions: undefined };
  const destinationWithoutAssertions = destination
    ? { ...destination, assertions: undefined }
    : undefined;
  const testConflicts: Array<Omit<PromotionConflict, "type" | "key">> = [];
  const mergedTest = deepMergeWithPolicy(
    destinationWithoutAssertions,
    sourceWithoutAssertions,
    policy,
    testConflicts,
  ) as Test;
  const assertionConflicts: Array<Omit<PromotionConflict, "type" | "key">> = [];
  const mergedAssertions = mergeAssertionArray(
    testKey,
    destination?.assertions,
    source.assertions,
    policy,
    assertionConflicts,
  );

  conflicts.push(
    ...testConflicts.map((conflict) => ({ type: "test" as const, key: testKey, ...conflict })),
    ...assertionConflicts.map((conflict) => ({
      type: "test" as const,
      key: testKey,
      ...conflict,
    })),
  );

  return {
    ...mergedTest,
    assertions: mergedAssertions || [],
  } as Test;
}

async function getPromotionPlan(
  sourceDatasource: Datasource,
  destinationDatasource: Datasource,
  options: Required<
    Pick<
      PromoteProjectSetsOptions,
      "includeFeatures" | "excludeFeatures" | "target" | "tag" | "allowEmpty" | "conflicts"
    >
  >,
) {
  const includeFeatures = toArray(options.includeFeatures);
  const excludeFeatures = toArray(options.excludeFeatures);
  const targetSelectors = toArray(options.target);
  const tagSelectors = toArray(options.tag);
  const availableTags = sourceDatasource.getConfig().tags;
  const unknownTag = tagSelectors.find((tag) => !availableTags.includes(tag));
  if (unknownTag) {
    throw new Error(
      `Unknown source tag "${unknownTag}". Available tags: ${availableTags.join(", ") || "none"}.`,
    );
  }
  const hasNoFilters =
    includeFeatures.length === 0 &&
    excludeFeatures.length === 0 &&
    targetSelectors.length === 0 &&
    tagSelectors.length === 0;

  const [
    featureKeys,
    segmentKeys,
    attributeKeys,
    schemaKeys,
    targetKeys,
    variableKeys,
    testKeys,
    scenarioKeys,
  ] = await Promise.all([
    sourceDatasource.listFeatures(),
    sourceDatasource.listSegments(),
    sourceDatasource.listAttributes(),
    sourceDatasource.listSchemas(),
    sourceDatasource.listTargets(),
    sourceDatasource.listVariables(),
    sourceDatasource.listTests(),
    sourceDatasource.listScenarios(),
  ]);

  const [features, segments, attributes, schemas, targets, variables, tests, scenarios] =
    await Promise.all([
      safeRead<ParsedFeature>(featureKeys, (key) => sourceDatasource.readFeature(key)),
      safeRead<Segment>(segmentKeys, (key) => sourceDatasource.readSegment(key)),
      safeRead<Attribute>(attributeKeys, (key) => sourceDatasource.readAttribute(key)),
      safeRead<Schema>(schemaKeys, (key) => sourceDatasource.readSchema(key)),
      safeRead<Target>(targetKeys, (key) => sourceDatasource.readTarget(key)),
      safeRead<ParsedVariable>(variableKeys, (key) => sourceDatasource.readVariable(key)),
      safeRead<Test>(testKeys, (key) => sourceDatasource.readTest(key)),
      safeRead<Scenario>(scenarioKeys, (key) => sourceDatasource.readScenario(key)),
    ]);

  const promotedFeatureKeys = new Set<string>();
  const promotedSegmentKeys = new Set<string>();
  const promotedAttributeKeys = new Set<string>();
  const promotedSchemaKeys = new Set<string>();
  const promotedTargetKeys = new Set<string>();
  const promotedVariableKeys = new Set<string>();

  const selectedTargets: Target[] = [];
  for (const key of targetSelectors) {
    const target = targets[key];
    if (!target) {
      throw new Error(
        `Unknown source target "${key}". Available targets: ${targetKeys.join(", ") || "none"}.`,
      );
    }
    selectedTargets.push(target);
    promotedTargetKeys.add(key);
  }

  if (hasNoFilters) {
    featureKeys.forEach((key) => promotedFeatureKeys.add(key));
    segmentKeys.forEach((key) => promotedSegmentKeys.add(key));
    attributeKeys.forEach((key) => promotedAttributeKeys.add(key));
    schemaKeys.forEach((key) => promotedSchemaKeys.add(key));
    targetKeys.forEach((key) => promotedTargetKeys.add(key));
    variableKeys.forEach((key) => promotedVariableKeys.add(key));
  } else {
    for (const key of featureKeys) {
      const feature = features[key];
      const matchesIncludes = includeFeatures.length === 0 || matchesPattern(key, includeFeatures);
      const matchesExcludes = matchesPattern(key, excludeFeatures);
      const matchesSelectedTags =
        tagSelectors.length === 0 || tagSelectors.some((tag) => (feature.tags || []).includes(tag));
      const matchesSelectedTargets =
        selectedTargets.length === 0 ||
        selectedTargets.some((target) => matchesTarget(key, feature, target));

      if (matchesIncludes && !matchesExcludes && matchesSelectedTags && matchesSelectedTargets) {
        promotedFeatureKeys.add(key);
      }
    }

    for (const key of variableKeys) {
      const variable = variables[key];
      const hasVariableSelectors = tagSelectors.length > 0 || selectedTargets.length > 0;
      const matchesSelectedTags =
        tagSelectors.length === 0 ||
        tagSelectors.some((tag) => (variable.tags || []).includes(tag));
      const matchesSelectedTargets =
        selectedTargets.length === 0 ||
        selectedTargets.some((target) => variableMatchesTarget(key, variable, target));
      if (hasVariableSelectors && matchesSelectedTags && matchesSelectedTargets) {
        promotedVariableKeys.add(key);
      }
    }

    const promotionGraph = await buildDependencyGraph(
      {
        listFeatures: async () => featureKeys,
        readFeature: async (key) => promotableFeature(features[key]),
        listSegments: async () => segmentKeys,
        readSegment: async (key) => segments[key],
        listVariables: async () => variableKeys,
        readVariable: async (key) => ({
          ...variables[key],
          overrides: getAllPromotableVariableOverrides(variables[key]).map((override) => ({
            ...override,
            overrides: undefined,
          })),
        }),
      },
      { includeOverride: isPromotable },
    );
    const structural = await collectDependencyClosure(
      sourceDatasource,
      [
        ...Array.from(promotedFeatureKeys, featureFlagNode),
        ...Array.from(promotedVariableKeys, variableNode),
      ],
      { graph: promotionGraph },
    );
    structural.features.forEach((key) => promotedFeatureKeys.add(key));
    structural.variables.forEach((key) => promotedVariableKeys.add(key));
    structural.segments.forEach((key) => promotedSegmentKeys.add(key));

    for (const key of promotedVariableKeys) {
      const variable = variables[key];
      if (!variable) continue;
      extractSchemaReferences(variable).forEach((schema) => promotedSchemaKeys.add(schema));
      collectConditionDependencies(variable.conditions, promotedSegmentKeys, promotedAttributeKeys);
      getAllPromotableVariableOverrides(variable).forEach((override) =>
        collectConditionDependencies(
          override.conditions,
          promotedSegmentKeys,
          promotedAttributeKeys,
        ),
      );
    }

    if (promotedFeatureKeys.size === 0 && promotedVariableKeys.size === 0 && !options.allowEmpty) {
      throw new Error("No source features or variables matched the promotion filters.");
    }
  }

  let previousFeatureCount = -1;
  while (previousFeatureCount !== promotedFeatureKeys.size) {
    previousFeatureCount = promotedFeatureKeys.size;

    for (const key of Array.from(promotedFeatureKeys)) {
      const feature = features[key];
      if (feature) {
        collectFeatureDependencies(
          feature,
          features,
          promotedFeatureKeys,
          promotedSegmentKeys,
          promotedAttributeKeys,
          promotedSchemaKeys,
        );
      }
    }
  }

  const pendingSegments = Array.from(promotedSegmentKeys);
  for (let index = 0; index < pendingSegments.length; index++) {
    const segmentKey = pendingSegments[index];
    const segment = segments[segmentKey];

    if (!segment) continue;

    const beforeSize = promotedSegmentKeys.size;
    collectConditionDependencies(segment.conditions, promotedSegmentKeys, promotedAttributeKeys);

    if (promotedSegmentKeys.size > beforeSize) {
      pendingSegments.push(
        ...Array.from(promotedSegmentKeys).filter((key) => !pendingSegments.includes(key)),
      );
    }
  }

  const pendingSchemas = Array.from(promotedSchemaKeys);
  for (let index = 0; index < pendingSchemas.length; index++) {
    const schemaKey = pendingSchemas[index];
    const schema = schemas[schemaKey];

    if (!schema) continue;

    const beforeSize = promotedSchemaKeys.size;
    extractSchemaReferences(schema).forEach((key) => promotedSchemaKeys.add(key));

    if (promotedSchemaKeys.size > beforeSize) {
      pendingSchemas.push(
        ...Array.from(promotedSchemaKeys).filter((key) => !pendingSchemas.includes(key)),
      );
    }
  }

  const [
    destinationFeatureKeys,
    destinationVariableKeys,
    destinationSegmentKeys,
    destinationTargetKeys,
  ] = hasNoFilters
    ? [[], [], [], []]
    : await Promise.all([
        destinationDatasource.listFeatures(),
        destinationDatasource.listVariables(),
        destinationDatasource.listSegments(),
        destinationDatasource.listTargets(),
      ]);
  const destinationFeatures = hasNoFilters
    ? {}
    : await safeRead<ParsedFeature>(destinationFeatureKeys, (key) =>
        destinationDatasource.readFeature(key),
      );
  const destinationVariables = new Set(destinationVariableKeys);
  const destinationSegments = new Set(destinationSegmentKeys);
  const destinationTargets = new Set(destinationTargetKeys);
  const referenceIsPromoted = (reference: TestCheckReference, owner?: string) =>
    reference.segment
      ? promotedSegmentKeys.has(reference.segment)
      : reference.feature
        ? promotedFeatureKeys.has(reference.feature)
        : promotedVariableKeys.has(reference.variable || owner!);
  const referenceExistsInDestination = (reference: TestCheckReference, owner?: string) => {
    if (reference.segment) return destinationSegments.has(reference.segment);
    if (reference.feature) {
      if (reference.variable === undefined) {
        return Object.prototype.hasOwnProperty.call(destinationFeatures, reference.feature);
      }

      return Boolean(
        Object.prototype.hasOwnProperty.call(
          destinationFeatures[reference.feature]?.variablesSchema || {},
          reference.variable,
        ),
      );
    }

    const variableKey = reference.variable || owner;
    return Boolean(variableKey && destinationVariables.has(variableKey));
  };

  const promotedTestKeys = testKeys.filter((key) => {
    if (hasNoFilters) return true;

    const test = tests[key];
    const ownerIsPromoted =
      ("feature" in test && promotedFeatureKeys.has(test.feature)) ||
      ("segment" in test && promotedSegmentKeys.has(test.segment)) ||
      ("variable" in test && promotedVariableKeys.has(test.variable));
    if (!ownerIsPromoted) return false;

    const owner = "variable" in test ? test.variable : undefined;
    const references = getTestCheckReferences(test);

    return references.every(
      (reference) =>
        referenceIsPromoted(reference, owner) || referenceExistsInDestination(reference, owner),
    );
  });
  const promotedScenarioKeys = scenarioKeys.filter((key) => {
    const scenario = scenarios[key];
    if (!isPromotable(scenario)) return false;
    if (hasNoFilters) return true;

    const references = getScenarioCheckReferences(scenario);
    if (!references.some((reference) => referenceIsPromoted(reference))) {
      return false;
    }

    return references.every(
      (reference) => referenceIsPromoted(reference) || referenceExistsInDestination(reference),
    );
  });

  const plans: EntityPlan[] = [];

  async function plan<T extends EntityValue>(
    type: EntityType,
    key: string,
    source: T,
    readDestinationEntity: (key: string) => Promise<T>,
    merge: (destination: T | undefined, source: T, conflicts: PromotionConflict[]) => T = (
      destination,
      sourceValue,
      conflicts,
    ) => {
      const entityConflicts: Array<Omit<PromotionConflict, "type" | "key">> = [];
      const merged = deepMergeWithPolicy(
        destination,
        sourceValue,
        options.conflicts,
        entityConflicts,
      ) as T;

      conflicts.push(...entityConflicts.map((conflict) => ({ type, key, ...conflict })));

      return merged;
    },
  ): Promise<EntityPlan> {
    const cleanedSource = withoutKey(source as any) as T;
    const destination = await readDestination<T>(key, readDestinationEntity);
    const cleanedDestination = destination ? (withoutKey(destination as any) as T) : undefined;

    if (cleanedDestination && (!isPromotable(cleanedSource) || !isPromotable(cleanedDestination))) {
      return {
        type,
        key,
        source: cleanedSource,
        destination: cleanedDestination,
        merged: cleanedDestination,
        conflicts: [],
      };
    }

    const conflicts: PromotionConflict[] = [];
    const changesTestKind =
      (type === "test" || type === "scenario") &&
      cleanedDestination &&
      classifyTestSpec(cleanedDestination) !== classifyTestSpec(cleanedSource);
    const variableKind = (variable: ParsedVariable) =>
      variable.compose === undefined
        ? "ordinary"
        : typeof variable.compose === "string"
          ? "alias"
          : "map";
    const changesVariableKind =
      type === "variable" &&
      cleanedDestination &&
      variableKind(cleanedDestination as ParsedVariable) !==
        variableKind(cleanedSource as ParsedVariable);
    let merged: T;
    if (changesTestKind || changesVariableKind) {
      // Distinct definition kinds must never be merged into a hybrid spec.
      conflicts.push({
        type,
        key,
        path: "",
        source: cleanedSource,
        destination: cleanedDestination,
      });
      merged = options.conflicts === "source" ? cleanedSource : cleanedDestination;
    } else {
      merged = merge(cleanedDestination, cleanedSource, conflicts);
    }

    return {
      type,
      key,
      source: cleanedSource,
      destination: cleanedDestination,
      merged,
      conflicts,
    };
  }

  for (const key of Array.from(promotedAttributeKeys).sort()) {
    if (attributes[key])
      plans.push(
        await plan("attribute", key, attributes[key], (entryKey) =>
          destinationDatasource.readAttribute(entryKey),
        ),
      );
  }

  for (const key of Array.from(promotedSegmentKeys).sort()) {
    if (segments[key])
      plans.push(
        await plan("segment", key, segments[key], (entryKey) =>
          destinationDatasource.readSegment(entryKey),
        ),
      );
  }

  for (const key of Array.from(promotedSchemaKeys).sort()) {
    if (schemas[key])
      plans.push(
        await plan("schema", key, schemas[key], (entryKey) =>
          destinationDatasource.readSchema(entryKey),
        ),
      );
  }

  for (const key of Array.from(promotedFeatureKeys).sort()) {
    if (features[key])
      plans.push(
        await plan(
          "feature",
          key,
          features[key],
          (entryKey) => destinationDatasource.readFeature(entryKey),
          (destination, source, conflicts) =>
            mergeFeature(key, destination, source, options.conflicts, conflicts),
        ),
      );
  }

  for (const key of Array.from(promotedVariableKeys).sort()) {
    if (variables[key])
      plans.push(
        await plan(
          "variable",
          key,
          variables[key],
          (entryKey) => destinationDatasource.readVariable(entryKey),
          (destination, source, conflicts) =>
            mergeVariable(key, destination, source, options.conflicts, conflicts),
        ),
      );
  }

  const testPlans: EntityPlan[] = [];
  const scenarioPlans: EntityPlan[] = [];

  for (const key of promotedTestKeys.sort()) {
    if (tests[key])
      testPlans.push(
        await plan(
          "test",
          key,
          tests[key],
          (entryKey) => destinationDatasource.readTest(entryKey),
          (destination, source, conflicts) =>
            mergeTest(key, destination, source, options.conflicts, conflicts),
        ),
      );
  }

  for (const key of promotedScenarioKeys.sort()) {
    if (scenarios[key])
      scenarioPlans.push(
        await plan("scenario", key, scenarios[key], (entryKey) =>
          destinationDatasource.readScenario(entryKey),
        ),
      );
  }

  const targetReferences = [...testPlans, ...scenarioPlans].flatMap((entry) =>
    getSpecTargetReferences(entry.merged as Test | Scenario).map((target) => ({ entry, target })),
  );
  for (const { entry, target } of targetReferences) {
    if (destinationTargets.has(target)) continue;
    if (!targets[target]) {
      throw new Error(
        `Cannot promote ${entry.type} "${entry.key}" because target "${target}" is missing from both source and destination.`,
      );
    }
    promotedTargetKeys.add(target);
  }

  for (const key of Array.from(promotedTargetKeys).sort()) {
    if (targets[key])
      plans.push(
        await plan("target", key, targets[key], (entryKey) =>
          destinationDatasource.readTarget(entryKey),
        ),
      );
  }

  plans.push(...testPlans, ...scenarioPlans);

  return plans;
}

/** Whether a file ends with a newline, or undefined when there is no file to read */
function endsWithNewline(filePath: string | undefined): boolean | undefined {
  if (!filePath || !fs.existsSync(filePath)) return undefined;
  return fs.readFileSync(filePath, "utf8").endsWith("\n");
}

async function writePlan(
  sourceDatasource: Datasource,
  destinationDatasource: Datasource,
  plans: EntityPlan[],
) {
  for (const plan of plans) {
    if (deepEqual(plan.destination, plan.merged)) {
      continue;
    }

    // a written file ends with a newline when the file it replaces did, or for a new file, the
    // file it came from, since a parser such as JSON's writes none
    const destinationPath = destinationDatasource.getEntitySourcePath(plan.type, plan.key);
    const newline =
      endsWithNewline(destinationPath) ??
      endsWithNewline(sourceDatasource.getEntitySourcePath(plan.type, plan.key));

    if (plan.type === "attribute")
      await destinationDatasource.writeAttribute(plan.key, plan.merged as Attribute);
    if (plan.type === "segment")
      await destinationDatasource.writeSegment(plan.key, plan.merged as Segment);
    if (plan.type === "schema")
      await destinationDatasource.writeSchema(plan.key, plan.merged as Schema);
    if (plan.type === "target")
      await destinationDatasource.writeTarget(plan.key, plan.merged as Target);
    if (plan.type === "feature")
      await destinationDatasource.writeFeature(plan.key, plan.merged as ParsedFeature);
    if (plan.type === "variable")
      await destinationDatasource.writeVariable(plan.key, plan.merged as ParsedVariable);
    if (plan.type === "test") await destinationDatasource.writeTest(plan.key, plan.merged as Test);
    if (plan.type === "scenario")
      await destinationDatasource.writeScenario(plan.key, plan.merged as Scenario);

    if (newline && endsWithNewline(destinationPath) === false) {
      fs.appendFileSync(destinationPath!, "\n");
    }
  }
}

function normalizeConflictPolicy(value: unknown): ConflictPolicy {
  if (typeof value === "undefined" || value === false) {
    return "source";
  }

  if (value === "source" || value === "destination" || value === "fail") {
    return value;
  }

  throw new Error(
    `Invalid --conflicts value "${String(value)}". Use source, destination, or fail.`,
  );
}

function normalizeAuditFormat(value: unknown): PromotionAuditFormat | false {
  if (typeof value === "undefined" || value === false || value === "false") {
    return false;
  }

  if (value === true || value === "true") {
    return "json";
  }

  if (value === "json" || value === "markdown") {
    return value;
  }

  throw new Error(`Invalid --audit value "${String(value)}". Use json or markdown.`);
}

function getTimestamp() {
  const date = new Date();
  const pad = (value: number) => (value < 10 ? `0${value}` : String(value));

  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function getEntityFilePath(
  projectConfig: ProjectConfig,
  type: EntityType,
  key: string,
  datasource?: Datasource,
) {
  if (type === "scenario" && datasource) return datasource.getScenarioSourcePath(key);
  if (type === "test" && datasource) return datasource.getTestSourcePath(key);
  const directories: Record<EntityType, string> = {
    attribute: projectConfig.attributesDirectoryPath,
    segment: projectConfig.segmentsDirectoryPath,
    feature: projectConfig.featuresDirectoryPath,
    schema: projectConfig.schemasDirectoryPath,
    target: projectConfig.targetsDirectoryPath,
    variable: projectConfig.variablesDirectoryPath,
    test: projectConfig.testsDirectoryPath,
    scenario: projectConfig.testsDirectoryPath,
  };
  const extension = (projectConfig.parser as any).extension || "yml";
  const pathSegments = key.split(projectConfig.namespaceCharacter);

  if (
    (type === "test" || type === "scenario") &&
    pathSegments.length > 1 &&
    pathSegments[pathSegments.length - 1] === "spec"
  ) {
    pathSegments[pathSegments.length - 2] = `${pathSegments[pathSegments.length - 2]}.spec`;
    pathSegments.pop();
  }

  return path.join(directories[type], ...pathSegments) + `.${extension}`;
}

function formatProjectPath(projectConfig: ProjectConfig, filePath: string) {
  const root = path.resolve(projectConfig.setsDirectoryPath, "..");
  const relative = path.relative(root, filePath);

  return relative.startsWith("..") ? filePath : relative;
}

async function getPromotionAuditFilePath(
  projectConfig: ProjectConfig,
  result: PromoteProjectSetsResult,
  format: PromotionAuditFormat,
) {
  const extension = format === "markdown" ? "md" : "json";
  const baseFileName = `${getTimestamp()}-${result.from}-to-${result.to}`;
  const directoryPath = path.join(projectConfig.stateDirectoryPath, "promotions");
  let suffix = 0;

  while (true) {
    const fileName = `${baseFileName}${suffix === 0 ? "" : `-${suffix}`}.${extension}`;
    const filePath = path.join(directoryPath, fileName);

    if (!fs.existsSync(filePath)) {
      return filePath;
    }

    suffix++;
  }
}

function getAuditPayload(result: PromoteProjectSetsResult) {
  return {
    from: result.from,
    to: result.to,
    apply: result.apply,
    filters: result.filters,
    dependencies: result.dependencies,
    files: result.files,
    conflicts: result.conflicts.map((conflict) => ({
      type: conflict.type,
      key: conflict.key,
      path: conflict.path,
      source: conflict.source,
      destination: conflict.destination,
    })),
    duration: result.duration,
  };
}

function stringifyMarkdownAudit(result: PromoteProjectSetsResult) {
  const lines = [
    "# Featurevisor Promotion",
    "",
    `- From: ${result.from}`,
    `- To: ${result.to}`,
    `- Mode: ${result.apply ? "apply" : "preview"}`,
    `- Conflicts: ${result.filters.conflicts}`,
    `- Duration: ${prettyDuration(result.duration)}`,
    "",
    "## Dependencies",
    "",
    `- Attributes: ${result.dependencies.attribute}`,
    `- Segments: ${result.dependencies.segment}`,
    `- Features: ${result.dependencies.feature}`,
    `- Variables: ${result.dependencies.variable}`,
    `- Schemas: ${result.dependencies.schema}`,
    `- Targets: ${result.dependencies.target}`,
    `- Tests: ${result.dependencies.test}`,
    `- Scenarios: ${result.dependencies.scenario}`,
    "",
    "## Files",
    "",
  ];

  for (const [label, files] of [
    ["Created", result.files.created],
    ["Updated", result.files.updated],
    ["Unchanged", result.files.unchanged],
  ] as const) {
    lines.push(`### ${label}`, "");
    lines.push(...(files.length > 0 ? files.map((filePath) => `- ${filePath}`) : ["- None"]));
    lines.push("");
  }

  if (result.conflicts.length > 0) {
    lines.push("## Conflicts", "");
    lines.push(
      ...result.conflicts.map(
        (conflict) => `- ${conflict.type} ${conflict.key} at ${conflict.path}`,
      ),
    );
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function writePromotionAudit(
  projectConfig: ProjectConfig,
  result: PromoteProjectSetsResult,
  format: PromotionAuditFormat,
) {
  const filePath = await getPromotionAuditFilePath(projectConfig, result, format);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

  const content =
    format === "markdown"
      ? stringifyMarkdownAudit(result)
      : `${JSON.stringify(getAuditPayload(result), null, 2)}\n`;

  await fs.promises.writeFile(filePath, content);

  return formatProjectPath(projectConfig, filePath);
}

export async function promoteProjectSets(
  projectConfig: ProjectConfig,
  datasource: Datasource,
  options: PromoteProjectSetsOptions,
): Promise<PromoteProjectSetsResult> {
  const startTime = Date.now();
  const conflictPolicy = normalizeConflictPolicy(options.conflicts);
  const auditFormat = normalizeAuditFormat(options.audit);

  if (!projectConfig.sets) {
    throw new Error("Promotion is only available when `sets: true` is configured.");
  }
  if (!options.from) throw new Error("Pass --from=<set>.");
  if (!options.to) throw new Error("Pass --to=<set>.");
  if (options.from === options.to) throw new Error("--from and --to must be different sets.");

  const sets = await datasource.listSets();
  if (!sets.includes(options.from)) {
    throw new Error(
      `Unknown source set "${options.from}". Available sets: ${sets.join(", ") || "none"}.`,
    );
  }
  if (!sets.includes(options.to)) {
    throw new Error(
      `Unknown destination set "${options.to}". Available sets: ${sets.join(", ") || "none"}.`,
    );
  }

  assertAllowedPromotionFlow(projectConfig, options.from, options.to);

  const sourceDatasource = datasource.forSet(options.from);
  const destinationDatasource = datasource.forSet(options.to);

  await assertSetLintsClean(options.from, sourceDatasource.getConfig(), sourceDatasource);
  await assertSetLintsClean(options.to, destinationDatasource.getConfig(), destinationDatasource);

  const plans = await getPromotionPlan(sourceDatasource, destinationDatasource, {
    includeFeatures: options.includeFeatures || [],
    excludeFeatures: options.excludeFeatures || [],
    target: options.target || [],
    tag: options.tag || [],
    allowEmpty: options.allowEmpty === true,
    conflicts: conflictPolicy,
  });
  const conflicts = plans.flatMap((plan) => plan.conflicts);

  if (conflictPolicy === "fail" && conflicts.length > 0) {
    const preview = conflicts
      .slice(0, 5)
      .map((conflict) => `${conflict.type} "${conflict.key}" at ${conflict.path}`)
      .join("\n");
    const suffix = conflicts.length > 5 ? `\n...and ${conflicts.length - 5} more` : "";

    throw new Error(
      `Promotion has ${conflicts.length} conflict(s) and --conflicts=fail was used.\n${preview}${suffix}`,
    );
  }

  await assertPromotionLintsClean(options.to, destinationDatasource, plans);
  if (options.apply === true) {
    await writePlan(sourceDatasource, destinationDatasource, plans);
  }

  const created = plans
    .filter((plan) => !plan.destination)
    .map((plan) =>
      formatProjectPath(
        projectConfig,
        getEntityFilePath(
          destinationDatasource.getConfig(),
          plan.type,
          plan.key,
          destinationDatasource,
        ),
      ),
    );
  const updated = plans
    .filter((plan) => plan.destination && !deepEqual(plan.destination, plan.merged))
    .map((plan) =>
      formatProjectPath(
        projectConfig,
        getEntityFilePath(
          destinationDatasource.getConfig(),
          plan.type,
          plan.key,
          destinationDatasource,
        ),
      ),
    );
  const unchanged = plans
    .filter((plan) => plan.destination && deepEqual(plan.destination, plan.merged))
    .map((plan) =>
      formatProjectPath(
        projectConfig,
        getEntityFilePath(
          destinationDatasource.getConfig(),
          plan.type,
          plan.key,
          destinationDatasource,
        ),
      ),
    );

  const dependencies = {
    attribute: plans.filter((plan) => plan.type === "attribute").length,
    segment: plans.filter((plan) => plan.type === "segment").length,
    feature: plans.filter((plan) => plan.type === "feature").length,
    schema: plans.filter((plan) => plan.type === "schema").length,
    target: plans.filter((plan) => plan.type === "target").length,
    variable: plans.filter((plan) => plan.type === "variable").length,
    test: plans.filter((plan) => plan.type === "test").length,
    scenario: plans.filter((plan) => plan.type === "scenario").length,
  };

  const result: PromoteProjectSetsResult = {
    from: options.from,
    to: options.to,
    apply: options.apply === true,
    duration: Date.now() - startTime,
    filters: {
      includeFeatures: toArray(options.includeFeatures),
      excludeFeatures: toArray(options.excludeFeatures),
      targets: toArray(options.target),
      tags: toArray(options.tag),
      conflicts: conflictPolicy,
    },
    dependencies,
    files: { created, updated, unchanged },
    conflicts,
  };

  if (result.apply && auditFormat) {
    result.auditFilePath = await writePromotionAudit(projectConfig, result, auditFormat);
  }

  return result;
}

function printFileGroup(label: string, files: string[], color: number) {
  if (files.length === 0) {
    return;
  }

  console.log(CLI_FORMAT_BOLD, label);
  for (const filePath of files) {
    console.log(`  ${colorize(filePath, color)}`);
  }
  console.log("");
}

function printConflictPreview(conflicts: PromotionConflict[]) {
  if (conflicts.length === 0) {
    return;
  }

  console.log(CLI_FORMAT_BOLD, "Conflicts");
  for (const conflict of conflicts.slice(0, 10)) {
    console.log(
      `  ${colorize(conflict.type, CLI_COLOR_YELLOW)} ${conflict.key} ${colorize(
        conflict.path,
        CLI_COLOR_DIM,
      )}`,
    );
  }
  if (conflicts.length > 10) {
    console.log(`  ${colorize(`...and ${conflicts.length - 10} more`, CLI_COLOR_DIM)}`);
  }
  console.log("");
}

function printPromoteResult(
  result: PromoteProjectSetsResult,
  options: { showUnchanged?: boolean } = {},
) {
  console.log("");
  console.log(CLI_FORMAT_BOLD, "Promoting Featurevisor set definitions");
  console.log(`  From: ${result.from}`);
  console.log(`  To:   ${result.to}`);
  console.log(`  Mode: ${result.apply ? "apply" : "preview"}`);
  if (result.filters.includeFeatures.length > 0) {
    console.log(`  Include features: ${result.filters.includeFeatures.join(", ")}`);
  }
  if (result.filters.excludeFeatures.length > 0) {
    console.log(`  Exclude features: ${result.filters.excludeFeatures.join(", ")}`);
  }
  if (result.filters.targets.length > 0) {
    console.log(`  Targets: ${result.filters.targets.join(", ")}`);
  }
  if (result.filters.tags.length > 0) {
    console.log(`  Tags: ${result.filters.tags.join(", ")}`);
  }
  console.log(`  Conflict policy: ${result.filters.conflicts}`);
  console.log("");
  console.log(
    `  Dependencies: ${result.dependencies.attribute} attributes, ${result.dependencies.segment} segments, ${result.dependencies.feature} features, ${result.dependencies.variable} variables, ${result.dependencies.schema} schemas, ${result.dependencies.target} targets, ${result.dependencies.test} tests, ${result.dependencies.scenario} scenarios`,
  );
  console.log(`  Created:   ${result.files.created.length}`);
  console.log(`  Updated:   ${result.files.updated.length}`);
  console.log(`  Unchanged: ${result.files.unchanged.length}`);
  console.log(`  Conflicts: ${result.conflicts.length}`);
  console.log("");

  printFileGroup("Created", result.files.created, CLI_COLOR_GREEN);
  printFileGroup("Updated", result.files.updated, CLI_COLOR_YELLOW);
  if (options.showUnchanged === true) {
    printFileGroup("Unchanged", result.files.unchanged, CLI_COLOR_DIM);
  }
  printConflictPreview(result.conflicts);

  if (result.auditFilePath) {
    console.log(`  Audit: ${colorize(result.auditFilePath, CLI_COLOR_CYAN)}`);
    console.log("");
  }

  console.log(CLI_FORMAT_GREEN, result.apply ? "Promotion applied" : "Promotion preview complete");
  console.log(CLI_FORMAT_BOLD, `Time: ${prettyDuration(result.duration)}`);
}

export const promotePlugin: Plugin = {
  command: "promote",
  description: "Preview or apply a promotion between project sets",
  handler: async ({ projectConfig, datasource, parsed }) => {
    const result = await promoteProjectSets(projectConfig, datasource, {
      from: parsed.from,
      to: parsed.to,
      includeFeatures: parsed.includeFeatures,
      excludeFeatures: parsed.excludeFeatures,
      target: parsed.target,
      tag: parsed.tag,
      conflicts: parsed.conflicts,
      allowEmpty: parsed.allowEmpty === true || parsed.allowEmpty === "true",
      apply: parsed.apply === true || parsed.apply === "true",
      audit: parsed.audit === "" || parsed.audit === true ? true : parsed.audit,
    });

    printPromoteResult(result, {
      showUnchanged: parsed.showUnchanged === true || parsed.showUnchanged === "true",
    });
  },
  examples: [
    {
      command: "promote --from=dev --to=staging",
      description: "Preview definitions that can be promoted from one set to another",
    },
    {
      command: "promote --from=dev --to=staging --target=web",
      description: "Preview the target and every definition needed to build its datafile",
    },
    {
      command: "promote --from=dev --to=staging --tag=web",
      description: "Preview definitions affecting features with a tag",
    },
    {
      command: 'promote --from=dev --to=staging --include-features="checkout*"',
      description: "Preview definitions affecting matching features",
    },
    {
      command: "promote --from=dev --to=staging --conflicts=fail",
      description: "Fail instead of overwriting conflicting destination fields",
    },
    {
      command: "promote --from=dev --to=staging --apply",
      description: "Apply a promotion and write destination files",
    },
    {
      command: "promote --from=dev --to=staging --apply --audit=markdown",
      description: "Write a promotion audit file",
    },
    {
      command: "promote --from=dev --to=staging --show-unchanged",
      description: "Preview a promotion and include unchanged entries",
    },
  ],
};
