import type { AttributeKey } from "./attribute";

export type PlainBucketBy = AttributeKey;
export type AndBucketBy = AttributeKey[];
export interface OrBucketBy {
  or: AttributeKey[];
}
export type BucketBy = PlainBucketBy | AndBucketBy | OrBucketBy;

/**
 * Used by SDK
 */
export type BucketKey = string;
export type BucketValue = number; // 0 to 100,000 (100% * 1000 to include three decimal places in same integer)
