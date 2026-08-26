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
): string {
  const feature = features[featureKey];

  if (!feature) {
    return "";
  }

  const requiredFeatureKeys: string[] = [];
  if (feature.required) {
    for (const r of feature.required) {
      if (typeof r === "string") {
        requiredFeatureKeys.push(r);
      }

      if (typeof r === "object" && r.key) {
        requiredFeatureKeys.push(r.key);
      }
    }
  }

  const requiredFeatureHashes = requiredFeatureKeys.map((key) =>
    generateHashForFeature(key, features, segmentHashes),
  );

  const usedSegments = extractSegmentsFromFeature(feature);
  const usedSegmentHashes = Array.from(usedSegments).map((segmentKey) => segmentHashes[segmentKey]);

  const featureWithoutHash = { ...feature };
  delete featureWithoutHash.hash;

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
  ].map((required) => (typeof required === "string" ? required : required.key));
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
