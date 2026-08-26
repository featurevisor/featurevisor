import * as crypto from "crypto";

import type {
  FeatureKey,
  Feature,
  SegmentKey,
  Segment,
  DatafileContent,
  DatafileVariable,
  GlobalVariableKey,
} from "@featurevisor/types";

import { extractSegmentKeysFromGroupSegments, extractSegmentsFromFeature } from "../utils";
import { getRequiredFeatureKey } from "../datasource/requiredFeatures";

const base62chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function generateHashFromString(str: string, length = 10): string {
  const hashBuffer = crypto.createHash("sha256").update(str).digest();

  // Convert buffer to base62 (alphanumeric)
  let num = BigInt("0x" + hashBuffer.toString("hex"));
  let base62 = "";
  while (num > 0) {
    // Convert the remainder to a number for indexing
    const remainder = Number(num % 62n);
    base62 = base62chars[remainder] + base62;
    num = num / 62n;
  }

  // Return first 10 chars for a short hash (adjust length as needed)
  return base62.slice(0, length);
}

export function getSegmentHashes(
  segments: Record<SegmentKey, Segment>,
): Record<SegmentKey, string> {
  const result: Record<SegmentKey, string> = {};

  for (const segmentKey of Object.keys(segments)) {
    const segment = segments[segmentKey];
    result[segmentKey] = generateHashFromString(
      JSON.stringify({
        conditions: segment.conditions,
      }),
    );
  }

  return result;
}

export function generateHashForFeature(
  featureKey: FeatureKey,
  features: Record<FeatureKey, Feature>,
  segmentHashes: Record<SegmentKey, string>,
  visiting: Set<FeatureKey> = new Set(),
): string {
  const feature = features[featureKey];

  if (!feature) {
    return "";
  }

  const requiredFeatureKeys: string[] = [];
  for (const required of feature.requiredFeatures || []) {
    requiredFeatureKeys.push(getRequiredFeatureKey(required));
  }
  for (const required of feature.required || []) {
    requiredFeatureKeys.push(typeof required === "string" ? required : required.key);
  }
  for (const traffic of feature.traffic) {
    for (const overrides of Object.values(traffic.variableOverrides || {})) {
      for (const override of overrides) {
        const requirements = override.requiredFeatures;
        if (!requirements) continue;
        for (const required of Array.isArray(requirements) ? requirements : [requirements]) {
          requiredFeatureKeys.push(getRequiredFeatureKey(required));
        }
      }
    }
  }
  for (const variation of feature.variations || []) {
    for (const overrides of Object.values(variation.variableOverrides || {})) {
      for (const override of overrides) {
        const requirements = override.requiredFeatures;
        if (!requirements) continue;
        for (const required of Array.isArray(requirements) ? requirements : [requirements]) {
          requiredFeatureKeys.push(getRequiredFeatureKey(required));
        }
      }
    }
  }

  const usedSegments = extractSegmentsFromFeature(feature);
  const usedSegmentHashes = Array.from(usedSegments).map((segmentKey) => segmentHashes[segmentKey]);

  const featureWithoutHash = { ...feature };
  delete featureWithoutHash.hash;

  // Override requirements may form a safe runtime cycle because checking a
  // required flag does not evaluate that feature's variable overrides. Stop
  // hash recursion at the cycle while retaining the complete local content.
  if (visiting.has(featureKey)) {
    return generateHashFromString(
      JSON.stringify({ featureKey, feature: featureWithoutHash, usedSegmentHashes }),
    );
  }

  const nextVisiting = new Set(visiting);
  nextVisiting.add(featureKey);
  const requiredFeatureHashes = Array.from(new Set(requiredFeatureKeys)).map((key) =>
    generateHashForFeature(key, features, segmentHashes, nextVisiting),
  );

  return generateHashFromString(
    JSON.stringify({
      featureKey,
      feature: featureWithoutHash,
      requiredFeatureHashes,
      usedSegmentHashes,
    }),
  );
}

export function generateHashForDatafile(datafileContent: DatafileContent): string {
  const featureHashes = Object.keys(datafileContent.features).reduce(
    (acc, featureKey) => {
      acc[featureKey] = datafileContent.features[featureKey].hash || "";
      return acc;
    },
    {} as Record<FeatureKey, string>,
  );

  const hash = generateHashFromString(
    JSON.stringify({
      schemaVersion: datafileContent.schemaVersion,
      featureHashes,
      variables: datafileContent.variables,
    }),
  );

  return hash;
}

export function generateHashForVariable(
  variableKey: GlobalVariableKey,
  variables: Record<GlobalVariableKey, DatafileVariable>,
  features: Record<FeatureKey, Feature>,
  segmentHashes: Record<SegmentKey, string>,
): string {
  const variable = variables[variableKey];
  if (!variable) return "";

  const requiredFeatureKeys = [
    ...(variable.requiredFeatures || []),
    ...(variable.overrides || []).flatMap((override) => override.requiredFeatures || []),
  ].map(getRequiredFeatureKey);
  const requiredFeatureHashes = requiredFeatureKeys.map((featureKey) =>
    generateHashForFeature(featureKey, features, segmentHashes),
  );
  const usedSegmentHashes = (variable.overrides || [])
    .flatMap((override) => Array.from(extractSegmentKeysFromGroupSegments(override.segments || [])))
    .map((segmentKey) => segmentHashes[segmentKey]);

  const variableWithoutHash = { ...variable };
  delete variableWithoutHash.hash;

  return generateHashFromString(
    JSON.stringify({
      variableKey,
      variable: variableWithoutHash,
      requiredFeatureHashes,
      usedSegmentHashes,
    }),
  );
}

/** Rebuild every content hash after a datafile has been specialized. */
export function refreshDatafileHashes(datafileContent: DatafileContent): DatafileContent {
  const segmentHashes = getSegmentHashes(datafileContent.segments);

  for (const featureKey of Object.keys(datafileContent.features)) {
    datafileContent.features[featureKey].hash = generateHashForFeature(
      featureKey,
      datafileContent.features,
      segmentHashes,
    );
  }

  for (const variableKey of Object.keys(datafileContent.variables || {})) {
    datafileContent.variables![variableKey].hash = generateHashForVariable(
      variableKey,
      datafileContent.variables || {},
      datafileContent.features,
      segmentHashes,
    );
  }

  return datafileContent;
}
