import type { Context, AttributeValue, FeatureKey, BucketBy } from "@featurevisor/types";

import { getValueFromContext } from "./conditions";
import { MurmurHashV3 } from "./murmurhash";
import type { FeaturevisorDiagnosticReporter } from "./diagnostics";

export type BucketKey = string;
export type BucketValue = number; // 0 to 100,000 (100% * 1000 to include three decimal places in same integer)

/**
 * Generic hashing
 */
const HASH_SEED = 1;
const MAX_HASH_VALUE = Math.pow(2, 32);

export const MAX_BUCKETED_NUMBER = 100000; // 100% * 1000 to include three decimal places in the same integer value

export function getBucketedNumber(bucketKey: string): BucketValue {
  const hashValue = MurmurHashV3(bucketKey, HASH_SEED);
  const ratio = hashValue / MAX_HASH_VALUE;

  return Math.floor(ratio * MAX_BUCKETED_NUMBER);
}

/**
 * Bucket key
 */
const DEFAULT_BUCKET_KEY_SEPARATOR = ".";

export interface GetBucketKeyOptions {
  featureKey: FeatureKey;
  bucketBy: BucketBy;
  context: Context;

  reportDiagnostic: FeaturevisorDiagnosticReporter;
}

export function getBucketKey(options: GetBucketKeyOptions): BucketKey {
  const {
    featureKey,
    bucketBy,
    context,

    reportDiagnostic,
  } = options;

  let type;
  let attributeKeys;

  if (typeof bucketBy === "string") {
    type = "plain";
    attributeKeys = [bucketBy];
  } else if (Array.isArray(bucketBy)) {
    type = "and";
    attributeKeys = bucketBy;
  } else if (typeof bucketBy === "object" && Array.isArray(bucketBy.or)) {
    type = "or";
    attributeKeys = bucketBy.or;
  } else {
    reportDiagnostic({
      level: "error",
      code: "invalid_bucket_by",
      message: "Invalid bucketBy",
      featureKey,
      bucketBy,
    });

    throw new Error("invalid bucketBy");
  }

  const bucketKey: AttributeValue[] = [];

  attributeKeys.forEach((attributeKey) => {
    const attributeValue = getValueFromContext(context, attributeKey);

    if (typeof attributeValue === "undefined") {
      return;
    }

    if (type === "plain" || type === "and") {
      bucketKey.push(attributeValue);
    } else {
      // or
      if (bucketKey.length === 0) {
        bucketKey.push(attributeValue);
      }
    }
  });

  bucketKey.push(featureKey);

  return bucketKey.join(DEFAULT_BUCKET_KEY_SEPARATOR);
}
