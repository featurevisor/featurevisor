import * as fs from "fs";

import {
  Segment,
  Feature,
  DatafileContent,
  Variation,
  Variable,
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
  VariableSchema,
} from "@featurevisor/types";

import { ProjectConfig, SCHEMA_VERSION } from "../config";
import { Datasource } from "../datasource";
import { extractAttributeKeysFromConditions, extractSegmentKeysFromGroupSegments } from "../utils";

import { getTraffic } from "./traffic";
import { getFeatureRanges } from "./getFeatureRanges";

export interface CustomDatafileOptions {
  featureKey?: string;
  environment: string;
  projectConfig: ProjectConfig;
  datasource: Datasource;
  revision?: string;
}

export async function getCustomDatafile(options: CustomDatafileOptions): Promise<DatafileContent> {
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
      schemaVersion: SCHEMA_VERSION,
      revision: options.revision || "tester",
      environment: options.environment,
      features: featuresToInclude,
    },
    existingState,
  );

  return datafileContent;
}

export interface BuildOptions {
  schemaVersion: string;
  revision: string;
  environment: string;
  tag?: string;
  features?: FeatureKey[];
}

export async function buildDatafile(
  projectConfig: ProjectConfig,
  datasource: Datasource,
  options: BuildOptions,
  existingState: ExistingState,
): Promise<DatafileContent> {
  const datafileContent: DatafileContent = {
    schemaVersion: options.schemaVersion,
    revision: options.revision,
    attributes: [],
    segments: [],
    features: [],
  };

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

      if (parsedFeature.environments[options.environment].expose === false) {
        continue;
      }

      if (Array.isArray(parsedFeature.environments[options.environment].expose)) {
        const exposeTags = parsedFeature.environments[options.environment].expose as string[];

        if (options.tag && exposeTags.indexOf(options.tag) === -1) {
          continue;
        }
      }

      for (const parsedRule of parsedFeature.environments[options.environment].rules) {
        const extractedSegmentKeys = extractSegmentKeysFromGroupSegments(parsedRule.segments);
        extractedSegmentKeys.forEach((segmentKey) => segmentKeysUsedByTag.add(segmentKey));
      }

      const feature: Feature = {
        key: featureKey,
        deprecated: parsedFeature.deprecated === true ? true : undefined,
        bucketBy: parsedFeature.bucketBy || projectConfig.defaultBucketBy,
        required: parsedFeature.required,
        variations: Array.isArray(parsedFeature.variations)
          ? parsedFeature.variations.map((variation: Variation) => {
              const mappedVariation: any = {
                value: variation.value,
                weight: variation.weight, // @TODO: added so state files can maintain weight info, but datafiles don't need this. find a way to remove it from datafiles later
              };

              if (!variation.variables) {
                return mappedVariation;
              }

              mappedVariation.variables = variation.variables.map((variable: Variable) => {
                const mappedVariable: any = {
                  key: variable.key,
                  value: variable.value,
                };

                if (!variable.overrides) {
                  return mappedVariable;
                }

                mappedVariable.overrides = variable.overrides.map((override: VariableOverride) => {
                  if (typeof override.conditions !== "undefined") {
                    const extractedAttributeKeys = extractAttributeKeysFromConditions(
                      override.conditions,
                    );
                    extractedAttributeKeys.forEach((attributeKey) =>
                      attributeKeysUsedByTag.add(attributeKey),
                    );

                    return {
                      conditions: projectConfig.stringify
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
                        typeof override.segments !== "string" && projectConfig.stringify
                          ? JSON.stringify(override.segments)
                          : override.segments,
                      value: override.value,
                    };
                  }

                  return override;
                });

                return mappedVariable;
              });

              return mappedVariation;
            })
          : undefined,
        traffic: getTraffic(
          parsedFeature.variations,
          parsedFeature.environments[options.environment].rules,
          existingState.features[featureKey],
          featureRanges.get(featureKey) || [],
        ).map((t: Traffic) => {
          return {
            ...t,
            segments:
              typeof typeof t.segments !== "string" && projectConfig.stringify
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
            allocation: t.allocation.map((a: Allocation) => {
              return {
                variation: a.variation,
                range: a.range,
              };
            }),
          };
        }),
      };

      if (featureIsInGroup[featureKey] === true) {
        feature.ranges = featureRanges.get(feature.key);
      }

      if (parsedFeature.variablesSchema) {
        feature.variablesSchema = parsedFeature.variablesSchema.map(function (v: VariableSchema) {
          return {
            key: v.key,
            type: v.type,
            defaultValue: v.defaultValue,
          };
        });
      }

      if (parsedFeature.environments[options.environment].force) {
        feature.force = parsedFeature.environments[options.environment].force;

        feature.force?.forEach((f) => {
          if (f.segments) {
            const extractedSegmentKeys = extractSegmentKeysFromGroupSegments(f.segments);
            extractedSegmentKeys.forEach((segmentKey) => segmentKeysUsedByTag.add(segmentKey));
          }
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

      if (attributeKeysUsedByTag.has(attributeKey) === false && !parsedAttribute.capture) {
        continue;
      }

      const attribute: Attribute = {
        key: attributeKey,
        type: parsedAttribute.type,
      };

      if (parsedAttribute.capture === true) {
        attribute.capture = true;
      }

      attributes.push(attribute);
    }
  }

  datafileContent.attributes = attributes;
  datafileContent.segments = segments;
  datafileContent.features = features;

  return datafileContent;
}
