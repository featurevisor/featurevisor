import * as fs from "fs";

import {
  Segment,
  Feature,
  DatafileContent,
  DatafileContentV1,
  Variation,
  VariableOverride,
  Traffic,
  SegmentKey,
  AttributeKey,
  Attribute,
  GroupSegment,
  Condition,
  ExistingState,
  FeatureKey,
  Allocation,
  Expose,
  Rule,
  Force,
  Context,
} from "@featurevisor/types";

import { ProjectConfig, SCHEMA_VERSION, Scope } from "../config";
import { Datasource } from "../datasource";
import { extractAttributeKeysFromConditions, extractSegmentKeysFromGroupSegments } from "../utils";
import { generateHashForDatafile, generateHashForFeature, getSegmentHashes } from "./hashes";

import { getTraffic } from "./traffic";
import { getFeatureRanges } from "./getFeatureRanges";
import { convertToV1 } from "./convertToV1";

export interface CustomDatafileOptions {
  featureKey?: string;
  environment: string;
  projectConfig: ProjectConfig;
  datasource: Datasource;
  revision?: string;
  schemaVersion?: string;
  inflate?: number;
}

export async function getCustomDatafile(
  options: CustomDatafileOptions,
): Promise<DatafileContent | DatafileContentV1> {
  let featuresToInclude;

  if (options.featureKey) {
    const requiredChain = await options.datasource.getRequiredFeaturesChain(options.featureKey);
    featuresToInclude = Array.from(requiredChain);
  }

  const existingState = await options.datasource.readState(options.environment);
  const datafileContent = await buildDatafile(
    options.projectConfig,
    options.datasource,
    {
      schemaVersion: options.schemaVersion || SCHEMA_VERSION,
      revision: options.revision || "tester",
      environment: options.environment,
      features: featuresToInclude,
      inflate: options.inflate,
    },
    existingState,
  );

  return datafileContent;
}

export interface BuildOptions {
  schemaVersion: string;
  revision: string;
  revisionFromHash?: boolean;
  environment: string | false;
  tag?: string; // @TODO: support multiple tags later
  features?: FeatureKey[];
  inflate?: number;
}

export async function buildDatafile(
  projectConfig: ProjectConfig,
  datasource: Datasource,
  options: BuildOptions,
  existingState: ExistingState,
): Promise<DatafileContent | DatafileContentV1> {
  const segmentKeysUsedByTag = new Set<SegmentKey>();
  const attributeKeysUsedByTag = new Set<AttributeKey>();
  const { featureRanges, featureIsInGroup } = await getFeatureRanges(projectConfig, datasource);

  // features
  const features: Feature[] = [];
  const featuresDirectory = projectConfig.featuresDirectoryPath;

  if (fs.existsSync(featuresDirectory)) {
    const featureFiles = await datasource.listFeatures();

    for (const featureKey of featureFiles) {
      const parsedFeature = await datasource.readFeature(featureKey);

      if (parsedFeature.archived === true) {
        continue;
      }

      if (options.tag && parsedFeature.tags.indexOf(options.tag) === -1) {
        continue;
      }

      if (options.features && options.features.indexOf(featureKey) === -1) {
        continue;
      }

      let expose: Expose | undefined;
      let rules: Rule[];
      let force: Force[] | undefined;

      if (options.environment) {
        expose = parsedFeature.expose?.[options.environment] as Expose | undefined;
        rules = parsedFeature.rules?.[options.environment] as Rule[];
        force = parsedFeature.force?.[options.environment] as Force[] | undefined;
      } else {
        expose = parsedFeature.expose as Expose | undefined;
        rules = parsedFeature.rules as Rule[];
        force = parsedFeature.force as Force[] | undefined;
      }

      if (expose === false) {
        continue;
      }

      if (Array.isArray(expose)) {
        const exposeTags = expose;

        if (options.tag && exposeTags.indexOf(options.tag) === -1) {
          continue;
        }
      }

      for (const parsedRule of rules) {
        const extractedSegmentKeys = extractSegmentKeysFromGroupSegments(parsedRule.segments);
        extractedSegmentKeys.forEach((segmentKey) => segmentKeysUsedByTag.add(segmentKey));
      }

      const feature: Feature = {
        key: featureKey,
        deprecated: parsedFeature.deprecated === true ? true : undefined,
        bucketBy: parsedFeature.bucketBy || projectConfig.defaultBucketBy,
        required: parsedFeature.required,
        disabledVariationValue: parsedFeature.disabledVariationValue,
        variations: Array.isArray(parsedFeature.variations)
          ? parsedFeature.variations.map((variation: Variation) => {
              const mappedVariation: any = {
                value: variation.value,
                weight: variation.weight, // @NOTE: added so state files can maintain weight info, but datafiles don't need this. find a way to remove it from datafiles later
                variables: variation.variables,
                variableOverrides: variation.variableOverrides,
              };

              if (variation.variableOverrides) {
                const variableOverrides = variation.variableOverrides;
                const variableKeys = Object.keys(variableOverrides);

                for (const variableKey of variableKeys) {
                  mappedVariation.variableOverrides[variableKey] = variableOverrides[
                    variableKey
                  ].map((override: VariableOverride) => {
                    if (typeof override.conditions !== "undefined") {
                      const extractedAttributeKeys = extractAttributeKeysFromConditions(
                        override.conditions,
                      );
                      extractedAttributeKeys.forEach((attributeKey) =>
                        attributeKeysUsedByTag.add(attributeKey),
                      );

                      return {
                        conditions:
                          projectConfig.stringify && typeof override.conditions !== "string"
                            ? JSON.stringify(override.conditions)
                            : override.conditions,
                        value: override.value,
                      };
                    }

                    if (typeof override.segments !== "undefined") {
                      const extractedSegmentKeys = extractSegmentKeysFromGroupSegments(
                        override.segments as GroupSegment | GroupSegment[],
                      );
                      extractedSegmentKeys.forEach((segmentKey) =>
                        segmentKeysUsedByTag.add(segmentKey),
                      );

                      return {
                        segments:
                          projectConfig.stringify && typeof override.segments !== "string"
                            ? JSON.stringify(override.segments)
                            : override.segments,
                        value: override.value,
                      };
                    }

                    return override;
                  });
                }
              }

              return mappedVariation;
            })
          : undefined,
        traffic: getTraffic(
          parsedFeature.variations,
          rules,
          existingState.features[featureKey],
          featureRanges.get(featureKey) || [],
        ).map((t: Traffic) => {
          return {
            ...t,
            segments:
              typeof t.segments !== "string" && projectConfig.stringify
                ? JSON.stringify(t.segments)
                : t.segments,
          };
        }),
        ranges: featureRanges.get(featureKey) || undefined,
      };

      // update state in memory, so that next datafile build can use it (in case it contains the same feature)
      existingState.features[featureKey] = {
        variations: Array.isArray(feature.variations)
          ? feature.variations.map((v: Variation) => {
              return {
                value: v.value,
                weight: v.weight || 0,
              };
            })
          : undefined,
        traffic: feature.traffic.map((t: Traffic) => {
          return {
            key: t.key,
            percentage: t.percentage,
            allocation:
              t.allocation &&
              t.allocation.map((a: Allocation) => {
                return {
                  variation: a.variation,
                  range: a.range,
                };
              }),
          };
        }),
      };

      if (featureIsInGroup[featureKey] === true) {
        feature.ranges = featureRanges.get(featureKey);
      }

      if (parsedFeature.variablesSchema) {
        const variableKeys = Object.keys(parsedFeature.variablesSchema);
        feature.variablesSchema = {};

        for (const variableKey of variableKeys) {
          const v = parsedFeature.variablesSchema[variableKey];

          feature.variablesSchema[variableKey] = {
            key: variableKey,
            type: v.type,
            defaultValue: v.defaultValue,
            deprecated: v.deprecated === true ? true : undefined,
            useDefaultWhenDisabled: v.useDefaultWhenDisabled === true ? true : undefined,
            disabledValue: typeof v.disabledValue !== "undefined" ? v.disabledValue : undefined,
          };
        }
      }

      if (force) {
        feature.force = force.map((f) => {
          if (f.segments) {
            const extractedSegmentKeys = extractSegmentKeysFromGroupSegments(f.segments);
            extractedSegmentKeys.forEach((segmentKey) => segmentKeysUsedByTag.add(segmentKey));

            f.segments =
              typeof f.segments !== "string" && projectConfig.stringify
                ? JSON.stringify(f.segments)
                : f.segments;
          }

          if (f.conditions) {
            f.conditions =
              typeof f.conditions !== "string" && projectConfig.stringify
                ? JSON.stringify(f.conditions)
                : f.conditions;
          }

          return f;
        });
      }

      features.push(feature);
    }
  }

  // segments
  const segments: Segment[] = [];
  const segmentsDirectory = projectConfig.segmentsDirectoryPath;

  if (fs.existsSync(segmentsDirectory)) {
    const segmentFiles = await datasource.listSegments();

    for (const segmentKey of segmentFiles) {
      const parsedSegment = await datasource.readSegment(segmentKey);

      if (parsedSegment.archived === true) {
        continue;
      }

      if (segmentKeysUsedByTag.has(segmentKey) === false) {
        continue;
      }

      const extractedAttributeKeys = extractAttributeKeysFromConditions(
        parsedSegment.conditions as Condition | Condition[],
      );
      extractedAttributeKeys.forEach((attributeKey) => attributeKeysUsedByTag.add(attributeKey));

      const segment: Segment = {
        key: segmentKey,
        conditions:
          typeof parsedSegment.conditions !== "string" && projectConfig.stringify === true
            ? JSON.stringify(parsedSegment.conditions)
            : parsedSegment.conditions,
      };

      segments.push(segment);
    }
  }

  // attributes
  const attributes: Attribute[] = [];
  const attributesDirectory = projectConfig.attributesDirectoryPath;

  if (fs.existsSync(attributesDirectory)) {
    const attributeFiles = await datasource.listAttributes();

    for (const attributeKey of attributeFiles) {
      const parsedAttribute = await datasource.readAttribute(attributeKey);

      if (parsedAttribute.archived === true) {
        continue;
      }

      if (attributeKeysUsedByTag.has(attributeKey) === false) {
        continue;
      }

      const attribute: Attribute = {
        key: attributeKey,
        type: parsedAttribute.type,
      };

      attributes.push(attribute);
    }
  }

  // inflate
  if (options.inflate && options.inflate >= 2) {
    const allFeatureKeys = features.map((f) => f.key);
    const allSegmentKeys = segments.map((s) => s.key);
    const allAttributeKeys = attributes.map((a) => a.key);

    for (let i = 0; i < options.inflate - 1; i++) {
      // feature
      for (const featureKey of allFeatureKeys) {
        const originalFeature = features.find((f) => f.key === featureKey) as Feature;

        features.unshift({
          ...originalFeature,
          key: `${originalFeature.key}-${i}`,
        });
      }

      // segment
      for (const segmentKey of allSegmentKeys) {
        const originalSegment = segments.find((s) => s.key === segmentKey) as Segment;

        segments.unshift({
          ...originalSegment,
          key: `${originalSegment.key}-${i}`,
        });
      }

      // attribute
      for (const attributeKey of allAttributeKeys) {
        const originalAttribute = attributes.find((a) => a.key === attributeKey) as Attribute;

        attributes.unshift({
          ...originalAttribute,
          key: `${originalAttribute.key}-${i}`,
        });
      }
    }
  }

  // schema v1
  if (options.schemaVersion === "1") {
    return convertToV1({
      revision: options.revision,
      projectConfig,
      attributes,
      features,
      segments,
    });
  }

  // schema v2
  const datafileContentV2: DatafileContent = {
    schemaVersion: "2",
    revision: options.revision,
    segments: {},
    features: {},
  };

  datafileContentV2.segments = segments.reduce((acc, segment) => {
    // key check needed for supporting v1 datafile generation
    if (segment.key) {
      acc[segment.key] = segment;
      delete acc[segment.key].key; // remove key from segment, as it is not needed in v2 datafile
    }

    return acc;
  }, {});

  datafileContentV2.features = features.reduce((acc, feature) => {
    if (!feature.key) {
      return acc;
    }

    const featureKey = feature.key as FeatureKey;
    const featureV2 = feature;

    // remove key, as it is not needed in v2 datafile
    delete featureV2.key;

    // remove variablesSchema[key].key
    if (featureV2.variablesSchema) {
      for (const [variableKey, variable] of Object.entries(featureV2.variablesSchema)) {
        if (variable.key) {
          delete featureV2.variablesSchema[variableKey].key;
        }
      }
    }

    acc[featureKey] = featureV2;

    return acc;
  }, {});

  // add feature hashes for change detection
  const segmentHashes = getSegmentHashes(datafileContentV2.segments);
  Object.keys(datafileContentV2.features).forEach((featureKey) => {
    const hash = generateHashForFeature(featureKey, datafileContentV2.features, segmentHashes);

    datafileContentV2.features[featureKey].hash = hash;

    // check needed to support --inflate option
    if (existingState.features[featureKey]) {
      existingState.features[featureKey].hash = hash;
    }
  });

  if (options.revisionFromHash) {
    const datafileHash = generateHashForDatafile(datafileContentV2);
    datafileContentV2.revision = `${datafileHash}`;
  }

  return datafileContentV2;
}

export function buildScopedDatafile(
  originalDatafileContent: DatafileContent,
  context: Context,
): DatafileContent {
  const scopedDatafileContent = {
    ...originalDatafileContent,
  };

  // @TODO: remove redundant conditions from segments
  // @TODO: remove redundant conditions from environment rules
  // @TODO: remove redundant conditions from environment force
  // @TODO: remove redundant conditions from variation overrides

  // @TODO: remove redundant segments from environment rules
  // @TODO: remove redundant segments from environment force
  // @TODO: remove redundant segments from variation overrides

  // @TODO: remove redundant rules
  // @TODO: remove redundant segments
  // @TODO: remove redundant attributes

  return scopedDatafileContent;
}
