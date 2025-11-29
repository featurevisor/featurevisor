import {
  DatafileContent,
  Context,
  Feature,
  Variation,
  VariableOverride,
  Traffic,
  Force,
  SegmentKey,
  GroupSegment,
} from "@featurevisor/types";

import { DatafileReader, createLogger } from "@featurevisor/sdk";

export function buildScopedDatafile(
  originalDatafileContent: DatafileContent,
  context: Context,
): DatafileContent {
  const scopedDatafileContent: DatafileContent = {
    schemaVersion: originalDatafileContent.schemaVersion,
    revision: originalDatafileContent.revision,
    segments: {},
    features: {},
  };

  // Create a DatafileReader instance to reuse SDK's evaluation logic
  const logger = createLogger({ level: "fatal" }); // Silent logger for scoping
  const datafileReader = new DatafileReader({
    datafile: originalDatafileContent,
    logger,
  });

  // Track which segments are actually used
  const usedSegmentKeys = new Set<SegmentKey>();

  // Process features
  for (const [featureKey, feature] of Object.entries(originalDatafileContent.features)) {
    const scopedFeature: Feature = {
      ...feature,
      traffic: [],
      force: feature.force ? [] : undefined,
    };

    // Filter traffic rules - only keep those that match the context
    if (feature.traffic) {
      for (const traffic of feature.traffic) {
        // Handle "*" case explicitly, then parse segments if stringified using SDK's method
        let segmentsToCheck: GroupSegment | GroupSegment[] | "*";
        if (traffic.segments === "*") {
          segmentsToCheck = "*";
        } else {
          segmentsToCheck = datafileReader.parseSegmentsIfStringified(
            traffic.segments as GroupSegment | GroupSegment[],
          );
        }

        // Check if segments match the context using SDK's method
        const matches = datafileReader.allSegmentsAreMatched(segmentsToCheck, context);

        if (matches) {
          // Add to scoped feature with segments simplified to "*"
          scopedFeature.traffic.push({
            ...traffic,
            segments: "*",
          });

          // Track used segments (extract segment keys from the original segments)
          if (typeof segmentsToCheck === "string" && segmentsToCheck !== "*") {
            usedSegmentKeys.add(segmentsToCheck as SegmentKey);
          } else if (Array.isArray(segmentsToCheck)) {
            segmentsToCheck.forEach((seg) => {
              if (typeof seg === "string") {
                usedSegmentKeys.add(seg);
              }
            });
          } else if (typeof segmentsToCheck === "object" && segmentsToCheck !== null) {
            // Handle and/or/not group segments
            const extractSegmentKeys = (gs: GroupSegment): SegmentKey[] => {
              if (typeof gs === "string") {
                return [gs];
              }
              if (typeof gs === "object") {
                if ("and" in gs || "or" in gs) {
                  const arr = ("and" in gs ? gs.and : gs.or) as GroupSegment[];
                  return arr.flatMap(extractSegmentKeys);
                }
                if ("not" in gs) {
                  return gs.not.flatMap(extractSegmentKeys);
                }
              }
              return [];
            };
            extractSegmentKeys(segmentsToCheck).forEach((key) => usedSegmentKeys.add(key));
          }
        }
      }
    }

    // Filter force rules - only keep those that match the context
    if (feature.force) {
      for (const force of feature.force) {
        let matches = false;

        if (force.conditions) {
          // Parse conditions if stringified using SDK's method
          const conditionsToCheck = datafileReader.parseConditionsIfStringified(force.conditions);

          // Check if conditions match the context using SDK's method
          matches = datafileReader.allConditionsAreMatched(conditionsToCheck, context);
        }

        if (force.segments) {
          // Handle "*" case explicitly, then parse segments if stringified using SDK's method
          let segmentsToCheck: GroupSegment | GroupSegment[] | "*";
          if (force.segments === "*") {
            segmentsToCheck = "*";
          } else {
            segmentsToCheck = datafileReader.parseSegmentsIfStringified(
              force.segments as GroupSegment | GroupSegment[],
            );
          }

          // Check if segments match the context using SDK's method
          const segmentsMatch = datafileReader.allSegmentsAreMatched(
            segmentsToCheck,
            context,
          );

          // If conditions were checked, use OR logic; otherwise use segments result
          matches = matches || segmentsMatch;

          // Track used segments
          if (typeof segmentsToCheck === "string" && segmentsToCheck !== "*") {
            usedSegmentKeys.add(segmentsToCheck as SegmentKey);
          }
        }

        if (matches) {
          const scopedForce: Force = { ...force };

          // Simplify segments to "*" if they match
          if (scopedForce.segments) {
            scopedForce.segments = "*";
          }

          // Simplify conditions to "*" if they match (though conditions are less common in force)
          if (scopedForce.conditions && typeof scopedForce.conditions !== "string") {
            scopedForce.conditions = "*";
          }

          scopedFeature.force!.push(scopedForce);
        }
      }

      if (scopedFeature.force!.length === 0) {
        scopedFeature.force = undefined;
      }
    }

    // Filter variable overrides in variations
    if (feature.variations) {
      scopedFeature.variations = feature.variations.map((variation) => {
        const scopedVariation: Variation = { ...variation };

        if (variation.variableOverrides) {
          scopedVariation.variableOverrides = {};

          for (const [variableKey, overrides] of Object.entries(variation.variableOverrides)) {
            const scopedOverrides: VariableOverride[] = [];

            for (const override of overrides) {
              let matches = false;

              if (override.conditions) {
                // Parse conditions if stringified using SDK's method
                const conditionsToCheck = datafileReader.parseConditionsIfStringified(
                  override.conditions,
                );

                // Check if conditions match the context using SDK's method
                matches = datafileReader.allConditionsAreMatched(conditionsToCheck, context);
              }

              if (override.segments) {
                // Handle "*" case explicitly, then parse segments if stringified using SDK's method
                let segmentsToCheck: GroupSegment | GroupSegment[] | "*";
                if (override.segments === "*") {
                  segmentsToCheck = "*";
                } else {
                  segmentsToCheck = datafileReader.parseSegmentsIfStringified(
                    override.segments as GroupSegment | GroupSegment[],
                  );
                }

                // Check if segments match the context using SDK's method
                const segmentsMatch = datafileReader.allSegmentsAreMatched(
                  segmentsToCheck,
                  context,
                );

                // If conditions were checked, use OR logic; otherwise use segments result
                matches = matches || segmentsMatch;

                // Track used segments
                if (typeof segmentsToCheck === "string" && segmentsToCheck !== "*") {
                  usedSegmentKeys.add(segmentsToCheck as SegmentKey);
                }
              }

              if (matches) {
                const scopedOverride: VariableOverride = { ...override };

                // Simplify segments to "*" if they match
                if (scopedOverride.segments) {
                  scopedOverride.segments = "*";
                }

                // Simplify conditions to "*" if they match
                if (scopedOverride.conditions && typeof scopedOverride.conditions !== "string") {
                  scopedOverride.conditions = "*";
                }

                scopedOverrides.push(scopedOverride);
              }
            }

            if (scopedOverrides.length > 0) {
              scopedVariation.variableOverrides[variableKey] = scopedOverrides;
            }
          }

          // Remove variableOverrides if empty
          if (Object.keys(scopedVariation.variableOverrides).length === 0) {
            delete scopedVariation.variableOverrides;
          }
        }

        return scopedVariation;
      });
    }

    // Only add feature if it has traffic rules or force rules
    if (
      scopedFeature.traffic.length > 0 ||
      (scopedFeature.force && scopedFeature.force.length > 0)
    ) {
      scopedDatafileContent.features[featureKey] = scopedFeature;
    }
  }

  // Only include segments that are actually used
  // Since we're simplifying matching segments to "*", we don't need to include any segments
  // in the scoped datafile (they're all replaced with "*")
  // For v1 format, return empty array; for v2 format, return empty object
  if (originalDatafileContent.schemaVersion === "1") {
    // For v1 format, segments should be an array
    (scopedDatafileContent as any).segments = [];
  } else {
    scopedDatafileContent.segments = {};
  }

  return scopedDatafileContent;
}

