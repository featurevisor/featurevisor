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

      let lastAddedTraffic: Traffic | undefined;

      for (let i = 0; i < feature.traffic.length; i++) {
        let shouldAdd = true;
        const currentTraffic = feature.traffic[i];

        if (!lastAddedTraffic) {
          shouldAdd = true;
        } else {
          if (lastAddedTraffic.segments === "*" && currentTraffic.segments === "*") {
            shouldAdd = false;
          } else {
            shouldAdd = true;
          }
        }

        if (shouldAdd) {
          newTrafficArray.push(currentTraffic);

          lastAddedTraffic = currentTraffic;
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
