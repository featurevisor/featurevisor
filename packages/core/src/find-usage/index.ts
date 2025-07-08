import { Condition, FeatureKey, SegmentKey, AttributeKey } from "@featurevisor/types";

import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";
import {
  extractAttributeKeysFromConditions,
  extractSegmentKeysFromGroupSegments,
} from "../utils/extractKeys";

export interface UsageInFeatures {
  [featureKey: string]: {
    features: Set<FeatureKey>;
    segments: Set<SegmentKey>;
    attributes: Set<AttributeKey>;
  };
}

export async function findAllUsageInFeatures(deps: Dependencies): Promise<UsageInFeatures> {
  const { datasource, projectConfig } = deps;
  const usageInFeatures: UsageInFeatures = {};

  const featureKeys = await datasource.listFeatures();

  for (const featureKey of featureKeys) {
    const feature = await datasource.readFeature(featureKey);
    usageInFeatures[featureKey] = {
      features: new Set<FeatureKey>(),
      segments: new Set<SegmentKey>(),
      attributes: new Set<AttributeKey>(),
    };

    // required
    if (feature.required) {
      feature.required.forEach((required) => {
        if (typeof required === "string") {
          usageInFeatures[featureKey].features.add(required);
        } else if (typeof required === "object" && required.key) {
          usageInFeatures[featureKey].features.add(required.key);
        }
      });
    }

    // bucketBy
    if (feature.bucketBy) {
      if (typeof feature.bucketBy === "string") {
        usageInFeatures[featureKey].attributes.add(feature.bucketBy);
      } else if (Array.isArray(feature.bucketBy)) {
        feature.bucketBy.forEach((b) => usageInFeatures[featureKey].attributes.add(b));
      } else if (typeof feature.bucketBy === "object" && feature.bucketBy.or) {
        feature.bucketBy.or.forEach((b) => usageInFeatures[featureKey].attributes.add(b));
      }
    }

    // variable overrides inside variations
    if (feature.variations) {
      feature.variations.forEach((variation) => {
        if (variation.variableOverrides) {
          Object.keys(variation.variableOverrides).forEach((variableKey) => {
            const overrides = variation.variableOverrides?.[variableKey];

            if (overrides) {
              overrides.forEach((override) => {
                if (override.segments) {
                  extractSegmentKeysFromGroupSegments(override.segments).forEach((segmentKey) =>
                    usageInFeatures[featureKey].segments.add(segmentKey),
                  );
                }

                if (override.conditions) {
                  extractAttributeKeysFromConditions(override.conditions).forEach((attributeKey) =>
                    usageInFeatures[featureKey].attributes.add(attributeKey),
                  );
                }
              });
            }
          });
        }
      });
    }

    // with environments
    if (Array.isArray(projectConfig.environments)) {
      projectConfig.environments.forEach((environment) => {
        // force
        if (feature.force && feature.force[environment]) {
          feature.force[environment].forEach((force) => {
            if (force.segments) {
              extractSegmentKeysFromGroupSegments(force.segments).forEach((segmentKey) =>
                usageInFeatures[featureKey].segments.add(segmentKey),
              );
            }

            if (force.conditions) {
              extractAttributeKeysFromConditions(force.conditions).forEach((attributeKey) =>
                usageInFeatures[featureKey].attributes.add(attributeKey),
              );
            }
          });
        }

        // rules
        if (feature.rules && feature.rules[environment]) {
          feature.rules[environment].forEach((rule) => {
            extractSegmentKeysFromGroupSegments(rule.segments).forEach((segmentKey) =>
              usageInFeatures[featureKey].segments.add(segmentKey),
            );
          });
        }
      });
    }

    // no environments
    if (projectConfig.environments === false) {
      // force
      if (Array.isArray(feature.force)) {
        feature.force.forEach((force) => {
          if (force.segments) {
            extractSegmentKeysFromGroupSegments(force.segments).forEach((segmentKey) =>
              usageInFeatures[featureKey].segments.add(segmentKey),
            );
          }

          if (force.conditions) {
            extractAttributeKeysFromConditions(force.conditions).forEach((attributeKey) =>
              usageInFeatures[featureKey].attributes.add(attributeKey),
            );
          }
        });
      }

      // rules
      if (Array.isArray(feature.rules)) {
        feature.rules.forEach((rule) => {
          extractSegmentKeysFromGroupSegments(rule.segments).forEach((segmentKey) =>
            usageInFeatures[featureKey].segments.add(segmentKey),
          );
        });
      }
    }
  }

  return usageInFeatures;
}

export interface UsageInSegments {
  [segmentKey: string]: {
    attributes: Set<AttributeKey>;
  };
}

export async function findAllUsageInSegments(deps: Dependencies): Promise<UsageInSegments> {
  const { datasource } = deps;
  const usageInSegments: UsageInSegments = {};

  const segmentKeys = await datasource.listSegments();

  for (const segmentKey of segmentKeys) {
    const segment = await datasource.readSegment(segmentKey);
    usageInSegments[segmentKey] = {
      attributes: new Set<AttributeKey>(),
    };

    extractAttributeKeysFromConditions(segment.conditions as Condition | Condition[]).forEach(
      (attributeKey) => {
        usageInSegments[segmentKey].attributes.add(attributeKey);
      },
    );
  }

  return usageInSegments;
}

export async function findFeatureUsage(
  usageInFeatures: UsageInFeatures,
  searchFeatureKey: FeatureKey,
): Promise<Set<FeatureKey>> {
  const usedInFeatures = new Set<FeatureKey>();

  for (const featureKey in usageInFeatures) {
    if (usageInFeatures[featureKey].features.has(searchFeatureKey)) {
      usedInFeatures.add(featureKey);
    }
  }

  return usedInFeatures;
}

export async function findSegmentUsage(
  usageInFeatures: UsageInFeatures,
  segmentKey: SegmentKey,
): Promise<Set<FeatureKey>> {
  const usedInFeatures = new Set<FeatureKey>();

  for (const featureKey in usageInFeatures) {
    if (usageInFeatures[featureKey].segments.has(segmentKey)) {
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
  usageInFeatures: UsageInFeatures,
  usageInSegments: UsageInSegments,
  attributeKey: AttributeKey,
): Promise<AttributeUsage> {
  const usedIn: AttributeUsage = {
    features: new Set<FeatureKey>(),
    segments: new Set<SegmentKey>(),
  };

  for (const featureKey in usageInFeatures) {
    if (usageInFeatures[featureKey].attributes.has(attributeKey)) {
      usedIn.features.add(featureKey);
    }
  }

  for (const segmentKey in usageInSegments) {
    if (usageInSegments[segmentKey].attributes.has(attributeKey)) {
      usedIn.segments.add(segmentKey);
    }
  }

  return usedIn;
}

export async function findUnusedSegments(
  deps: Dependencies,
  usageInFeatures: UsageInFeatures,
): Promise<Set<SegmentKey>> {
  const { datasource } = deps;
  const unusedSegments = new Set<SegmentKey>();

  const allSegmentKeys = await datasource.listSegments();
  const usedSegmentKeys = new Set<SegmentKey>();

  for (const featureKey in usageInFeatures) {
    usageInFeatures[featureKey].segments.forEach((segmentKey) => {
      usedSegmentKeys.add(segmentKey);
    });
  }

  allSegmentKeys.forEach((segmentKey) => {
    if (!usedSegmentKeys.has(segmentKey)) {
      unusedSegments.add(segmentKey);
    }
  });

  return unusedSegments;
}

export async function findUnusedAttributes(
  deps: Dependencies,
  usageInFeatures: UsageInFeatures,
  usageInSegments: UsageInSegments,
): Promise<Set<AttributeKey>> {
  const { datasource } = deps;
  const unusedAttributes = new Set<AttributeKey>();

  const allAttributeKeys = await datasource.listAttributes();
  const usedAttributeKeys = new Set<AttributeKey>();

  for (const featureKey in usageInFeatures) {
    usageInFeatures[featureKey].attributes.forEach((attributeKey) => {
      usedAttributeKeys.add(attributeKey);
    });
  }

  for (const segmentKey in usageInSegments) {
    usageInSegments[segmentKey].attributes.forEach((attributeKey) => {
      usedAttributeKeys.add(attributeKey);
    });
  }

  allAttributeKeys.forEach((attributeKey) => {
    if (!usedAttributeKeys.has(attributeKey)) {
      unusedAttributes.add(attributeKey);
    }
  });

  return unusedAttributes;
}

export interface FindUsageOptions {
  feature?: string;
  segment?: string;
  attribute?: string;

  unusedSegments?: boolean;
  unusedAttributes?: boolean;

  authors?: boolean;
}

export async function findUsageInProject(deps: Dependencies, options: FindUsageOptions) {
  const { datasource } = deps;

  console.log("");

  const usageInFeatures = await findAllUsageInFeatures(deps);
  const usageInSegments = await findAllUsageInSegments(deps);

  // feature
  if (options.feature) {
    const usedInFeatures = await findFeatureUsage(usageInFeatures, options.feature);

    if (usedInFeatures.size === 0) {
      console.log(`Feature "${options.feature}" is not used in any features.`);
    } else {
      console.log(`Feature "${options.feature}" is used in the following features:\n`);

      for (const featureKey of Array.from(usedInFeatures)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("feature", featureKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(`  - ${featureKey} (Authors: ${authors.join(", ")})`);
        } else {
          console.log(`  - ${featureKey}`);
        }
      }
    }

    return;
  }

  // segment
  if (options.segment) {
    const usedInFeatures = await findSegmentUsage(usageInFeatures, options.segment);

    if (usedInFeatures.size === 0) {
      console.log(`Segment "${options.segment}" is not used in any features.`);
    } else {
      console.log(`Segment "${options.segment}" is used in the following features:\n`);

      for (const featureKey of Array.from(usedInFeatures)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("feature", featureKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(`  - ${featureKey} (Authors: ${authors.join(", ")})`);
        } else {
          console.log(`  - ${featureKey}`);
        }
      }
    }

    return;
  }

  // attribute
  if (options.attribute) {
    const usedIn = await findAttributeUsage(usageInFeatures, usageInSegments, options.attribute);

    if (usedIn.features.size === 0 && usedIn.segments.size === 0) {
      console.log(`Attribute "${options.attribute}" is not used in any features or segments.`);

      return;
    }

    if (usedIn.segments.size > 0) {
      console.log(`Attribute "${options.attribute}" is used in the following segments:\n`);

      for (const segmentKey of Array.from(usedIn.segments)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("segment", segmentKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(`  - ${segmentKey} (Authors: ${authors.join(", ")})`);
        } else {
          console.log(`  - ${segmentKey}`);
        }
      }

      // features affected by above segments
      const affectedFeatures = new Set<FeatureKey>();

      for (const segmentKey of Array.from(usedIn.segments)) {
        const featureKeys = await findSegmentUsage(usageInFeatures, segmentKey);
        featureKeys.forEach((featureKey) => affectedFeatures.add(featureKey));
      }

      if (affectedFeatures.size > 0) {
        console.log(`\nSegments above are used in the following features:\n`);

        for (const featureKey of Array.from(affectedFeatures)) {
          if (options.authors) {
            const entries = await datasource.listHistoryEntries("feature", featureKey);
            const authors = Array.from(new Set(entries.map((entry) => entry.author)));

            console.log(`  - ${featureKey} (Authors: ${authors.join(", ")})`);
          } else {
            console.log(`  - ${featureKey}`);
          }
        }

        console.log("");
      }
    }

    if (usedIn.features.size > 0) {
      console.log(`Attribute "${options.attribute}" is used directly in the following features:\n`);

      for (const featureKey of Array.from(usedIn.features)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("feature", featureKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(`  - ${featureKey} (Authors: ${authors.join(", ")})`);
        } else {
          console.log(`  - ${featureKey}`);
        }
      }

      console.log("");
    }

    return;
  }

  // unused segments
  if (options.unusedSegments) {
    const unusedSegments = await findUnusedSegments(deps, usageInFeatures);

    if (unusedSegments.size === 0) {
      console.log("No unused segments found.");
    } else {
      console.log("Unused segments:\n");

      for (const segmentKey of Array.from(unusedSegments)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("segment", segmentKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(`  - ${segmentKey} (Authors: ${authors.join(", ")})`);
        } else {
          console.log(`  - ${segmentKey}`);
        }
      }
    }

    return;
  }

  // unused attributes
  if (options.unusedAttributes) {
    const unusedAttributes = await findUnusedAttributes(deps, usageInFeatures, usageInSegments);

    if (unusedAttributes.size === 0) {
      console.log("No unused attributes found.");
    } else {
      console.log("Unused attributes:\n");

      for (const attributeKey of Array.from(unusedAttributes)) {
        if (options.authors) {
          const entries = await datasource.listHistoryEntries("attribute", attributeKey);
          const authors = Array.from(new Set(entries.map((entry) => entry.author)));

          console.log(`  - ${attributeKey} (Authors: ${authors.join(", ")})`);
        } else {
          console.log(`  - ${attributeKey}`);
        }
      }
    }

    return;
  }

  console.log("Please specify a segment or attribute.");
}

export const findUsagePlugin: Plugin = {
  command: "find-usage",
  handler: async ({ rootDirectoryPath, projectConfig, datasource, parsed }) => {
    await findUsageInProject(
      {
        rootDirectoryPath,
        projectConfig,
        datasource,
        options: parsed,
      },
      {
        feature: parsed.feature,
        segment: parsed.segment,
        attribute: parsed.attribute,
        unusedSegments: parsed.unusedSegments,
        unusedAttributes: parsed.unusedAttributes,
        authors: parsed.authors,
      },
    );
  },
  examples: [
    {
      command: "find-usage --segment=<segmentKey>",
      description: "Find usage of a segment",
    },
    {
      command: "find-usage --attribute=<attributeKey>",
      description: "Find usage of an attribute",
    },
    {
      command: "find-usage --unused-segments",
      description: "Find unused segments",
    },
    {
      command: "find-usage --unused-attributes",
      description: "Find unused attributes",
    },
    {
      command: "find-usage --authors",
      description: "List authors of the usage",
    },
  ],
};
