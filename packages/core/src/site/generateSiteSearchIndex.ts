import type {
  HistoryEntry,
  SearchIndex,
  AttributeKey,
  FeatureKey,
  SegmentKey,
  Condition,
} from "@featurevisor/types";

import { extractAttributeKeysFromConditions, extractSegmentKeysFromGroupSegments } from "../utils";

import { getRelativePaths } from "./getRelativePaths";
import { getLastModifiedFromHistory } from "./getLastModifiedFromHistory";
import { RepoDetails } from "./getRepoDetails";
import { Dependencies } from "../dependencies";

export async function generateSiteSearchIndex(
  deps: Dependencies,
  fullHistory: HistoryEntry[],
  repoDetails: RepoDetails | undefined,
): Promise<SearchIndex> {
  const { rootDirectoryPath, projectConfig, datasource } = deps;

  const result: SearchIndex = {
    links: undefined,
    projectConfig: {
      tags: projectConfig.tags,
      environments: projectConfig.environments,
    },
    entities: {
      attributes: [],
      segments: [],
      features: [],
    },
  };

  /**
   * Links
   */
  if (repoDetails) {
    const { relativeAttributesPath, relativeSegmentsPath, relativeFeaturesPath } = getRelativePaths(
      rootDirectoryPath,
      projectConfig,
    );

    let prefix = "";
    if (repoDetails.topLevelPath !== rootDirectoryPath) {
      prefix = rootDirectoryPath.replace(repoDetails.topLevelPath + "/", "") + "/";
    }

    result.links = {
      attribute: repoDetails.blobUrl.replace(
        "{{blobPath}}",
        prefix + relativeAttributesPath + "/{{key}}." + datasource.getExtension(),
      ),
      segment: repoDetails.blobUrl.replace(
        "{{blobPath}}",
        prefix + relativeSegmentsPath + "/{{key}}." + datasource.getExtension(),
      ),
      feature: repoDetails.blobUrl.replace(
        "{{blobPath}}",
        prefix + relativeFeaturesPath + "/{{key}}." + datasource.getExtension(),
      ),
      commit: repoDetails.commitUrl,
    };
  }

  /**
   * Entities
   */
  // usage
  const attributesUsedInFeatures: {
    [key: AttributeKey]: Set<FeatureKey>;
  } = {};
  const attributesUsedInSegments: {
    [key: AttributeKey]: Set<SegmentKey>;
  } = {};
  const segmentsUsedInFeatures: {
    [key: SegmentKey]: Set<FeatureKey>;
  } = {};

  // features
  const featureFiles = await datasource.listFeatures();

  for (const entityName of featureFiles) {
    const parsed = await datasource.readFeature(entityName);

    if (Array.isArray(parsed.variations)) {
      parsed.variations.forEach((variation) => {
        if (!variation.variableOverrides) {
          return;
        }

        Object.keys(variation.variableOverrides).forEach((variableKey) => {
          const overrides = variation.variableOverrides?.[variableKey];

          if (overrides) {
            overrides.forEach((o) => {
              if (o.conditions) {
                extractAttributeKeysFromConditions(o.conditions).forEach((attributeKey) => {
                  if (!attributesUsedInFeatures[attributeKey]) {
                    attributesUsedInFeatures[attributeKey] = new Set();
                  }

                  attributesUsedInFeatures[attributeKey].add(entityName);
                });
              }

              if (o.segments && o.segments !== "*") {
                extractSegmentKeysFromGroupSegments(o.segments).forEach((segmentKey) => {
                  if (!segmentsUsedInFeatures[segmentKey]) {
                    segmentsUsedInFeatures[segmentKey] = new Set();
                  }

                  segmentsUsedInFeatures[segmentKey].add(entityName);
                });
              }
            });
          }
        });
      });
    }

    // rules
    if (parsed.rules) {
      if (!Array.isArray(parsed.rules)) {
        // with environments
        Object.keys(parsed.rules).forEach((environmentKey) => {
          const rules = parsed.rules?.[environmentKey];

          rules.forEach((rule) => {
            if (rule.segments && rule.segments !== "*") {
              extractSegmentKeysFromGroupSegments(rule.segments).forEach((segmentKey) => {
                if (!segmentsUsedInFeatures[segmentKey]) {
                  segmentsUsedInFeatures[segmentKey] = new Set();
                }

                segmentsUsedInFeatures[segmentKey].add(entityName);
              });
            }
          });
        });
      } else {
        // no environments
        parsed.rules.forEach((rule) => {
          if (rule.segments && rule.segments !== "*") {
            extractSegmentKeysFromGroupSegments(rule.segments).forEach((segmentKey) => {
              if (!segmentsUsedInFeatures[segmentKey]) {
                segmentsUsedInFeatures[segmentKey] = new Set();
              }

              segmentsUsedInFeatures[segmentKey].add(entityName);
            });
          }
        });
      }
    }

    // force
    if (parsed.force) {
      if (!Array.isArray(parsed.force)) {
        // with environments
        Object.keys(parsed.force).forEach((environmentKey) => {
          parsed.force?.[environmentKey].forEach((force) => {
            if (force.segments && force.segments !== "*") {
              extractSegmentKeysFromGroupSegments(force.segments).forEach((segmentKey) => {
                if (!segmentsUsedInFeatures[segmentKey]) {
                  segmentsUsedInFeatures[segmentKey] = new Set();
                }

                segmentsUsedInFeatures[segmentKey].add(entityName);
              });
            }

            if (force.conditions) {
              extractAttributeKeysFromConditions(force.conditions).forEach((attributeKey) => {
                if (!attributesUsedInFeatures[attributeKey]) {
                  attributesUsedInFeatures[attributeKey] = new Set();
                }

                attributesUsedInFeatures[attributeKey].add(entityName);
              });
            }
          });
        });
      } else {
        // no environments
        parsed.force.forEach((force) => {
          if (force.segments && force.segments !== "*") {
            extractSegmentKeysFromGroupSegments(force.segments).forEach((segmentKey) => {
              if (!segmentsUsedInFeatures[segmentKey]) {
                segmentsUsedInFeatures[segmentKey] = new Set();
              }

              segmentsUsedInFeatures[segmentKey].add(entityName);
            });
          }

          if (force.conditions) {
            extractAttributeKeysFromConditions(force.conditions).forEach((attributeKey) => {
              if (!attributesUsedInFeatures[attributeKey]) {
                attributesUsedInFeatures[attributeKey] = new Set();
              }

              attributesUsedInFeatures[attributeKey].add(entityName);
            });
          }
        });
      }
    }

    // push
    result.entities.features.push({
      ...parsed,
      key: entityName,
      lastModified: getLastModifiedFromHistory(fullHistory, "feature", entityName),
    });
  }

  // segments
  const segmentFiles = await datasource.listSegments();
  for (const entityName of segmentFiles) {
    const parsed = await datasource.readSegment(entityName);

    extractAttributeKeysFromConditions(parsed.conditions as Condition | Condition[]).forEach(
      (attributeKey) => {
        if (!attributesUsedInSegments[attributeKey]) {
          attributesUsedInSegments[attributeKey] = new Set();
        }

        attributesUsedInSegments[attributeKey].add(entityName);
      },
    );

    result.entities.segments.push({
      ...parsed,
      key: entityName,
      lastModified: getLastModifiedFromHistory(fullHistory, "segment", entityName),
      usedInFeatures: Array.from(segmentsUsedInFeatures[entityName] || []),
    });
  }

  // attributes
  const attributeFiles = await datasource.listAttributes();
  for (const entityName of attributeFiles) {
    const parsed = await datasource.readAttribute(entityName);

    result.entities.attributes.push({
      ...parsed,
      key: entityName,
      lastModified: getLastModifiedFromHistory(fullHistory, "attribute", entityName),
      usedInFeatures: Array.from(attributesUsedInFeatures[entityName] || []),
      usedInSegments: Array.from(attributesUsedInSegments[entityName] || []),
    });
  }

  return result;
}
