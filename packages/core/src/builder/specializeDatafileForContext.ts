import { DatafileContent, Context, Traffic } from "@featurevisor/types";
import { DatafileReader, noopDiagnosticReporter } from "@featurevisor/sdk";

import { specializeConditionsForContext } from "./specializeConditionsForContext";
import { specializeSegmentsForContext } from "./specializeSegmentsForContext";

function parseIfStringified<T>(value: T): T {
  if (typeof value !== "string" || value === "*") {
    return value;
  }

  const firstChar = value[0];
  if (firstChar !== "{" && firstChar !== "[") {
    return value;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return value;
  }
}

export function specializeDatafileForContext(
  originalDatafileContent: DatafileContent,
  context: Context,
): DatafileContent {
  const originalDatafileReader = new DatafileReader({
    datafile: originalDatafileContent,
    reportDiagnostic: noopDiagnosticReporter,
  });

  const specializedDatafileContent: DatafileContent = JSON.parse(
    JSON.stringify(originalDatafileContent),
  );

  const removeSegments: string[] = [];

  // segments
  for (const segmentKey in specializedDatafileContent.segments) {
    const segment = specializedDatafileContent.segments[segmentKey];
    const originalConditions = segment.conditions;
    const specializedConditions = specializeConditionsForContext(
      originalDatafileReader,
      originalConditions,
      context,
    );
    specializedDatafileContent.segments[segmentKey].conditions = specializedConditions;

    if (specializedConditions === "*") {
      removeSegments.push(segmentKey);
    }
  }

  // features
  for (const featureKey in specializedDatafileContent.features) {
    const feature = specializedDatafileContent.features[featureKey];

    // force
    if (feature.force) {
      for (let forceI = 0; forceI < feature.force.length; forceI++) {
        const force = feature.force[forceI];

        // segments
        if (force.segments) {
          feature.force[forceI].segments = specializeSegmentsForContext(
            originalDatafileReader,
            force.segments,
            context,
            removeSegments,
          );
        }

        // conditions
        if (force.conditions) {
          feature.force[forceI].conditions = specializeConditionsForContext(
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
          const segments = parseIfStringified(traffic.segments);
          feature.traffic[trafficI].segments = specializeSegmentsForContext(
            originalDatafileReader,
            segments,
            context,
            removeSegments,
          );
        }

        // variable overrides
        if (traffic.variableOverrides) {
          for (const variableKey in traffic.variableOverrides) {
            const variableOverrides = traffic.variableOverrides[variableKey];

            for (
              let variableOverrideI = 0;
              variableOverrideI < variableOverrides.length;
              variableOverrideI++
            ) {
              const variableOverride = variableOverrides[variableOverrideI];

              // segments
              if (variableOverride.segments) {
                const segments = parseIfStringified(variableOverride.segments);
                variableOverride.segments = specializeSegmentsForContext(
                  originalDatafileReader,
                  segments,
                  context,
                  removeSegments,
                );
              }

              // conditions
              if (variableOverride.conditions) {
                const conditions = parseIfStringified(variableOverride.conditions);
                variableOverride.conditions = specializeConditionsForContext(
                  originalDatafileReader,
                  conditions,
                  context,
                );
              }

              variableOverrides[variableOverrideI] = variableOverride;
            }
          }
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
                variableOverride.segments = specializeSegmentsForContext(
                  originalDatafileReader,
                  variableOverride.segments,
                  context,
                  removeSegments,
                );
              }

              // conditions
              if (variableOverride.conditions) {
                variableOverride.conditions = specializeConditionsForContext(
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

        if (
          lastAddedTraffic &&
          lastAddedTraffic.segments === "*" &&
          currentTraffic.segments === "*"
        ) {
          shouldAdd = false;
        }

        if (shouldAdd) {
          newTrafficArray.push(currentTraffic);

          lastAddedTraffic = currentTraffic;
        }
      }

      feature.traffic = newTrafficArray;
    }

    specializedDatafileContent.features[featureKey] = feature;
  }

  // remove segments
  for (const removeSegment of removeSegments) {
    delete specializedDatafileContent.segments[removeSegment];
  }

  return specializedDatafileContent;
}
