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

  // segments
  for (const segmentKey in scopedDatafileContent.segments) {
    const segment = scopedDatafileContent.segments[segmentKey];
    scopedDatafileContent.segments[segmentKey].conditions = buildScopedConditions(
      originalDatafileReader,
      segment.conditions,
      context,
    );
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
    if (feature.traffic) {
      for (let trafficI = 0; trafficI < feature.traffic.length; trafficI++) {
        const traffic = feature.traffic[trafficI];

        // segments
        if (traffic.segments) {
          feature.traffic[trafficI].segments = buildScopedSegments(
            originalDatafileReader,
            traffic.segments,
            context,
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
                variableOverrides[variableKey][variableOverrideI].segments = buildScopedSegments(
                  originalDatafileReader,
                  variableOverride.segments,
                  context,
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

              variation.variableOverrides[variableKey][variableOverrideI] = variableOverride;
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

      for (const traffic of feature.traffic) {
        let shouldAdd = true;

        if (lastTraffic && lastTraffic.segments === "*" && traffic.segments === "*") {
          shouldAdd = false;
        }

        if (shouldAdd) {
          newTrafficArray.push(traffic);
        }

        lastTraffic = traffic;
      }

      feature.traffic = newTrafficArray;
    }

    scopedDatafileContent.features[featureKey] = feature;
  }

  // Phase 2:
  //
  // - remove segments with "*" as conditions, and replace those segments usage with "*" in feature's group segments
  // - find unused segments and remove them

  return scopedDatafileContent;
}
