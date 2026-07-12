import type {
  GroupSegment,
  AndGroupSegment,
  OrGroupSegment,
  NotGroupSegment,
  Context,
} from "@featurevisor/types";
import { allSegmentsAreMatched } from "@featurevisor/sdk";
import type { Featurevisor } from "@featurevisor/sdk";

export function applyContextToSegments(
  featurevisor: Featurevisor,
  segments: GroupSegment | GroupSegment[],
  context: Context,
  removeSegments: string[] = [],
): GroupSegment | GroupSegment[] {
  const withContextApplied = applyContextToGroupSegments(
    featurevisor,
    segments,
    context,
    removeSegments,
  );
  const removed = removeRedundantGroupSegments(withContextApplied);

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

      // `not` negates the implicit AND of its children. Matched children are true
      // and can be removed: not(true && X) becomes not(X). If every child was
      // true, keep not("*") so it remains an always-false expression.
      if (filtered.length === 0) {
        return {
          not: ["*"],
        } as NotGroupSegment;
      }

      return {
        not: filtered,
      } as NotGroupSegment;
    }
  }

  return groupSegments;
}

export function applyContextToGroupSegments(
  featurevisor: Featurevisor,
  groupSegments: GroupSegment | GroupSegment[],
  context: Context,
  removeSegments: string[] = [],
): GroupSegment | GroupSegment[] {
  if (groupSegments === "*") {
    return groupSegments;
  }

  if (Array.isArray(groupSegments)) {
    return groupSegments.map((gs) =>
      applyContextToGroupSegments(featurevisor, gs, context, removeSegments),
    ) as GroupSegment[];
  }

  if (typeof groupSegments === "string") {
    if (removeSegments.includes(groupSegments)) {
      return "*";
    }

    const matched = allSegmentsAreMatched(groupSegments, context, (segmentKey) =>
      featurevisor.getSegment(segmentKey),
    );

    if (matched) {
      return "*";
    }
  }

  if (typeof groupSegments === "object") {
    // AND, OR, NOT group segments
    if ("and" in groupSegments) {
      return {
        and: groupSegments.and.map((gs) =>
          applyContextToGroupSegments(featurevisor, gs, context, removeSegments),
        ) as GroupSegment[],
      } as AndGroupSegment;
    }

    if ("or" in groupSegments) {
      return {
        or: groupSegments.or.map((gs) =>
          applyContextToGroupSegments(featurevisor, gs, context, removeSegments),
        ) as GroupSegment[],
      } as OrGroupSegment;
    }

    if ("not" in groupSegments) {
      return {
        not: groupSegments.not.map((gs) =>
          applyContextToGroupSegments(featurevisor, gs, context, removeSegments),
        ) as GroupSegment[],
      } as NotGroupSegment;
    }
  }

  return groupSegments;
}
