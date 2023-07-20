import * as fs from "fs";
import * as path from "path";

import * as mkdirp from "mkdirp";

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
  ParsedFeature,
  FeatureKey,
  Allocation,
  EnvironmentKey,
  Group,
  Range,
} from "@featurevisor/types";

import { SCHEMA_VERSION, ProjectConfig } from "./config";
import { getTraffic } from "./traffic";
import {
  parseYaml,
  extractAttributeKeysFromConditions,
  extractSegmentKeysFromGroupSegments,
} from "./utils";

export interface BuildOptions {
  schemaVersion: string;
  revision: string;
  environment: string;
  tag: string;
}

export function getDatafilePath(
  projectConfig: ProjectConfig,
  environment: EnvironmentKey,
  tag: string,
): string {
  const fileName = `datafile-tag-${tag}.json`;

  return path.join(projectConfig.outputDirectoryPath, environment, fileName);
}

export function getExistingStateFilePath(
  projectConfig: ProjectConfig,
  environment: EnvironmentKey,
): string {
  return path.join(projectConfig.stateDirectoryPath, `existing-state-${environment}.json`);
}

export type FeatureRanges = Map<FeatureKey, Range[]>;

interface FeatureRangesResult {
  featureRanges: FeatureRanges;
  featureIsInGroup: { [key: string]: boolean };
}

export function getFeatureRanges(projectConfig: ProjectConfig): FeatureRangesResult {
  const featureRanges = new Map<FeatureKey, Range[]>();
  const featureIsInGroup = {}; // featureKey => boolean

  const groups: Group[] = [];
  if (fs.existsSync(projectConfig.groupsDirectoryPath)) {
    const groupFiles = fs
      .readdirSync(projectConfig.groupsDirectoryPath)
      .filter((f) => f.endsWith(".yml"));

    for (const groupFile of groupFiles) {
      const groupKey = path.basename(groupFile, ".yml");
      const groupFilePath = path.join(projectConfig.groupsDirectoryPath, groupFile);
      const parsedGroup = parseYaml(fs.readFileSync(groupFilePath, "utf8")) as Group;

      groups.push({
        ...parsedGroup,
        key: groupKey,
      });

      let accumulatedPercentage = 0;
      parsedGroup.slots.forEach(function (slot, slotIndex) {
        const isFirstSlot = slotIndex === 0;

        if (slot.feature) {
          const featureKey = slot.feature;

          if (typeof featureKey === "string") {
            featureIsInGroup[featureKey] = true;
          }

          const featureRangesForFeature = featureRanges.get(featureKey) || [];

          const start = isFirstSlot ? accumulatedPercentage : accumulatedPercentage + 1;
          const end = accumulatedPercentage + slot.percentage * 1000;

          featureRangesForFeature.push([start, end]);

          featureRanges.set(slot.feature, featureRangesForFeature);
        }

        accumulatedPercentage += slot.percentage * 1000;
      });
    }
  }

  return { featureRanges, featureIsInGroup };
}

export function buildDatafile(
  projectConfig: ProjectConfig,
  options: BuildOptions,
  existingState: ExistingState,
): DatafileContent {
  const datafileContent: DatafileContent = {
    schemaVersion: options.schemaVersion,
    revision: options.revision,
    attributes: [],
    segments: [],
    features: [],
  };

  const segmentKeysUsedByTag = new Set<SegmentKey>();
  const attributeKeysUsedByTag = new Set<AttributeKey>();
  const { featureRanges, featureIsInGroup } = getFeatureRanges(projectConfig);

  // features
  const features: Feature[] = [];
  const featuresDirectory = projectConfig.featuresDirectoryPath;

  if (fs.existsSync(featuresDirectory)) {
    const featureFiles = fs.readdirSync(featuresDirectory).filter((f) => f.endsWith(".yml"));

    for (const featureFile of featureFiles) {
      const featureKey = path.basename(featureFile, ".yml") as FeatureKey;
      const featureFilePath = path.join(featuresDirectory, featureFile);
      const parsedFeature = parseYaml(fs.readFileSync(featureFilePath, "utf8")) as ParsedFeature;

      if (parsedFeature.archived === true) {
        continue;
      }

      if (parsedFeature.tags.indexOf(options.tag) === -1) {
        continue;
      }

      if (parsedFeature.environments[options.environment].expose === false) {
        continue;
      }

      for (const parsedRule of parsedFeature.environments[options.environment].rules) {
        const extractedSegmentKeys = extractSegmentKeysFromGroupSegments(parsedRule.segments);
        extractedSegmentKeys.forEach((segmentKey) => segmentKeysUsedByTag.add(segmentKey));
      }

      const feature: Feature = {
        key: featureKey,
        bucketBy: parsedFeature.bucketBy || projectConfig.defaultBucketBy,
        parents: parsedFeature.parents,
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
                      conditions: JSON.stringify(override.conditions),
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
                      segments: JSON.stringify(override.segments),
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
        ),
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
        feature.variablesSchema = parsedFeature.variablesSchema;
      }

      if (parsedFeature.environments[options.environment].force) {
        feature.force = parsedFeature.environments[options.environment].force;
      }

      features.push(feature);
    }
  }

  // segments
  const segments: Segment[] = [];
  const segmentsDirectory = projectConfig.segmentsDirectoryPath;

  if (fs.existsSync(segmentsDirectory)) {
    const segmentFiles = fs.readdirSync(segmentsDirectory).filter((f) => f.endsWith(".yml"));

    for (const segmentFile of segmentFiles) {
      const segmentKey = path.basename(segmentFile, ".yml");
      const segmentFilePath = path.join(segmentsDirectory, segmentFile);
      const parsedSegment = parseYaml(fs.readFileSync(segmentFilePath, "utf8")) as Segment;

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
          typeof parsedSegment.conditions !== "string"
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
    const attributeFiles = fs.readdirSync(attributesDirectory).filter((f) => f.endsWith(".yml"));

    for (const attributeFile of attributeFiles) {
      const attributeKey = path.basename(attributeFile, ".yml");
      const attributeFilePath = path.join(attributesDirectory, attributeFile);
      const parsedAttribute = parseYaml(fs.readFileSync(attributeFilePath, "utf8")) as Attribute;

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

export interface BuildCLIOptions {
  revision?: string;
}

export function buildProject(
  rootDirectoryPath,
  projectConfig: ProjectConfig,
  cliOptions: BuildCLIOptions = {},
) {
  const tags = projectConfig.tags;
  const environments = projectConfig.environments;

  const pkg = require(path.join(rootDirectoryPath, "package.json"));

  for (const environment of environments) {
    console.log(`\nBuilding datafiles for environment: ${environment}`);

    const existingStateFilePath = getExistingStateFilePath(projectConfig, environment);
    const existingState: ExistingState = fs.existsSync(existingStateFilePath)
      ? require(existingStateFilePath)
      : {
          features: {},
        };

    for (const tag of tags) {
      console.log(`\n  => Tag: ${tag}`);
      const datafileContent = buildDatafile(
        projectConfig,
        {
          schemaVersion: SCHEMA_VERSION,
          revision: cliOptions.revision || pkg.version,
          environment: environment,
          tag: tag,
        },
        existingState,
      );

      // write datafile for environment/tag
      const outputEnvironmentDirPath = path.join(projectConfig.outputDirectoryPath, environment);
      mkdirp.sync(outputEnvironmentDirPath);

      const outputFilePath = getDatafilePath(projectConfig, environment, tag);
      fs.writeFileSync(
        outputFilePath,
        projectConfig.prettyDatafile
          ? JSON.stringify(datafileContent, null, 2)
          : JSON.stringify(datafileContent),
      );
      const shortPath = outputFilePath.replace(rootDirectoryPath + path.sep, "");
      console.log(`     Datafile generated: ${shortPath}`);
    }

    // write state for environment
    if (!fs.existsSync(projectConfig.stateDirectoryPath)) {
      mkdirp.sync(projectConfig.stateDirectoryPath);
    }
    fs.writeFileSync(
      existingStateFilePath,
      projectConfig.prettyState
        ? JSON.stringify(existingState, null, 2)
        : JSON.stringify(existingState),
    );
  }
}
