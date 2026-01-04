import type { GroupSegment, Context } from "@featurevisor/types";
import type { DatafileReader } from "@featurevisor/sdk";

export function buildScopedSegments(
  datafileReader: DatafileReader,
  segments: GroupSegment | GroupSegment[],
  context: Context,
): GroupSegment | GroupSegment[] {
  const scoped = buildScopedGroupSegments(datafileReader, segments, context);
  const removed = removeRedundantGroupSegments(scoped);

  return removed;
}

export function removeRedundantGroupSegments(
  groupSegments: GroupSegment | GroupSegment[],
): GroupSegment | GroupSegment[] {
  // @TODO: implement
  return groupSegments;
}

export function buildScopedGroupSegments(
  datafileReader: DatafileReader,
  groupSegments: GroupSegment | GroupSegment[],
  context: Context,
): GroupSegment | GroupSegment[] {
  // @TODO: remove later
  if (!context) {
    return groupSegments;
  }

  // @TODO: implement
  return groupSegments;
}
