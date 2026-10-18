import type {
  Conditions,
  AttributeKey,
  GroupSegment,
  SegmentKey,
  Feature,
} from "@featurevisor/types";
import { getConditionReferences } from "../datasource/conditions";

/** Includes gates, force entries, rules and both kinds of variable overrides. */
export function extractSegmentsFromFeature(feature: Feature): Set<SegmentKey> {
  const result = getConditionReferences(feature.conditions).segments;
  const collect = (value: Conditions | undefined) =>
    getConditionReferences(value).segments.forEach((key) => result.add(key));
  const overrides = (
    entries: Record<string, import("@featurevisor/types").VariableOverride[]> | undefined,
  ) => {
    for (const group of Object.values(entries || {}))
      for (const entry of group) {
        collect(entry.conditions);
        collect(entry.segments);
      }
  };
  for (const entry of feature.traffic || []) {
    collect(entry.conditions);
    collect(entry.segments);
    overrides(entry.variableOverrides);
  }
  for (const entry of feature.force || []) {
    collect(entry.conditions);
    collect(entry.segments);
  }
  for (const entry of feature.variations || []) overrides(entry.variableOverrides);
  return result;
}

/** Transitional name, also understands mixed conditions and stringified datafiles. */
export function extractSegmentKeysFromGroupSegments(
  segments: GroupSegment | GroupSegment[] | Conditions | undefined,
): Set<SegmentKey> {
  return getConditionReferences(segments).segments;
}
export function extractAttributeKeysFromConditions(
  conditions: Conditions | undefined,
): Set<AttributeKey> {
  return getConditionReferences(conditions).attributes;
}
export function extractFeatureKeysFromConditions(conditions: Conditions | undefined): Set<string> {
  return getConditionReferences(conditions).features;
}
export function extractVariableKeysFromConditions(conditions: Conditions | undefined): Set<string> {
  return getConditionReferences(conditions).variables;
}
