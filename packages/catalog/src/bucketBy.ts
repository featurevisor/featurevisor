import type { BucketBy } from "@featurevisor/types";

/**
 * What a feature buckets by, in words: `userId`, `userId and deviceId` or `userId or deviceId`.
 * Shared by the export's index and the Query page's Why panel, so both say it alike.
 */
export function describeBucketBy(bucketBy: BucketBy | undefined): string | undefined {
  if (bucketBy === undefined) return undefined;
  if (typeof bucketBy === "string") return bucketBy;
  if (Array.isArray(bucketBy)) return bucketBy.join(" and ");
  return Array.isArray(bucketBy.or) ? bucketBy.or.join(" or ") : undefined;
}
