import * as murmurhash from "murmurhash";
import { Feature, BucketKey, BucketValue, Context, AttributeValue } from "@featurevisor/types";

import { Logger } from "./logger";

/**
 * Generic hashing
 */
const HASH_SEED = 1;
const MAX_HASH_VALUE = Math.pow(2, 32);

export const MAX_BUCKETED_NUMBER = 100000; // 100% * 1000 to include three decimal places in the same integer value

export function getBucketedNumber(bucketKey: string): number {
  const hashValue = murmurhash.v3(bucketKey, HASH_SEED);
  const ratio = hashValue / MAX_HASH_VALUE;

  return Math.floor(ratio * MAX_BUCKETED_NUMBER);
}

/**
 * Feature specific bucketing
 */
type ConfigureBucketKey = (feature: Feature, context: Context, bucketKey: BucketKey) => BucketKey;

export interface BucketKeyOptions {
  feature: Feature;
  context: Context;
  logger: Logger;
  bucketKeySeparator?: string;
  configureBucketKey?: ConfigureBucketKey;
}

export function getBucketKey(options: BucketKeyOptions): BucketKey {
  const { feature, context, logger, bucketKeySeparator = ".", configureBucketKey } = options;

  const featureKey = feature.key;

  let type;
  let attributeKeys;

  if (typeof feature.bucketBy === "string") {
    type = "plain";
    attributeKeys = [feature.bucketBy];
  } else if (Array.isArray(feature.bucketBy)) {
    type = "and";
    attributeKeys = feature.bucketBy;
  } else if (typeof feature.bucketBy === "object" && Array.isArray(feature.bucketBy.or)) {
    type = "or";
    attributeKeys = feature.bucketBy.or;
  } else {
    logger.error("invalid bucketBy", { featureKey, bucketBy: feature.bucketBy });

    throw new Error("invalid bucketBy");
  }

  const bucketKey: AttributeValue[] = [];

  attributeKeys.forEach((attributeKey) => {
    const attributeValue = context[attributeKey];

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

  const result = bucketKey.join(bucketKeySeparator);

  if (configureBucketKey) {
    return configureBucketKey(feature, context, result);
  }

  return result;
}

export interface Bucket {
  bucketKey: BucketKey;
  bucketValue: BucketValue;
}

export type ConfigureBucketValue = (
  feature: Feature,
  context: Context,
  bucketValue: BucketValue,
) => BucketValue;

export interface BucketValueOptions {
  // common with BucketKeyOptions
  feature: Feature;
  context: Context;
  logger: Logger;
  bucketKeySeparator?: string;
  configureBucketKey?: ConfigureBucketKey;

  // specific to BucketValueOptions
  configureBucketValue?: ConfigureBucketValue;
}

export function getBucket(options: BucketValueOptions): Bucket {
  const { feature, context, logger, bucketKeySeparator, configureBucketKey, configureBucketValue } =
    options;
  const bucketKey = getBucketKey({
    feature,
    context,
    logger,
    bucketKeySeparator,
    configureBucketKey,
  });
  const value = getBucketedNumber(bucketKey);

  if (configureBucketValue) {
    const configuredValue = configureBucketValue(feature, context, value);

    return {
      bucketKey,
      bucketValue: configuredValue,
    };
  }

  return {
    bucketKey,
    bucketValue: value,
  };
}
