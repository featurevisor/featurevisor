import type {
  DatafileContent,
  DatafileVariable,
  Feature,
  FeatureKey,
  GlobalVariableKey,
  GroupSegment,
  Required,
  RequiredFeature,
  SegmentKey,
} from "@featurevisor/types";

export interface DatafileDependencyIndex {
  segmentFeatures: Record<SegmentKey, FeatureKey[]>;
  featureDependents: Record<FeatureKey, FeatureKey[]>;
  segmentVariables: Record<SegmentKey, GlobalVariableKey[]>;
  featureVariables: Record<FeatureKey, GlobalVariableKey[]>;
}

function addDependent<TValue extends string>(
  map: Record<string, TValue[]>,
  dependency: string,
  dependent: TValue,
) {
  const dependents = map[dependency] || (map[dependency] = []);
  if (dependents.indexOf(dependent) === -1) dependents.push(dependent);
}

function getRequiredFeatureKey(required: Required): FeatureKey {
  return typeof required === "string" ? required : required.key;
}

function getRequiredFeatureKeyV2(required: RequiredFeature): FeatureKey {
  return typeof required === "string" ? required : required.feature;
}

function addSegmentKeys(segments: GroupSegment | GroupSegment[] | string, result: Set<SegmentKey>) {
  if (typeof segments === "string") {
    if (segments === "*") return;

    if (segments[0] === "{" || segments[0] === "[") {
      try {
        addSegmentKeys(JSON.parse(segments), result);
      } catch {
        // Invalid generated datafiles are rejected by project linting. Avoid
        // treating malformed serialized expressions as segment keys here.
      }
      return;
    }

    result.add(segments);
    return;
  }

  if (Array.isArray(segments)) {
    for (const segment of segments) addSegmentKeys(segment, result);
    return;
  }

  if (segments && typeof segments === "object") {
    if ("and" in segments) addSegmentKeys(segments.and, result);
    if ("or" in segments) addSegmentKeys(segments.or, result);
    if ("not" in segments) addSegmentKeys(segments.not, result);
  }
}

function getFeatureSegmentKeys(feature: Feature): Set<SegmentKey> {
  const result = new Set<SegmentKey>();

  for (const traffic of feature.traffic) {
    addSegmentKeys(traffic.segments, result);

    const trafficVariableOverrides = traffic.variableOverrides || {};
    for (const variableKey of Object.keys(trafficVariableOverrides)) {
      const overrides = trafficVariableOverrides[variableKey];
      for (const override of overrides) {
        if (override.segments) addSegmentKeys(override.segments, result);
      }
    }
  }

  for (const force of feature.force || []) {
    if (force.segments) addSegmentKeys(force.segments, result);
  }

  for (const variation of feature.variations || []) {
    const variationVariableOverrides = variation.variableOverrides || {};
    for (const variableKey of Object.keys(variationVariableOverrides)) {
      const overrides = variationVariableOverrides[variableKey];
      for (const override of overrides) {
        if (override.segments) addSegmentKeys(override.segments, result);
      }
    }
  }

  return result;
}

function indexFeature(index: DatafileDependencyIndex, featureKey: FeatureKey, feature: Feature) {
  for (const segmentKey of getFeatureSegmentKeys(feature)) {
    addDependent(index.segmentFeatures, segmentKey, featureKey);
  }

  if (feature.requiredFeatures) {
    for (const required of feature.requiredFeatures) {
      addDependent(index.featureDependents, getRequiredFeatureKeyV2(required), featureKey);
    }
  } else {
    for (const required of feature.required || []) {
      addDependent(index.featureDependents, getRequiredFeatureKey(required), featureKey);
    }
  }

  for (const traffic of feature.traffic) {
    const variableOverrides = traffic.variableOverrides || {};
    for (const variableKey of Object.keys(variableOverrides)) {
      const overrides = variableOverrides[variableKey];
      for (const override of overrides) {
        const requirements = override.requiredFeatures;
        if (!requirements) continue;
        for (const required of Array.isArray(requirements) ? requirements : [requirements]) {
          addDependent(index.featureDependents, getRequiredFeatureKeyV2(required), featureKey);
        }
      }
    }
  }

  for (const variation of feature.variations || []) {
    const variableOverrides = variation.variableOverrides || {};
    for (const variableKey of Object.keys(variableOverrides)) {
      const overrides = variableOverrides[variableKey];
      for (const override of overrides) {
        const requirements = override.requiredFeatures;
        if (!requirements) continue;
        for (const required of Array.isArray(requirements) ? requirements : [requirements]) {
          addDependent(index.featureDependents, getRequiredFeatureKeyV2(required), featureKey);
        }
      }
    }
  }
}

function indexVariable(
  index: DatafileDependencyIndex,
  variableKey: GlobalVariableKey,
  variable: DatafileVariable,
) {
  for (const required of variable.requiredFeatures || []) {
    addDependent(index.featureVariables, getRequiredFeatureKeyV2(required), variableKey);
  }

  for (const override of variable.overrides || []) {
    if (override.segments) {
      const segmentKeys = new Set<SegmentKey>();
      addSegmentKeys(override.segments, segmentKeys);
      for (const segmentKey of segmentKeys) {
        addDependent(index.segmentVariables, segmentKey, variableKey);
      }
    }

    for (const required of override.requiredFeatures || []) {
      addDependent(index.featureVariables, getRequiredFeatureKeyV2(required), variableKey);
    }
  }
}

export function createDatafileDependencyIndex(datafile: DatafileContent): DatafileDependencyIndex {
  const index: DatafileDependencyIndex = {
    segmentFeatures: {},
    featureDependents: {},
    segmentVariables: {},
    featureVariables: {},
  };

  for (const featureKey of Object.keys(datafile.features)) {
    indexFeature(index, featureKey, datafile.features[featureKey]);
  }

  for (const variableKey of Object.keys(datafile.variables || {})) {
    indexVariable(index, variableKey, datafile.variables![variableKey]);
  }

  return index;
}

export function addDatafileDependencyChanges(
  features: FeatureKey[],
  variables: GlobalVariableKey[],
  changedSegments: SegmentKey[],
  index: DatafileDependencyIndex,
) {
  const affectedFeatures = new Set(features);
  const affectedVariables = new Set(variables);
  const featureQueue = [...features];

  const addFeature = (featureKey: FeatureKey) => {
    if (affectedFeatures.has(featureKey)) return;
    affectedFeatures.add(featureKey);
    featureQueue.push(featureKey);
  };

  for (const segmentKey of changedSegments) {
    for (const featureKey of index.segmentFeatures[segmentKey] || []) addFeature(featureKey);
    for (const variableKey of index.segmentVariables[segmentKey] || []) {
      affectedVariables.add(variableKey);
    }
  }

  for (let cursor = 0; cursor < featureQueue.length; cursor++) {
    const featureKey = featureQueue[cursor];
    for (const dependent of index.featureDependents[featureKey] || []) addFeature(dependent);
    for (const variableKey of index.featureVariables[featureKey] || []) {
      affectedVariables.add(variableKey);
    }
  }

  features.splice(0, features.length, ...affectedFeatures);
  variables.splice(0, variables.length, ...affectedVariables);
}
