import type {
  GroupSegment,
  AndGroupSegment,
  OrGroupSegment,
  NotGroupSegment,
  Context,
} from "@featurevisor/types";
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
  if (groupSegments === "*") {
    return groupSegments;
  }

  if (Array.isArray(groupSegments)) {
    return groupSegments.map((gs) =>
      buildScopedGroupSegments(datafileReader, gs, context),
    ) as GroupSegment[];
  }

  if (typeof groupSegments === "string") {
    const matched = datafileReader.allSegmentsAreMatched(groupSegments, context);

    if (matched) {
      return "*";
    }
  }

  if (typeof groupSegments === "object") {
    // AND, OR, NOT group segments
    if ("and" in groupSegments) {
      return {
        and: groupSegments.and.map((gs) =>
          buildScopedGroupSegments(datafileReader, gs, context),
        ) as GroupSegment[],
      } as AndGroupSegment;
    }

    if ("or" in groupSegments) {
      return {
        or: groupSegments.or.map((gs) =>
          buildScopedGroupSegments(datafileReader, gs, context),
        ) as GroupSegment[],
      } as OrGroupSegment;
    }

    if ("not" in groupSegments) {
      return {
        not: groupSegments.not.map((gs) =>
          buildScopedGroupSegments(datafileReader, gs, context),
        ) as GroupSegment[],
      } as NotGroupSegment;
    }
  }

  return groupSegments;
}
