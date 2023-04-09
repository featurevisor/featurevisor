import * as fs from "fs";
import * as path from "path";

import * as yaml from "js-yaml";

import { Condition, AttributeKey, GroupSegment, SegmentKey } from "@featurevisor/types";

export function getYAMLFiles(directoryPath: string) {
  const files = fs.readdirSync(directoryPath);
  const yamlFiles = files.filter((file) => file.endsWith(".yml"));

  return yamlFiles.map((file) => path.join(directoryPath, file));
}

export function parseYaml(content: string) {
  const parsed = yaml.load(content);

  return parsed;
}

export function extractSegmentKeysFromGroupSegments(
  segments: GroupSegment | GroupSegment[],
): Set<SegmentKey> {
  const result = new Set<SegmentKey>();

  if (Array.isArray(segments)) {
    segments.forEach((segment) => {
      extractSegmentKeysFromGroupSegments(segment).forEach((segmentKey) => {
        result.add(segmentKey);
      });
    });
  }

  if (typeof segments === "object") {
    if ("and" in segments) {
      extractSegmentKeysFromGroupSegments(segments.and).forEach((segmentKey) => {
        result.add(segmentKey);
      });
    }

    if ("or" in segments) {
      extractSegmentKeysFromGroupSegments(segments.or).forEach((segmentKey) => {
        result.add(segmentKey);
      });
    }
  }

  if (typeof segments === "string") {
    result.add(segments);
  }

  return result;
}

export function extractAttributeKeysFromConditions(
  conditions: Condition | Condition[],
): Set<AttributeKey> {
  const result = new Set<AttributeKey>();

  if (Array.isArray(conditions)) {
    conditions.forEach((condition) => {
      extractAttributeKeysFromConditions(condition).forEach((attributeKey) => {
        result.add(attributeKey);
      });
    });
  }

  if ("attribute" in conditions) {
    result.add(conditions.attribute);
  }

  if ("and" in conditions) {
    extractAttributeKeysFromConditions(conditions.and).forEach((attributeKey) => {
      result.add(attributeKey);
    });
  }

  if ("or" in conditions) {
    extractAttributeKeysFromConditions(conditions.or).forEach((attributeKey) => {
      result.add(attributeKey);
    });
  }

  return result;
}
