import type {
  Conditions,
  DatafileContent,
  FeatureKey,
  SegmentKey,
  VariableKey,
} from "@featurevisor/types";

export interface DatafileDependencyIndex {
  segmentFeatures: Record<SegmentKey, FeatureKey[]>;
  featureDependents: Record<FeatureKey, FeatureKey[]>;
  segmentVariables: Record<SegmentKey, VariableKey[]>;
  featureVariables: Record<FeatureKey, VariableKey[]>;
  variableFeatures: Record<VariableKey, FeatureKey[]>;
  variableVariables: Record<VariableKey, VariableKey[]>;
  segmentSegments: Record<SegmentKey, SegmentKey[]>;
  featureSegments: Record<FeatureKey, SegmentKey[]>;
  variableSegments: Record<VariableKey, SegmentKey[]>;
}

function lookup(): Record<string, string[]> {
  return Object.create(null);
}

function add(map: Record<string, string[]>, dependency: string, dependent: string) {
  const values = map[dependency] || (map[dependency] = []);
  // An entity is visited uninterrupted. Only the last dependent can be repeated.
  if (values[values.length - 1] !== dependent) values.push(dependent);
}

function visit(
  conditions: Conditions | undefined,
  dependent: string,
  segmentMap: Record<string, string[]>,
  featureMap: Record<string, string[]>,
  variableMap: Record<string, string[]>,
) {
  if (!conditions || conditions === "*") return;
  if (typeof conditions === "string") {
    if (/^\s*[{[\"]/.test(conditions)) {
      try {
        visit(JSON.parse(conditions), dependent, segmentMap, featureMap, variableMap);
      } catch {
        // The owning getter reports malformed selectors on first read.
      }
      return;
    }
    add(segmentMap, conditions, dependent);
    return;
  }
  if (typeof conditions !== "object") return;
  if ("variable" in conditions) {
    add(
      conditions.feature === undefined ? variableMap : featureMap,
      conditions.feature === undefined ? conditions.variable : conditions.feature,
      dependent,
    );
  } else if ("feature" in conditions) add(featureMap, conditions.feature, dependent);
  else if (!("attribute" in conditions)) {
    const children = Array.isArray(conditions)
      ? conditions
      : "and" in conditions
        ? conditions.and
        : "or" in conditions
          ? conditions.or
          : conditions.not;
    if (Array.isArray(children))
      for (const child of children) visit(child, dependent, segmentMap, featureMap, variableMap);
  }
}

/** Stored v3 definitions are already converted; v4 conditions may still be stringified. */
export function createDatafileDependencyIndex(datafile: DatafileContent): DatafileDependencyIndex {
  const index: DatafileDependencyIndex = {
    segmentFeatures: lookup(),
    featureDependents: lookup(),
    segmentVariables: lookup(),
    featureVariables: lookup(),
    variableFeatures: lookup(),
    variableVariables: lookup(),
    segmentSegments: lookup(),
    featureSegments: lookup(),
    variableSegments: lookup(),
  };
  for (const key of Object.keys(datafile.segments))
    visit(
      datafile.segments[key].conditions,
      key,
      index.segmentSegments,
      index.featureSegments,
      index.variableSegments,
    );
  for (const key of Object.keys(datafile.features)) {
    const feature = datafile.features[key];
    const conditions = (entry: { conditions?: Conditions }) => {
      visit(
        entry.conditions,
        key,
        index.segmentFeatures,
        index.featureDependents,
        index.variableFeatures,
      );
    };
    conditions(feature);
    for (const force of feature.force || []) conditions(force);
    for (const entry of [...(feature.traffic || []), ...(feature.variations || [])]) {
      if ("conditions" in entry) conditions(entry);
      for (const variable of Object.keys(entry.variableOverrides || {}))
        for (const override of entry.variableOverrides![variable]) conditions(override);
    }
  }
  for (const key of Object.keys(datafile.variables || {})) {
    const variable = datafile.variables![key];
    visit(
      variable.conditions,
      key,
      index.segmentVariables,
      index.featureVariables,
      index.variableVariables,
    );
    if (typeof variable.compose === "string") add(index.variableVariables, variable.compose, key);
    else
      for (const entry of variable.compose || [])
        add(
          entry.feature === undefined ? index.variableVariables : index.featureVariables,
          entry.feature === undefined ? entry.variable! : entry.feature,
          key,
        );
    for (const override of variable.overrideProgram || variable.overrides || []) {
      visit(
        override.conditions,
        key,
        index.segmentVariables,
        index.featureVariables,
        index.variableVariables,
      );
    }
  }
  return index;
}

export function addDatafileDependencyChanges(
  features: FeatureKey[],
  variables: VariableKey[],
  changedSegments: SegmentKey[],
  index: DatafileDependencyIndex,
) {
  const affected = [new Set(features), new Set(variables), new Set(changedSegments)];
  const queues = [[...features], [...variables], [...changedSegments]];
  const cursors = [0, 0, 0];
  const maps = [
    [index.featureDependents, index.featureVariables, index.featureSegments],
    [index.variableFeatures, index.variableVariables, index.variableSegments],
    [index.segmentFeatures, index.segmentVariables, index.segmentSegments],
  ];
  // A changed segment can reveal feature and variable changes and vice versa.
  for (;;) {
    let advanced = false;
    for (let source = 0; source < 3; source++) {
      if (cursors[source] >= queues[source].length) continue;
      advanced = true;
      const key = queues[source][cursors[source]++];
      for (let target = 0; target < 3; target++)
        for (const dependent of maps[source][target][key] || []) {
          if (affected[target].has(dependent)) continue;
          affected[target].add(dependent);
          queues[target].push(dependent);
        }
    }
    if (!advanced) break;
  }
  features.splice(0, features.length, ...affected[0]);
  variables.splice(0, variables.length, ...affected[1]);
}
