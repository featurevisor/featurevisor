import { Dependencies } from "../dependencies";
import {
  extractAttributeKeysFromConditions,
  extractSegmentKeysFromGroupSegments,
} from "../utils/extractKeys";

export async function findSegmentUsage(
  deps: Dependencies,
  segmentKey: string,
): Promise<Set<string>> {
  const { datasource, projectConfig } = deps;

  const featureKeys = await datasource.listFeatures();

  const usedInFeatures = new Set<string>();

  for (const featureKey of featureKeys) {
    const feature = await datasource.readFeature(featureKey);
    const segmentKeys = new Set<string>();

    // variable overrides inside variations
    projectConfig.environments.forEach((environment) => {
      if (feature.variations) {
        feature.variations.forEach((variation) => {
          if (variation.variables) {
            variation.variables.forEach((variable) => {
              if (variable.overrides) {
                variable.overrides.forEach((override) => {
                  if (override.segments) {
                    extractSegmentKeysFromGroupSegments(override.segments).forEach((segmentKey) =>
                      segmentKeys.add(segmentKey),
                    );
                  }
                });
              }
            });
          }
        });
      }

      // force
      if (feature.environments[environment].force) {
        feature.environments[environment].force?.forEach((force) => {
          if (force.segments) {
            extractSegmentKeysFromGroupSegments(force.segments).forEach((segmentKey) =>
              segmentKeys.add(segmentKey),
            );
          }
        });
      }

      // rules
      if (feature.environments[environment].rules) {
        feature.environments[environment].rules?.forEach((rule) => {
          extractSegmentKeysFromGroupSegments(rule.segments).forEach((segmentKey) =>
            segmentKeys.add(segmentKey),
          );
        });
      }
    });

    if (segmentKeys.has(segmentKey)) {
      usedInFeatures.add(featureKey);
    }
  }

  return usedInFeatures;
}

export interface FindUsageOptions {
  segment?: string;
  attribute?: string;
}

export async function findUsageInProject(deps: Dependencies, options: FindUsageOptions) {
  console.log("");

  // segment
  if (options.segment) {
    const usedInFeatures = await findSegmentUsage(deps, options.segment);

    if (usedInFeatures.size === 0) {
      console.log(`Segment "${options.segment}" is not used in any features.`);
    } else {
      console.log(`Segment "${options.segment}" is used in the following features:\n`);

      usedInFeatures.forEach((featureKey) => {
        console.log(`  - ${featureKey}`);
      });
    }

    return;
  }

  console.log("Please specify a segment or attribute.");
}
