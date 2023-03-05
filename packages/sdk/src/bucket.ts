import * as murmurhash from "murmurhash";

const HASH_SEED = 1;
const MAX_HASH_VALUE = Math.pow(2, 32);

export const MAX_BUCKETED_NUMBER = 100000; // 100% * 1000 to include three decimal places in the same integer value

export function getBucketedNumber(bucketKey: string): number {
  const hashValue = murmurhash.v3(bucketKey, HASH_SEED);
  const ratio = hashValue / MAX_HASH_VALUE;

  return Math.floor(ratio * MAX_BUCKETED_NUMBER);
}
