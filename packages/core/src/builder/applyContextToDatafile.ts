import { DatafileContent, Context, Traffic } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk/internal";

import { applyContextToConditions } from "./applyContextToConditions";
import { applyContextToSegments } from "./applyContextToSegments";

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

export function applyContextToDatafile(
  originalDatafileContent: DatafileContent,
  context: Context,
): DatafileContent {
  const originalFeaturevisor = createFeaturevisor({
    datafile: originalDatafileContent,
    logLevel: "fatal",
  });

  const contextualDatafileContent: DatafileContent = JSON.parse(
    JSON.stringify(originalDatafileContent),
  );

  const removeSegments: string[] = [];

  // segments
  for (const segmentKey in contextualDatafileContent.segments) {
    const segment = contextualDatafileContent.segments[segmentKey];
    const originalConditions = segment.conditions;
    const contextualConditions = applyContextToConditions(
      originalFeaturevisor,
      originalConditions,
      context,
    );
    contextualDatafileContent.segments[segmentKey].conditions = contextualConditions;

    if (contextualConditions === "*") {
      removeSegments.push(segmentKey);
    }
  }

  // features
  for (const featureKey in contextualDatafileContent.features) {
    const feature = contextualDatafileContent.features[featureKey];

    // force
    if (feature.force) {
      for (let forceI = 0; forceI < feature.force.length; forceI++) {
        const force = feature.force[forceI];

        // segments
        if (force.segments) {
          feature.force[forceI].segments = applyContextToSegments(
            originalFeaturevisor,
            force.segments,
            context,
            removeSegments,
          );
        }

        // conditions
        if (force.conditions) {
          feature.force[forceI].conditions = applyContextToConditions(
            originalFeaturevisor,
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

        // Store original segments before applying context
        originalTrafficSegments[trafficI] = traffic.segments;

        // segments
        if (traffic.segments) {
          const segments = parseIfStringified(traffic.segments);
          feature.traffic[trafficI].segments = applyContextToSegments(
            originalFeaturevisor,
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
                variableOverride.segments = applyContextToSegments(
                  originalFeaturevisor,
                  segments,
                  context,
                  removeSegments,
                );
              }

              // conditions
              if (variableOverride.conditions) {
                const conditions = parseIfStringified(variableOverride.conditions);
                variableOverride.conditions = applyContextToConditions(
                  originalFeaturevisor,
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
                variableOverride.segments = applyContextToSegments(
                  originalFeaturevisor,
                  variableOverride.segments,
                  context,
                  removeSegments,
                );
              }

              // conditions
              if (variableOverride.conditions) {
                variableOverride.conditions = applyContextToConditions(
                  originalFeaturevisor,
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

    contextualDatafileContent.features[featureKey] = feature;
  }

  // remove segments
  for (const removeSegment of removeSegments) {
    delete contextualDatafileContent.segments[removeSegment];
  }

  return contextualDatafileContent;
}
