import * as fs from "fs";
import * as path from "path";

import type {
  Attribute,
  Condition,
  EntityType,
  GroupSegment,
  ParsedFeature,
  Rule,
  RulesByEnvironment,
  Schema,
  Segment,
  Test,
} from "@featurevisor/types";

import type { ProjectConfig } from "../config";
import type { Datasource } from "../datasource";
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
import type { Plugin } from "../cli";

type ConflictPolicy = "source" | "destination" | "fail";
type PromotionAuditFormat = "json" | "markdown";
type EntityValue = Attribute | Segment | ParsedFeature | Record<string, unknown> | Schema | Test;

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
): unknown {
  if (typeof destination === "undefined") return source;
  if (typeof source === "undefined") return destination;

  const conflictPath = pathSegments.join(".") || "<root>";

  if (Array.isArray(destination) && Array.isArray(source)) {
    if (!deepEqual(destination, source)) {
      conflicts.push({ path: conflictPath, source, destination });
    }

    return policy === "destination" ? destination : source;
  }

  if (isPlainObject(destination) && isPlainObject(source)) {
    const result: Record<string, unknown> = { ...destination };

    for (const key of Object.keys(source)) {
      result[key] = deepMergeWithPolicy(result[key], source[key], policy, conflicts, [
        ...pathSegments,
        key,
      ]);
    }

    return result;
  }

  if (!deepEqual(destination, source)) {
    conflicts.push({ path: conflictPath, source, destination });
  }

  return policy === "destination" ? destination : source;
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

function withoutKey<T extends Record<string, unknown>>(entity: T): T {
  const { key: _key, ...rest } = entity;

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

function collectGroupSegmentKeys(
  value: GroupSegment | GroupSegment[] | "*" | undefined,
  result: Set<string>,
) {
  if (!value || value === "*") return;
  if (typeof value === "string") {
    result.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectGroupSegmentKeys(entry, result));
    return;
  }
  if ("and" in value) value.and.forEach((entry) => collectGroupSegmentKeys(entry, result));
  if ("or" in value) value.or.forEach((entry) => collectGroupSegmentKeys(entry, result));
  if ("not" in value) value.not.forEach((entry) => collectGroupSegmentKeys(entry, result));
}

function collectConditionDependencies(
  value: Condition | Condition[] | "*" | undefined,
  segments: Set<string>,
  attributes: Set<string>,
) {
  if (!value || value === "*") return;
  if (typeof value === "string") {
    segments.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectConditionDependencies(entry, segments, attributes));
    return;
  }
  if ("attribute" in value) {
    attributes.add(value.attribute.split(".")[0]);
    return;
  }
  if ("and" in value)
    value.and.forEach((entry) => collectConditionDependencies(entry, segments, attributes));
  if ("or" in value)
    value.or.forEach((entry) => collectConditionDependencies(entry, segments, attributes));
  if ("not" in value)
    value.not.forEach((entry) => collectConditionDependencies(entry, segments, attributes));
}

function collectSchemaReferences(value: unknown, schemas: Set<string>) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectSchemaReferences(entry, schemas));
    return;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.schema === "string") {
    schemas.add(record.schema);
  }

  Object.values(record).forEach((entry) => collectSchemaReferences(entry, schemas));
}

function collectFeatureDependencies(
  feature: ParsedFeature,
  features: Record<string, ParsedFeature>,
  featureKeys: Set<string>,
  segmentKeys: Set<string>,
  attributeKeys: Set<string>,
  schemaKeys: Set<string>,
) {
  collectSchemaReferences(feature.variablesSchema, schemaKeys);

  for (const required of feature.required || []) {
    const requiredKey = typeof required === "string" ? required : required.key;
    if (!featureKeys.has(requiredKey)) {
      featureKeys.add(requiredKey);
      const requiredFeature = features[requiredKey];
      if (requiredFeature) {
        collectFeatureDependencies(
          requiredFeature,
          features,
          featureKeys,
          segmentKeys,
          attributeKeys,
          schemaKeys,
        );
      }
    }
  }

  for (const rules of Object.values((feature.rules || {}) as any)) {
    const ruleEntries = Array.isArray(rules) ? rules : [rules];
    for (const rule of ruleEntries) {
      if (!isPromotable(rule)) {
        continue;
      }

      collectGroupSegmentKeys(rule?.segments, segmentKeys);
      Object.values(rule?.variableOverrides || {}).forEach((overrides: any) => {
        (overrides || []).forEach((override: any) => {
          collectGroupSegmentKeys(override.segments, segmentKeys);
          collectConditionDependencies(override.conditions, segmentKeys, attributeKeys);
        });
      });
    }
  }

  for (const force of Object.values((feature.force || {}) as any)) {
    const forceEntries = Array.isArray(force) ? force : [force];
    for (const forceEntry of forceEntries) {
      collectGroupSegmentKeys(forceEntry?.segments, segmentKeys);
      collectConditionDependencies(forceEntry?.conditions, segmentKeys, attributeKeys);
    }
  }
}

function mergeRuleArray(
  destination: Rule[] | undefined,
  source: Rule[] | undefined,
  policy: ConflictPolicy,
  conflicts: Array<Omit<PromotionConflict, "type" | "key">>,
  pathSegments: string[],
) {
  if (typeof source === "undefined") return destination;
  if (typeof destination === "undefined") return source.filter((rule) => isPromotable(rule));

  const mergedRuleKeys = new Set<string>();
  const mergedRules: Rule[] = [];

  for (const sourceRule of source) {
    if (!isPromotable(sourceRule)) {
      continue;
    }

    const destinationRule = destination.find((rule) => rule.key === sourceRule.key);
    mergedRuleKeys.add(sourceRule.key);

    if (destinationRule && !isPromotable(destinationRule)) {
      mergedRules.push(destinationRule);
      continue;
    }

    mergedRules.push(
      deepMergeWithPolicy(destinationRule, sourceRule, policy, conflicts, [
        ...pathSegments,
        sourceRule.key,
      ]) as Rule,
    );
  }

  for (const destinationRule of destination) {
    if (!mergedRuleKeys.has(destinationRule.key)) {
      mergedRules.push(destinationRule);
    }
  }

  return mergedRules;
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

function mergeFeature(
  featureKey: string,
  destination: ParsedFeature | undefined,
  source: ParsedFeature,
  policy: ConflictPolicy,
  conflicts: PromotionConflict[],
): ParsedFeature {
  const sourceWithoutRules = { ...source, rules: undefined };
  const destinationWithoutRules = destination ? { ...destination, rules: undefined } : undefined;
  const featureConflicts: Array<Omit<PromotionConflict, "type" | "key">> = [];
  const mergedFeature = deepMergeWithPolicy(
    destinationWithoutRules,
    sourceWithoutRules,
    policy,
    featureConflicts,
  ) as ParsedFeature;
  const ruleConflicts: Array<Omit<PromotionConflict, "type" | "key">> = [];
  const mergedRules = mergeRules(destination?.rules, source.rules, policy, ruleConflicts);

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
  );

  return {
    ...mergedFeature,
    rules: mergedRules,
  };
}

async function getPromotionPlan(
  sourceDatasource: Datasource,
  destinationDatasource: Datasource,
  options: Required<
    Pick<
      PromoteProjectSetsOptions,
      "includeFeatures" | "excludeFeatures" | "allowEmpty" | "conflicts"
    >
  >,
) {
  const includeFeatures = toArray(options.includeFeatures);
  const excludeFeatures = toArray(options.excludeFeatures);
  const hasNoFilters = includeFeatures.length === 0 && excludeFeatures.length === 0;

  const [featureKeys, segmentKeys, attributeKeys, groupKeys, schemaKeys, testKeys] =
    await Promise.all([
      sourceDatasource.listFeatures(),
      sourceDatasource.listSegments(),
      sourceDatasource.listAttributes(),
      sourceDatasource.listGroups(),
      sourceDatasource.listSchemas(),
      sourceDatasource.listTests(),
    ]);

  const [features, segments, attributes, groups, schemas, tests] = await Promise.all([
    safeRead<ParsedFeature>(featureKeys, (key) => sourceDatasource.readFeature(key)),
    safeRead<Segment>(segmentKeys, (key) => sourceDatasource.readSegment(key)),
    safeRead<Attribute>(attributeKeys, (key) => sourceDatasource.readAttribute(key)),
    safeRead<Record<string, unknown>>(groupKeys, (key) => sourceDatasource.readGroup(key) as any),
    safeRead<Schema>(schemaKeys, (key) => sourceDatasource.readSchema(key)),
    safeRead<Test>(testKeys, (key) => sourceDatasource.readTest(key)),
  ]);

  const promotedFeatureKeys = new Set<string>();
  const promotedSegmentKeys = new Set<string>();
  const promotedAttributeKeys = new Set<string>();
  const promotedGroupKeys = new Set<string>();
  const promotedSchemaKeys = new Set<string>();

  if (hasNoFilters) {
    featureKeys.forEach((key) => promotedFeatureKeys.add(key));
    segmentKeys.forEach((key) => promotedSegmentKeys.add(key));
    attributeKeys.forEach((key) => promotedAttributeKeys.add(key));
    groupKeys.forEach((key) => promotedGroupKeys.add(key));
    schemaKeys.forEach((key) => promotedSchemaKeys.add(key));
  } else {
    let matchedFeatureCount = 0;

    for (const key of featureKeys) {
      if (matchesPattern(key, includeFeatures) && !matchesPattern(key, excludeFeatures)) {
        promotedFeatureKeys.add(key);
        matchedFeatureCount++;
      }
    }

    if (includeFeatures.length > 0 && matchedFeatureCount === 0 && !options.allowEmpty) {
      throw new Error(
        `No source features matched --includeFeatures=${includeFeatures.join(", ")}.`,
      );
    }
  }

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
    collectSchemaReferences(schema, promotedSchemaKeys);

    if (promotedSchemaKeys.size > beforeSize) {
      pendingSchemas.push(
        ...Array.from(promotedSchemaKeys).filter((key) => !pendingSchemas.includes(key)),
      );
    }
  }

  const promotedTestKeys = testKeys.filter((key) => {
    const test = tests[key] as any;
    return promotedFeatureKeys.has(test.feature) || promotedSegmentKeys.has(test.segment);
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
  ) {
    const cleanedSource = withoutKey(source as any) as T;
    const destination = await readDestination<T>(key, readDestinationEntity);
    const cleanedDestination = destination ? (withoutKey(destination as any) as T) : undefined;

    if (cleanedDestination && (!isPromotable(cleanedSource) || !isPromotable(cleanedDestination))) {
      plans.push({
        type,
        key,
        source: cleanedSource,
        destination: cleanedDestination,
        merged: cleanedDestination,
        conflicts: [],
      });

      return;
    }

    const conflicts: PromotionConflict[] = [];
    const merged = merge(cleanedDestination, cleanedSource, conflicts);

    plans.push({
      type,
      key,
      source: cleanedSource,
      destination: cleanedDestination,
      merged,
      conflicts,
    });
  }

  for (const key of Array.from(promotedAttributeKeys).sort()) {
    if (attributes[key])
      await plan("attribute", key, attributes[key], (entryKey) =>
        destinationDatasource.readAttribute(entryKey),
      );
  }

  for (const key of Array.from(promotedSegmentKeys).sort()) {
    if (segments[key])
      await plan("segment", key, segments[key], (entryKey) =>
        destinationDatasource.readSegment(entryKey),
      );
  }

  for (const key of Array.from(promotedGroupKeys).sort()) {
    if (groups[key])
      await plan(
        "group",
        key,
        groups[key],
        (entryKey) => destinationDatasource.readGroup(entryKey) as any,
      );
  }

  for (const key of Array.from(promotedSchemaKeys).sort()) {
    if (schemas[key])
      await plan("schema", key, schemas[key], (entryKey) =>
        destinationDatasource.readSchema(entryKey),
      );
  }

  for (const key of Array.from(promotedFeatureKeys).sort()) {
    if (features[key])
      await plan(
        "feature",
        key,
        features[key],
        (entryKey) => destinationDatasource.readFeature(entryKey),
        (destination, source, conflicts) =>
          mergeFeature(key, destination, source, options.conflicts, conflicts),
      );
  }

  for (const key of promotedTestKeys.sort()) {
    if (tests[key])
      await plan("test", key, tests[key], (entryKey) => destinationDatasource.readTest(entryKey));
  }

  return plans;
}

async function writePlan(destinationDatasource: Datasource, plans: EntityPlan[]) {
  for (const plan of plans) {
    if (deepEqual(plan.destination, plan.merged)) {
      continue;
    }

    if (plan.type === "attribute")
      await destinationDatasource.writeAttribute(plan.key, plan.merged as Attribute);
    if (plan.type === "segment")
      await destinationDatasource.writeSegment(plan.key, plan.merged as Segment);
    if (plan.type === "group")
      await destinationDatasource.writeGroup(
        plan.key,
        plan.merged as Record<string, unknown> as any,
      );
    if (plan.type === "schema")
      await destinationDatasource.writeSchema(plan.key, plan.merged as Schema);
    if (plan.type === "feature")
      await destinationDatasource.writeFeature(plan.key, plan.merged as ParsedFeature);
    if (plan.type === "test") await destinationDatasource.writeTest(plan.key, plan.merged as Test);
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

function getEntityFilePath(projectConfig: ProjectConfig, type: EntityType, key: string) {
  const directories: Record<EntityType, string> = {
    attribute: projectConfig.attributesDirectoryPath,
    segment: projectConfig.segmentsDirectoryPath,
    feature: projectConfig.featuresDirectoryPath,
    group: projectConfig.groupsDirectoryPath,
    schema: projectConfig.schemasDirectoryPath,
    test: projectConfig.testsDirectoryPath,
  };
  const extension = (projectConfig.parser as any).extension || "yml";

  return path.join(directories[type], ...key.split("/")) + `.${extension}`;
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
    `- Groups: ${result.dependencies.group}`,
    `- Schemas: ${result.dependencies.schema}`,
    `- Tests: ${result.dependencies.test}`,
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

  if (options.apply === true) {
    await writePlan(destinationDatasource, plans);
  }

  const created = plans
    .filter((plan) => !plan.destination)
    .map((plan) =>
      formatProjectPath(
        projectConfig,
        getEntityFilePath(destinationDatasource.getConfig(), plan.type, plan.key),
      ),
    );
  const updated = plans
    .filter((plan) => plan.destination && !deepEqual(plan.destination, plan.merged))
    .map((plan) =>
      formatProjectPath(
        projectConfig,
        getEntityFilePath(destinationDatasource.getConfig(), plan.type, plan.key),
      ),
    );
  const unchanged = plans
    .filter((plan) => plan.destination && deepEqual(plan.destination, plan.merged))
    .map((plan) =>
      formatProjectPath(
        projectConfig,
        getEntityFilePath(destinationDatasource.getConfig(), plan.type, plan.key),
      ),
    );

  const dependencies = {
    attribute: plans.filter((plan) => plan.type === "attribute").length,
    segment: plans.filter((plan) => plan.type === "segment").length,
    feature: plans.filter((plan) => plan.type === "feature").length,
    group: plans.filter((plan) => plan.type === "group").length,
    schema: plans.filter((plan) => plan.type === "schema").length,
    test: plans.filter((plan) => plan.type === "test").length,
  };

  const result: PromoteProjectSetsResult = {
    from: options.from,
    to: options.to,
    apply: options.apply === true,
    duration: Date.now() - startTime,
    filters: {
      includeFeatures: toArray(options.includeFeatures),
      excludeFeatures: toArray(options.excludeFeatures),
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
  console.log(`  Conflict policy: ${result.filters.conflicts}`);
  console.log("");
  console.log(
    `  Dependencies: ${result.dependencies.attribute} attributes, ${result.dependencies.segment} segments, ${result.dependencies.feature} features, ${result.dependencies.group} groups, ${result.dependencies.schema} schemas, ${result.dependencies.test} tests`,
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
  handler: async ({ projectConfig, datasource, parsed }) => {
    const result = await promoteProjectSets(projectConfig, datasource, {
      from: parsed.from,
      to: parsed.to,
      includeFeatures: parsed.includeFeatures,
      excludeFeatures: parsed.excludeFeatures,
      conflicts: parsed.conflicts,
      allowEmpty: parsed.allowEmpty === true || parsed.allowEmpty === "true",
      apply: parsed.apply === true || parsed.apply === "true",
      audit: parsed.audit,
    });

    printPromoteResult(result, {
      showUnchanged: parsed.showUnchanged === true || parsed.showUnchanged === "true",
    });
  },
  examples: [
    {
      command: "promote --from=dev --to=staging",
      description: "preview definitions that can be promoted from one set to another",
    },
    {
      command: 'promote --from=dev --to=staging --includeFeatures="checkout*"',
      description: "preview definitions affecting matching features",
    },
    {
      command: "promote --from=dev --to=staging --conflicts=fail",
      description: "fail instead of overwriting conflicting destination fields",
    },
    {
      command: "promote --from=dev --to=staging --apply",
      description: "apply a promotion and write destination files",
    },
    {
      command: "promote --from=dev --to=staging --apply --audit=markdown",
      description: "write a promotion audit file",
    },
    {
      command: "promote --from=dev --to=staging --showUnchanged",
      description: "preview a promotion and include unchanged entries",
    },
  ],
};
