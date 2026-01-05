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
  if (groupSegments === "*") {
    return groupSegments;
  }

  if (Array.isArray(groupSegments)) {
    // Recursively process each group segment
    const processed = groupSegments.map((gs) => removeRedundantGroupSegments(gs)) as GroupSegment[];

    // Filter out "*" values
    const filtered = processed.filter((gs) => gs !== "*");

    // If all were "*", return "*"
    if (filtered.length === 0) {
      return "*";
    }

    return filtered;
  }

  if (typeof groupSegments === "object") {
    if ("and" in groupSegments) {
      const processed = groupSegments.and.map((gs) =>
        removeRedundantGroupSegments(gs),
      ) as GroupSegment[];
      const filtered = processed.filter((gs) => gs !== "*");

      // If all were "*", return "*"
      if (filtered.length === 0) {
        return "*";
      }

      return {
        and: filtered,
      } as AndGroupSegment;
    }

    if ("or" in groupSegments) {
      const processed = groupSegments.or.map((gs) =>
        removeRedundantGroupSegments(gs),
      ) as GroupSegment[];
      const filtered = processed.filter((gs) => gs !== "*");

      // If all were "*", return "*"
      if (filtered.length === 0) {
        return "*";
      }

      return {
        or: filtered,
      } as OrGroupSegment;
    }

    if ("not" in groupSegments) {
      const processed = groupSegments.not.map((gs) =>
        removeRedundantGroupSegments(gs),
      ) as GroupSegment[];
      const filtered = processed.filter((gs) => gs !== "*");

      // If all were "*", return "*"
      if (filtered.length === 0) {
        return "*";
      }

      return {
        not: filtered,
      } as NotGroupSegment;
    }
  }

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
