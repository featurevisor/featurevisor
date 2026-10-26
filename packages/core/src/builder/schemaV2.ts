import * as crypto from "crypto";

import type {
  AttributeCondition,
  Condition,
  Conditions,
  DatafileContent,
  DatafileVariable,
  DatafileVariableOverride,
  Feature,
  FeatureCondition,
  Force,
  GroupSegment,
  RequiredFeature,
  ResolvedVariableSchema,
  Segment,
  Traffic,
  VariableOverride,
} from "@featurevisor/types";

import { parseConditions } from "../datasource/conditions";

/**
 * Schema "2" is the datafile format of Featurevisor v2 and v3. Targets that
 * set `schemaVersion: "2"` are converted for the latest v3 JavaScript SDK,
 * @featurevisor/sdk 3.8, which reads:
 *
 * - rule and force `segments`, made of segment keys with `and`, `or` and `not`
 * - force and override `conditions` of attributes only
 * - flat `requiredFeatures` lists on features, global variables and overrides
 * - segments whose conditions compare attributes only
 *
 * Anything else has no schema "2" form and is reported as an issue, never
 * dropped, so an older application cannot silently receive a different
 * configuration.
 */
export const SCHEMA_V2 = "2";

const V4_ONLY_OPERATORS = new Set([
  "isNull",
  "notNull",
  "empty",
  "notEmpty",
  "includesAny",
  "notIncludesAny",
]);

// Empty groups are false in v4. In schema "2" an empty `and` is true, while an
// empty `or` is false in both, so it stands for false.
const NEVER: Condition = { or: [] };

export type SchemaV2EntityType = "feature" | "segment" | "variable";

export interface SchemaV2Issue {
  entityType: SchemaV2EntityType;
  key: string;
  /** Where in the definition, such as `["rules", "everyone", "conditions"]`. */
  path: (string | number)[];
  /** Where in words, such as `rule "everyone"`. */
  location: string;
  reason: string;
}

export interface SchemaV2Result {
  datafile: DatafileContent;
  issues: SchemaV2Issue[];
}

export interface SchemaV2Options {
  stringify?: boolean;
}

export class SchemaV2ConversionError extends Error {
  readonly issues: SchemaV2Issue[];
  readonly targetKey?: string;

  constructor(issues: SchemaV2Issue[], targetKey?: string, environment?: string | false) {
    const where = [
      targetKey ? `Target "${targetKey}"` : "This datafile",
      environment ? `in environment "${environment}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    super(
      `${where} sets schemaVersion "2" for @featurevisor/sdk 3, which cannot express:\n` +
        issues.map((issue) => `  - ${describeIssue(issue)}`).join("\n") +
        `\nKeep these definitions out of the target, or write them in a form schema "2" supports. Run featurevisor lint to see each file.`,
    );
    this.name = "SchemaV2ConversionError";
    this.issues = issues;
    this.targetKey = targetKey;
  }
}

export function describeIssue(issue: SchemaV2Issue): string {
  return `${issue.entityType} "${issue.key}", ${issue.location}: ${issue.reason}`;
}

type Kind = "attribute" | "segment" | "feature" | "variable";

interface Scope {
  entityType: SchemaV2EntityType;
  key: string;
  path: (string | number)[];
  location: string;
}

function isGroup(
  value: Condition,
): value is { and: Condition[] } | { or: Condition[] } | { not: Condition[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    ("and" in value || "or" in value || "not" in value)
  );
}

function children(value: Condition | Condition[]): Condition[] {
  if (Array.isArray(value)) return value;
  const group = value as { and?: Condition[]; or?: Condition[]; not?: Condition[] };
  return group.and || group.or || group.not || [];
}

function kindOf(leaf: Condition): Kind {
  if (typeof leaf === "string") return "segment";
  if ("feature" in leaf && !("variable" in leaf)) return "feature";
  if ("variable" in leaf) return "variable";
  return "attribute";
}

/** Every leaf kind under a node, so callers can choose a schema "2" form. */
function kinds(value: Conditions, out = new Set<Kind>()): Set<Kind> {
  if (value === "*") return out;
  if (Array.isArray(value) || isGroup(value as Condition)) {
    for (const child of children(value as Condition | Condition[])) kinds(child, out);
    return out;
  }
  out.add(kindOf(value as Condition));
  return out;
}

/** The first leaf of a kind, for naming it in an issue. */
function firstLeaf(value: Conditions, kind: Kind): Condition | undefined {
  if (value === "*") return undefined;
  if (Array.isArray(value) || isGroup(value as Condition)) {
    for (const child of children(value as Condition | Condition[])) {
      const found = firstLeaf(child, kind);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return kindOf(value as Condition) === kind ? (value as Condition) : undefined;
}

/** A copy without fields that schema "2" writes differently. */
function without<T extends object>(value: T, keys: string[]): T {
  const result = { ...value } as Record<string, unknown>;
  for (const key of keys) delete result[key];
  return result as T;
}

function shortHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 10);
}

export function convertDatafileToSchemaV2(
  datafile: DatafileContent,
  options: SchemaV2Options = {},
): SchemaV2Result {
  const stringify = options.stringify === true;
  const issues: SchemaV2Issue[] = [];
  const v4Segments = datafile.segments || {};
  const segments: Record<string, Segment> = {};
  const synthesized = new Map<string, Condition | Condition[]>();

  const report = (scope: Scope, reason: string) => issues.push({ ...scope, reason });

  const describeLeaf = (leaf: Condition): string => {
    if (typeof leaf === "string") return `segment "${leaf}"`;
    if ("variable" in leaf)
      return leaf.feature
        ? `variable "${leaf.variable}" of feature "${leaf.feature}"`
        : `variable "${leaf.variable}"`;
    if ("feature" in leaf) return `feature "${(leaf as FeatureCondition).feature}"`;
    return `attribute "${(leaf as AttributeCondition).attribute}"`;
  };

  /** An attribute leaf, refusing operators the v3 SDK does not know. */
  const attribute = (leaf: AttributeCondition, scope: Scope): Condition => {
    if (V4_ONLY_OPERATORS.has(leaf.operator)) {
      report(scope, `uses operator "${leaf.operator}", which @featurevisor/sdk 3 does not support`);
    }
    return { ...leaf };
  };

  /**
   * Attribute conditions, the schema "2" form for segments, force entries and
   * overrides. Segment references are replaced by their own conditions.
   */
  const toConditions = (
    value: Conditions,
    scope: Scope,
    visiting: Set<string> = new Set(),
  ): Condition | Condition[] => {
    if (value === "*") return "*";
    if (typeof value === "string") {
      const segment = v4Segments[value];
      if (!segment || visiting.has(value)) return NEVER;
      const next = new Set(visiting);
      next.add(value);
      return toConditions(parseConditions(segment.conditions), scope, next);
    }
    if (Array.isArray(value)) {
      return value.length
        ? value.map((child) => toConditions(child, scope, visiting) as Condition)
        : NEVER;
    }
    if (isGroup(value)) {
      const list = children(value);
      if (!list.length) return NEVER;
      const mapped = list.map((child) => toConditions(child, scope, visiting) as Condition);
      if ("and" in value) return { and: mapped };
      if ("or" in value) return { or: mapped };
      return { not: mapped };
    }
    const kind = kindOf(value);
    if (kind === "attribute") return attribute(value as AttributeCondition, scope);
    report(
      scope,
      kind === "variable"
        ? `reads ${describeLeaf(value)}, and schema "2" has no variable conditions`
        : `requires ${describeLeaf(value)} where schema "2" can only compare attributes`,
    );
    return NEVER;
  };

  /** A segment for an attribute only part of a rule or force entry. */
  const synthesize = (value: Condition | Condition[], scope: Scope): string => {
    const conditions = toConditions(value as Conditions, scope);
    const key = `~${shortHash(JSON.stringify(conditions))}`;
    synthesized.set(key, conditions);
    return key;
  };

  /**
   * Segment references with `and`, `or` and `not`, the schema "2" form for
   * rules. Attribute only parts become segments of their own.
   */
  const toSegments = (value: Conditions, scope: Scope): GroupSegment | GroupSegment[] | "*" => {
    if (value === "*") return "*";
    if (typeof value === "string") return value;
    const found = kinds(value);
    if (found.size === 1 && found.has("attribute")) return synthesize(value as Condition, scope);
    if (Array.isArray(value)) {
      return value.length
        ? value.map((child) => toSegments(child, scope) as GroupSegment)
        : (NEVER as GroupSegment);
    }
    if (isGroup(value)) {
      const list = children(value);
      if (!list.length) return NEVER as GroupSegment;
      const mapped = list.map((child) => toSegments(child, scope) as GroupSegment);
      if ("and" in value) return { and: mapped };
      if ("or" in value) return { or: mapped };
      return { not: mapped };
    }
    const kind = kindOf(value);
    report(
      scope,
      kind === "variable"
        ? `reads ${describeLeaf(value)}, and schema "2" has no variable conditions`
        : `requires ${describeLeaf(value)}, and schema "2" rules and force entries cannot require features`,
    );
    return NEVER as GroupSegment;
  };

  /**
   * Top level `and` parts: feature leaves become a flat `requiredFeatures`
   * list, the rest stays a selector. A feature leaf under `or` or `not` has
   * no flat form.
   */
  const split = (
    value: Conditions | undefined,
  ): { features: FeatureCondition[]; rest: Condition[] } => {
    const features: FeatureCondition[] = [];
    const rest: Condition[] = [];
    const visit = (entry: Conditions) => {
      if (entry === "*") return;
      if (Array.isArray(entry)) return entry.forEach(visit);
      if (typeof entry === "object" && "and" in entry && entry.and.length)
        return entry.and.forEach(visit);
      if (typeof entry === "object" && kindOf(entry) === "feature") {
        features.push(entry as FeatureCondition);
        return;
      }
      rest.push(entry as Condition);
    };
    if (value !== undefined) visit(value);
    return { features, rest };
  };

  const required = (features: FeatureCondition[]): RequiredFeature[] =>
    features.map((leaf) =>
      leaf.enabled === undefined && leaf.variation === undefined
        ? leaf.feature
        : {
            feature: leaf.feature,
            ...(leaf.enabled !== undefined ? { enabled: leaf.enabled } : {}),
            ...(leaf.variation !== undefined ? { variation: leaf.variation } : {}),
          },
    );

  const featureUnderGroup = (rest: Condition[], scope: Scope) => {
    for (const entry of rest) {
      const walk = (node: Conditions) => {
        if (node === "*" || typeof node === "string") return;
        if (Array.isArray(node) || isGroup(node as Condition)) {
          children(node as Condition | Condition[]).forEach(walk);
          return;
        }
        if (kindOf(node as Condition) === "feature") {
          report(
            scope,
            `requires ${describeLeaf(node as Condition)} inside "or" or "not", while schema "2" only has a flat list of required features`,
          );
        }
      };
      walk(entry);
    }
  };

  const withoutFeatures = (rest: Condition[]): Condition[] => {
    const strip = (node: Condition): Condition => {
      if (typeof node === "string" || !isGroup(node))
        return kindOf(node) === "feature" ? NEVER : node;
      const mapped = children(node).map(strip);
      if ("and" in node) return { and: mapped };
      if ("or" in node) return { or: mapped };
      return { not: mapped };
    };
    return rest.map(strip);
  };

  const encode = <T>(value: T): T =>
    (stringify && typeof value !== "string" ? JSON.stringify(value) : value) as T;

  /** A root gate: schema "2" features and global variables only require features. */
  const gate = (value: Conditions | undefined, scope: Scope): RequiredFeature[] | undefined => {
    if (value === undefined) return undefined;
    const { features, rest } = split(parseConditions(value));
    featureUnderGroup(rest, scope);
    for (const entry of rest) {
      const variable = firstLeaf(entry, "variable");
      if (variable)
        report(scope, `reads ${describeLeaf(variable)}, and schema "2" has no variable conditions`);
      const other = firstLeaf(entry, "segment") || firstLeaf(entry, "attribute");
      if (other)
        report(
          scope,
          `compares ${describeLeaf(other)}, while schema "2" root conditions can only require features`,
        );
    }
    return features.length ? required(features) : undefined;
  };

  /**
   * An override selector. Feature variable overrides read `conditions`
   * before `segments`, and global variable overrides need both to match, so
   * only one of them is ever written.
   */
  const selector = (
    value: Conditions | undefined,
    scope: Scope,
    whenEmpty: "always" | "omit",
  ): {
    conditions?: Condition | Condition[] | string;
    segments?: GroupSegment | GroupSegment[] | string;
    requiredFeatures?: RequiredFeature[];
  } => {
    const result: {
      conditions?: Condition | Condition[] | string;
      segments?: GroupSegment | GroupSegment[] | string;
      requiredFeatures?: RequiredFeature[];
    } = {};
    const { features, rest } = split(value === undefined ? undefined : parseConditions(value));
    featureUnderGroup(rest, scope);
    const clean = withoutFeatures(rest);
    if (features.length) result.requiredFeatures = required(features);
    if (!clean.length) {
      if (!features.length && whenEmpty === "always") result.conditions = "*";
      return result;
    }
    const expression: Condition | Condition[] = clean.length === 1 ? clean[0] : clean;
    if (kinds(expression as Conditions).has("segment"))
      result.segments = encode(toSegments(expression as Conditions, scope));
    else result.conditions = encode(toConditions(expression as Conditions, scope));
    return result;
  };

  const schema = (variablesSchema: Record<string, ResolvedVariableSchema>) => {
    const result: Record<string, ResolvedVariableSchema> = {};
    for (const key of Object.keys(variablesSchema)) {
      const entry = variablesSchema[key];
      result[key] = entry.type === "number" ? { ...entry, type: "double" } : entry;
    }
    return result;
  };

  const featureOverrides = (
    overrides: Record<string, VariableOverride[]> | undefined,
    owner: string,
    ownerPath: (string | number)[],
    featureKey: string,
  ) => {
    if (!overrides) return undefined;
    const result: Record<string, VariableOverride[]> = {};
    for (const variableKey of Object.keys(overrides)) {
      result[variableKey] = overrides[variableKey].map((override, index) => {
        const name = override.key ? `"${override.key}"` : String(index + 1);
        return {
          ...without(override, ["conditions", "segments", "requiredFeatures"]),
          ...selector(
            override.conditions,
            {
              entityType: "feature",
              key: featureKey,
              path: [...ownerPath, "variableOverrides", variableKey, index, "conditions"],
              location: `override ${name} of variable "${variableKey}" in ${owner}`,
            },
            "always",
          ),
        } as VariableOverride;
      });
    }
    return result;
  };

  // features
  const features: Record<string, Feature> = {};
  for (const featureKey of Object.keys(datafile.features || {})) {
    const feature = datafile.features[featureKey];
    const converted = without(feature, ["conditions", "requiredFeatures"]);

    const requirements = gate(feature.conditions, {
      entityType: "feature",
      key: featureKey,
      path: ["conditions"],
      location: "the root gate",
    });
    if (requirements) converted.requiredFeatures = requirements;

    converted.traffic = (feature.traffic || []).map((traffic) => {
      const ruleConditions = traffic.conditions;
      const variableOverrides = traffic.variableOverrides;
      const ruleRest = without(traffic, ["conditions", "segments", "variableOverrides"]);
      const scope: Scope = {
        entityType: "feature",
        key: featureKey,
        path: ["rules", traffic.key, "conditions"],
        location: `rule "${traffic.key}"`,
      };
      const result: Traffic = {
        ...ruleRest,
        segments: encode(
          toSegments(ruleConditions === undefined ? "*" : parseConditions(ruleConditions), scope),
        ),
      } as Traffic;
      const overrides = featureOverrides(
        variableOverrides,
        `rule "${traffic.key}"`,
        ["rules", traffic.key],
        featureKey,
      );
      if (overrides) result.variableOverrides = overrides;
      return result;
    });

    if (feature.force) {
      converted.force = feature.force.map((force, index) => {
        const forceConditions = force.conditions;
        const forceRest = without(force, ["conditions", "segments"]);
        const scope: Scope = {
          entityType: "feature",
          key: featureKey,
          path: ["force", index, "conditions"],
          location: `force entry ${index + 1}`,
        };
        const value =
          forceConditions === undefined ? "*" : parseConditions(forceConditions as Conditions);
        if (value !== "*" && kinds(value).has("segment"))
          return { ...forceRest, segments: encode(toSegments(value, scope)) } as Force;
        return { ...forceRest, conditions: encode(toConditions(value, scope)) } as Force;
      });
    }

    if (feature.variations) {
      converted.variations = feature.variations.map((variation) => {
        const overrides = featureOverrides(
          variation.variableOverrides as Record<string, VariableOverride[]> | undefined,
          `variation "${variation.value}"`,
          ["variations", variation.value],
          featureKey,
        );
        return overrides ? { ...variation, variableOverrides: overrides } : variation;
      });
    }

    if (feature.variablesSchema) converted.variablesSchema = schema(feature.variablesSchema);

    features[featureKey] = converted;
  }

  // global variables
  let variables: Record<string, DatafileVariable> | undefined;
  if (datafile.variables) {
    variables = {};
    for (const variableKey of Object.keys(datafile.variables)) {
      const variable = datafile.variables[variableKey] as DatafileVariable & {
        compose?: unknown;
        overrideProgram?: unknown;
      };
      const scope = (path: (string | number)[], location: string): Scope => ({
        entityType: "variable",
        key: variableKey,
        path,
        location,
      });
      if (variable.compose !== undefined) {
        report(
          scope(["compose"], "the variable"),
          `is a composition, which @featurevisor/sdk 3 cannot evaluate`,
        );
        continue;
      }
      if (variable.overrideProgram !== undefined) {
        report(
          scope(["overrides"], "the variable"),
          `needs runtime overrides, from "continue" or "precomputeMutations: false", which @featurevisor/sdk 3 cannot run`,
        );
        continue;
      }
      const { conditions, overrides, type } = variable as DatafileVariable & {
        conditions?: Conditions;
      };
      const converted = {
        ...without(variable, ["conditions", "overrides", "requiredFeatures", "type"]),
        type: type === "number" ? "double" : type,
      } as DatafileVariable;
      const requirements = gate(conditions, scope(["conditions"], "the root gate"));
      if (requirements) converted.requiredFeatures = requirements;
      if (overrides) {
        converted.overrides = overrides.map((override: DatafileVariableOverride, index) => {
          const name = (override.keyPath || [override.key]).join(".");
          return {
            ...without(override, ["conditions", "segments", "requiredFeatures"]),
            ...selector(
              override.conditions,
              scope(["overrides", index, "conditions"], `override "${name}"`),
              "omit",
            ),
          } as DatafileVariableOverride;
        });
      }
      variables[variableKey] = converted;
    }
  }

  // segments, with references to other segments replaced by their conditions
  for (const segmentKey of Object.keys(v4Segments)) {
    const segment = v4Segments[segmentKey];
    segments[segmentKey] = {
      ...segment,
      conditions: encode(
        toConditions(
          parseConditions(segment.conditions),
          { entityType: "segment", key: segmentKey, path: ["conditions"], location: "the segment" },
          new Set([segmentKey]),
        ),
      ),
    };
  }
  for (const [key, conditions] of synthesized) {
    segments[key] = { conditions: encode(conditions) };
  }

  const result: DatafileContent = {
    schemaVersion: SCHEMA_V2,
    revision: datafile.revision,
    ...(datafile.featurevisorVersion ? { featurevisorVersion: datafile.featurevisorVersion } : {}),
    segments,
    features,
    ...(variables ? { variables } : {}),
  };

  return { datafile: result, issues: dedupe(issues) };
}

function dedupe(issues: SchemaV2Issue[]): SchemaV2Issue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const id = JSON.stringify([issue.entityType, issue.key, issue.location, issue.reason]);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Convert, or throw every issue at once. */
export function toSchemaV2(
  datafile: DatafileContent,
  options: SchemaV2Options & { targetKey?: string; environment?: string | false } = {},
): DatafileContent {
  const { datafile: converted, issues } = convertDatafileToSchemaV2(datafile, options);
  if (issues.length)
    throw new SchemaV2ConversionError(issues, options.targetKey, options.environment);
  return converted;
}
