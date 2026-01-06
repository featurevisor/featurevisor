import { DatafileContent, Context, Traffic } from "@featurevisor/types";
import { DatafileReader, createLogger } from "@featurevisor/sdk";

import { buildScopedConditions } from "./buildScopedConditions";
import { buildScopedSegments } from "./buildScopedSegments";

export function buildScopedDatafile(
  originalDatafileContent: DatafileContent,
  context: Context,
): DatafileContent {
  const originalDatafileReader = new DatafileReader({
    datafile: originalDatafileContent,
    logger: createLogger({ level: "fatal" }),
  });

  const scopedDatafileContent: DatafileContent = JSON.parse(
    JSON.stringify(originalDatafileContent),
  );

  const removeSegments: string[] = [];

  // segments
  for (const segmentKey in scopedDatafileContent.segments) {
    const segment = scopedDatafileContent.segments[segmentKey];
    const originalConditions = segment.conditions;
    const scopedConditions = buildScopedConditions(
      originalDatafileReader,
      originalConditions,
      context,
    );
    scopedDatafileContent.segments[segmentKey].conditions = scopedConditions;

    if (scopedConditions === "*") {
      removeSegments.push(segmentKey);
    }
  }

  // features
  for (const featureKey in scopedDatafileContent.features) {
    const feature = scopedDatafileContent.features[featureKey];

    // force
    if (feature.force) {
      for (let forceI = 0; forceI < feature.force.length; forceI++) {
        const force = feature.force[forceI];

        // segments
        if (force.segments) {
          feature.force[forceI].segments = buildScopedSegments(
            originalDatafileReader,
            force.segments,
            context,
            removeSegments,
          );
        }

        // conditions
        if (force.conditions) {
          feature.force[forceI].conditions = buildScopedConditions(
            originalDatafileReader,
            force.conditions,
            context,
          );
        }
      }
    }

    // traffic
    const originalTrafficSegments: (string | string[] | object | undefined)[] = [];
    if (feature.traffic) {
      for (let trafficI = 0; trafficI < feature.traffic.length; trafficI++) {
        const traffic = feature.traffic[trafficI];

        // Store original segments before scoping
        originalTrafficSegments[trafficI] = traffic.segments;

        // segments
        if (traffic.segments) {
          feature.traffic[trafficI].segments = buildScopedSegments(
            originalDatafileReader,
            traffic.segments,
            context,
            removeSegments,
          );
        }
      }
    }

    // variation
    if (feature.variations) {
      const variations = feature.variations;

      for (let variationI = 0; variationI < variations.length; variationI++) {
        const variation = variations[variationI];

        // variable overrides
        if (variation.variableOverrides) {
          for (const variableKey in variation.variableOverrides) {
            const variableOverrides = variation.variableOverrides[variableKey];

            for (
              let variableOverrideI = 0;
              variableOverrideI < variableOverrides.length;
              variableOverrideI++
            ) {
              const variableOverride = variableOverrides[variableOverrideI];

              // segments
              if (variableOverride.segments) {
                variableOverride.segments = buildScopedSegments(
                  originalDatafileReader,
                  variableOverride.segments,
                  context,
                  removeSegments,
                );
              }

              // conditions
              if (variableOverride.conditions) {
                variableOverride.conditions = buildScopedConditions(
                  originalDatafileReader,
                  variableOverride.conditions,
                  context,
                );
              }

              variableOverrides[variableOverrideI] = variableOverride;
            }
          }
        }

        feature.variations[variationI] = variation;
      }
    }

    // feature traffic consecutive segments with `*` removal
    if (feature.traffic) {
      const newTrafficArray: Traffic[] = [];

      let lastTraffic: Traffic | undefined;
      let lastOriginalSegments: string | string[] | object | undefined;
      let consecutiveOriginalStarCount = 0;

      for (let i = 0; i < feature.traffic.length; i++) {
        const traffic = feature.traffic[i];
        const originalSegments = originalTrafficSegments[i];
        let shouldAdd = true;

        if (lastTraffic && lastTraffic.segments === "*" && traffic.segments === "*") {
          // Check if we should merge based on original segments
          const lastWasOriginalStar = lastOriginalSegments === "*";
          const currentIsOriginalStar = originalSegments === "*";

          if (lastWasOriginalStar && currentIsOriginalStar) {
            // Both were "*" from the beginning - always merge
            shouldAdd = false;
            consecutiveOriginalStarCount++;
          } else if (!lastWasOriginalStar && !currentIsOriginalStar) {
            // Both became "*" - merge them
            shouldAdd = false;
          } else if (lastWasOriginalStar && !currentIsOriginalStar) {
            // Last was "*", current became "*"
            // If we have 2+ consecutive original "*" entries, keep the one that became "*" separate
            if (consecutiveOriginalStarCount >= 2) {
              // Keep this entry (it became "*" after scoping, and we had 2+ original "*" before)
              shouldAdd = true;
              consecutiveOriginalStarCount = 0;
            } else {
              // Merge them
              shouldAdd = false;
            }
          } else {
            // Last became "*", current was "*" - merge them
            shouldAdd = false;
            consecutiveOriginalStarCount = 1;
          }
        } else {
          // Reset counter on break
          consecutiveOriginalStarCount = 0;
        }

        if (shouldAdd) {
          newTrafficArray.push(traffic);
          lastTraffic = traffic;
          lastOriginalSegments = originalSegments;
          if (originalSegments === "*") {
            consecutiveOriginalStarCount = 1;
          } else {
            consecutiveOriginalStarCount = 0;
          }
        }
      }

      feature.traffic = newTrafficArray;
    }

    scopedDatafileContent.features[featureKey] = feature;
  }

  // remove segments
  for (const removeSegment of removeSegments) {
    delete scopedDatafileContent.segments[removeSegment];
  }

  return scopedDatafileContent;
}
