import { Condition, FeatureKey, SegmentKey, AttributeKey, Segment } from "@featurevisor/types";

import { Dependencies } from "../dependencies";
import {
  extractAttributeKeysFromConditions,
  extractSegmentKeysFromGroupSegments,
} from "../utils/extractKeys";

export async function findSegmentUsage(
  deps: Dependencies,
  segmentKey: SegmentKey,
): Promise<Set<FeatureKey>> {
  const { datasource, projectConfig } = deps;

  const featureKeys = await datasource.listFeatures();

  const usedInFeatures = new Set<FeatureKey>();

  for (const featureKey of featureKeys) {
    const feature = await datasource.readFeature(featureKey);
    const segmentKeys = new Set<SegmentKey>();

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

export interface AttributeUsage {
  features: Set<FeatureKey>;
  segments: Set<SegmentKey>;
}

export async function findAttributeUsage(
  deps: Dependencies,
  attributeKey: AttributeKey,
): Promise<AttributeUsage> {
  const { datasource, projectConfig } = deps;

  const usedIn: AttributeUsage = {
    features: new Set<FeatureKey>(),
    segments: new Set<SegmentKey>(),
  };

  // features
  const featureKeys = await datasource.listFeatures();
  for (const featureKey of featureKeys) {
    const feature = await datasource.readFeature(featureKey);
    const attributeKeys = new Set<AttributeKey>();

    // variable overrides inside variations
    projectConfig.environments.forEach((environment) => {
      if (feature.variations) {
        feature.variations.forEach((variation) => {
          if (variation.variables) {
            variation.variables.forEach((variable) => {
              if (variable.overrides) {
                variable.overrides.forEach((override) => {
                  if (override.conditions) {
                    extractAttributeKeysFromConditions(override.conditions).forEach(
                      (attributeKey) => attributeKeys.add(attributeKey),
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
          if (force.conditions) {
            extractAttributeKeysFromConditions(force.conditions).forEach((attributeKey) =>
              attributeKeys.add(attributeKey),
            );
          }
        });
      }
    });

    if (attributeKeys.has(attributeKey)) {
      usedIn.features.add(featureKey);
    }
  }

  // segments
  const segmentKeys = await datasource.listSegments();
  for (const segmentKey of segmentKeys) {
    const segment = await datasource.readSegment(segmentKey);
    const attributeKeys = new Set<AttributeKey>();

    extractAttributeKeysFromConditions(segment.conditions as Condition | Condition[]).forEach(
      (attributeKey) => {
        attributeKeys.add(attributeKey);
      },
    );

    if (attributeKeys.has(attributeKey)) {
      usedIn.segments.add(segmentKey);
    }
  }

  return usedIn;
}

export async function findUnusedSegments(deps: Dependencies): Promise<Set<SegmentKey>> {
  const { datasource } = deps;

  const segmentKeys = await datasource.listSegments();
  const unusedSegments = new Set<SegmentKey>();

  for (const segmentKey of segmentKeys) {
    const usedInFeatures = await findSegmentUsage(deps, segmentKey);

    if (usedInFeatures.size === 0) {
      unusedSegments.add(segmentKey);
    }
  }

  return unusedSegments;
}

export async function findUnusedAttributes(deps: Dependencies): Promise<Set<AttributeKey>> {
  const { datasource } = deps;

  const attributeKeys = await datasource.listAttributes();
  const unusedAttributes = new Set<AttributeKey>();

  for (const attributeKey of attributeKeys) {
    const usedIn = await findAttributeUsage(deps, attributeKey);

    if (usedIn.features.size === 0 && usedIn.segments.size === 0) {
      unusedAttributes.add(attributeKey);
    }
  }

  return unusedAttributes;
}

export interface FindUsageOptions {
  segment?: string;
  attribute?: string;

  unusedSegments?: boolean;
  unusedAttributes?: boolean;
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

  // attribute
  if (options.attribute) {
    const usedIn = await findAttributeUsage(deps, options.attribute);

    if (usedIn.features.size === 0 && usedIn.segments.size === 0) {
      console.log(`Attribute "${options.attribute}" is not used in any features or segments.`);

      return;
    }

    if (usedIn.features.size > 0) {
      console.log(`Attribute "${options.attribute}" is used in the following features:\n`);

      usedIn.features.forEach((featureKey) => {
        console.log(`  - ${featureKey}`);
      });

      console.log("");
    }

    if (usedIn.segments.size > 0) {
      console.log(`Attribute "${options.attribute}" is used in the following segments:\n`);

      usedIn.segments.forEach((segmentKey) => {
        console.log(`  - ${segmentKey}`);
      });
    }

    return;
  }

  // unused segments
  if (options.unusedSegments) {
    const unusedSegments = await findUnusedSegments(deps);

    if (unusedSegments.size === 0) {
      console.log("No unused segments found.");
    } else {
      console.log("Unused segments:\n");

      unusedSegments.forEach((segmentKey) => {
        console.log(`  - ${segmentKey}`);
      });
    }

    return;
  }

  // unused attributes
  if (options.unusedAttributes) {
    const unusedAttributes = await findUnusedAttributes(deps);

    if (unusedAttributes.size === 0) {
      console.log("No unused attributes found.");
    } else {
      console.log("Unused attributes:\n");

      unusedAttributes.forEach((attributeKey) => {
        console.log(`  - ${attributeKey}`);
      });
    }

    return;
  }

  console.log("Please specify a segment or attribute.");
}
