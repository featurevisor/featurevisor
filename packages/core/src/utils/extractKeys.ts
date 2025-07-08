import type {
  Condition,
  AttributeKey,
  GroupSegment,
  SegmentKey,
  Feature,
} from "@featurevisor/types";

export function extractSegmentsFromFeature(feature: Feature): Set<SegmentKey> {
  const result = new Set<SegmentKey>();

  // rules
  for (const traffic of feature.traffic) {
    if (traffic.segments) {
      extractSegmentKeysFromGroupSegments(traffic.segments).forEach((segmentKey) => {
        result.add(segmentKey);
      });
    }
  }

  // force
  if (feature.force) {
    for (const f of feature.force) {
      if (f.segments) {
        extractSegmentKeysFromGroupSegments(f.segments).forEach((segmentKey) => {
          result.add(segmentKey);
        });
      }
    }
  }

  // variable overrides from inside variations
  if (feature.variations) {
    for (const variation of feature.variations) {
      if (variation.variableOverrides) {
        for (const variableKey in variation.variableOverrides) {
          const overrides = variation.variableOverrides[variableKey];

          if (overrides) {
            for (const override of overrides) {
              if (override.segments) {
                extractSegmentKeysFromGroupSegments(override.segments).forEach((segmentKey) => {
                  result.add(segmentKey);
                });
              }
            }
          }
        }
      }
    }
  }

  return result;
}

export function extractSegmentKeysFromGroupSegments(
  segments: GroupSegment | GroupSegment[],
): Set<SegmentKey> {
  const result = new Set<SegmentKey>();

  if (Array.isArray(segments)) {
    segments.forEach((segment) => {
      extractSegmentKeysFromGroupSegments(segment).forEach((segmentKey) => {
        result.add(segmentKey);
      });
    });
  }

  if (typeof segments === "object") {
    if ("and" in segments) {
      extractSegmentKeysFromGroupSegments(segments.and).forEach((segmentKey) => {
        result.add(segmentKey);
      });
    }

    if ("or" in segments) {
      extractSegmentKeysFromGroupSegments(segments.or).forEach((segmentKey) => {
        result.add(segmentKey);
      });
    }

    if ("not" in segments) {
      extractSegmentKeysFromGroupSegments(segments.not).forEach((segmentKey) => {
        result.add(segmentKey);
      });
    }
  }

  if (typeof segments === "string") {
    result.add(segments);
  }

  return result;
}

export function extractAttributeKeysFromConditions(
  conditions: Condition | Condition[],
): Set<AttributeKey> {
  const result = new Set<AttributeKey>();

  if (Array.isArray(conditions)) {
    conditions.forEach((condition) => {
      extractAttributeKeysFromConditions(condition).forEach((attributeKey) => {
        result.add(attributeKey);
      });
    });
  }

  if (typeof conditions === "string") {
    return result;
  }

  if ("attribute" in conditions) {
    result.add(conditions.attribute);
  }

  if ("and" in conditions) {
    extractAttributeKeysFromConditions(conditions.and).forEach((attributeKey) => {
      result.add(attributeKey);
    });
  }

  if ("or" in conditions) {
    extractAttributeKeysFromConditions(conditions.or).forEach((attributeKey) => {
      result.add(attributeKey);
    });
  }

  if ("not" in conditions) {
    extractAttributeKeysFromConditions(conditions.not).forEach((attributeKey) => {
      result.add(attributeKey);
    });
  }

  return result;
}
