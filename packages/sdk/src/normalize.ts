import type {
  Condition,
  Conditions,
  DatafileContent,
  DatafileVariable,
  Feature,
  Segment,
  FeatureCondition,
  RequiredFeature,
  RequiredFeatures,
} from "@featurevisor/types";
import type { FeaturevisorDiagnostic, FeaturevisorDiagnosticHandler } from "./diagnostics.js";

export const invalidConditions: Conditions = { or: [] };
export const entityKinds = ["features", "segments", "variables"] as const;
export type DatafileEntity = Feature | Segment | DatafileVariable;

type Selectable = {
  conditions?: Conditions;
  segments?: Conditions;
  requiredFeatures?: RequiredFeatures;
};

/** Convert released v3 feature prerequisite leaves without changing caller objects. */
function legacyFeatures(value: RequiredFeature): Condition {
  if (typeof value === "string") return { feature: value };
  if ("feature" in value) return value as FeatureCondition;
  if ("and" in value) return value.and.length ? { and: value.and.map(legacyFeatures) } : "*";
  if ("or" in value) return { or: value.or.map(legacyFeatures) };
  return { not: value.not.map(legacyFeatures) };
}

function selectors<T extends Selectable>(
  value: T,
  legacyConditions: boolean,
  parse: (value: Conditions) => Conditions,
): T {
  const parts: Conditions[] = [];
  if (value.conditions !== undefined) {
    const conditions = parse(value.conditions);
    parts.push(legacyConditions ? legacySegments(conditions) : conditions);
  }
  if (value.segments !== undefined) parts.push(legacySegments(parse(value.segments)));
  if (value.requiredFeatures !== undefined) {
    const features = Array.isArray(value.requiredFeatures)
      ? value.requiredFeatures
      : [value.requiredFeatures];
    if (features.length) parts.push(features.map(legacyFeatures));
  }
  if (!parts.length && value.requiredFeatures === undefined) return value;
  const result = { ...value };
  delete result.segments;
  delete result.requiredFeatures;
  if (parts.indexOf(invalidConditions) !== -1) result.conditions = invalidConditions;
  else if (parts.length === 1) result.conditions = parts[0];
  else if (parts.length) {
    const combined: Condition[] = [];
    for (const part of parts)
      combined.push(...(Array.isArray(part) ? (part.length ? part : [{ and: [] }]) : [part]));
    result.conditions = combined;
  }
  return result;
}

// v3 considered empty condition and segment ANDs true. Preserve that when loaded,
// while empty v4 expressions are defensively false in the single evaluator.
function legacySegments(value: Condition): Condition;
function legacySegments(value: Conditions): Conditions;
function legacySegments(value: Conditions): Conditions {
  if (value === invalidConditions) return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length ? value.map((entry) => legacySegments(entry)) : "*";
  if ("and" in value)
    return value.and.length ? { and: value.and.map((entry) => legacySegments(entry)) } : "*";
  if ("or" in value) return { or: value.or.map((entry) => legacySegments(entry)) };
  if ("not" in value) return { not: value.not.map((entry) => legacySegments(entry)) };
  return value;
}

/** Normalize one definition. Diagnostics are returned so callers can cache before reporting. */
export function normalizeEntity(
  kind: number,
  key: string,
  value: DatafileEntity,
  legacy = false,
): { value: DatafileEntity; errors?: FeaturevisorDiagnostic[] } {
  let errors: FeaturevisorDiagnostic[] | undefined;
  const parse = (conditions: Conditions): Conditions => {
    if (typeof conditions !== "string" || !/^\s*[{[\"]/.test(conditions)) return conditions;
    try {
      return JSON.parse(conditions);
    } catch (originalError) {
      (errors || (errors = [])).push({
        level: "error",
        code: "conditions_parse_error",
        message: "Error parsing conditions",
        originalError,
        details: {
          conditions,
          entityType: ["feature", "segment", "variable"][kind],
          entityKey: key,
        },
      });
      return invalidConditions;
    }
  };
  const select = <T extends Selectable>(entry: T, old = false): T => selectors(entry, old, parse);
  const withOverrides = <T extends { variableOverrides?: Record<string, Selectable[]> }>(
    entry: T,
  ): T => {
    if (!entry.variableOverrides) return entry;
    const variableOverrides: Record<string, Selectable[]> = Object.create(null);
    for (const variable of Object.keys(entry.variableOverrides))
      variableOverrides[variable] = entry.variableOverrides[variable].map((override) =>
        select(override, legacy),
      );
    return { ...entry, variableOverrides };
  };
  let result: DatafileEntity;
  if (kind === 0) {
    const feature = value as Feature;
    result = {
      ...select(feature),
      traffic: (feature.traffic || []).map((traffic) => withOverrides(select(traffic))),
      ...(feature.force ? { force: feature.force.map((force) => select(force, legacy)) } : {}),
      ...(feature.variations
        ? {
            variations: feature.variations.map((variation) => withOverrides(variation)),
          }
        : {}),
    };
  } else if (kind === 1) {
    const segment = value as Segment;
    const conditions = parse(segment.conditions);
    result = { ...segment, conditions: legacy ? legacySegments(conditions) : conditions };
  } else {
    const variable = value as DatafileVariable;
    const overrides = <T extends Selectable>(entries: T[], old: boolean) =>
      entries.map((entry) => select(entry, old));
    result = {
      ...select(variable),
      ...(variable.overrides ? { overrides: overrides(variable.overrides, legacy) } : {}),
      ...(variable.overrideProgram
        ? { overrideProgram: overrides(variable.overrideProgram, false) }
        : {}),
    } as DatafileVariable;
  }
  return { value: result, errors };
}

/** Convert all v3 definitions before storage, retaining the original version metadata. */
export function normalizeDatafile(
  datafile: DatafileContent,
  reportDiagnostic?: FeaturevisorDiagnosticHandler,
): DatafileContent {
  const result = { ...datafile };
  for (let kind = 0; kind < 3; kind++) {
    const name = entityKinds[kind];
    if (!datafile[name]) continue;
    const definitions: Record<string, DatafileEntity> = Object.create(null);
    for (const key of Object.keys(datafile[name]!)) {
      const normalized = normalizeEntity(
        kind,
        key,
        datafile[name]![key],
        datafile.schemaVersion === "2",
      );
      definitions[key] = normalized.value;
      for (const diagnostic of normalized.errors || []) reportDiagnostic?.(diagnostic);
    }
    Object.assign(result, { [name]: definitions });
  }
  return result;
}
