import { Context, GroupSegment, Segment, Condition } from "@featurevisor/types";
import { allConditionsAreMatched } from "./conditions";
import { DatafileReader } from "./datafileReader";

export function segmentIsMatched(segment: Segment, context: Context): boolean {
  return allConditionsAreMatched(segment.conditions as Condition | Condition[], context);
}

export function allGroupSegmentsAreMatched(
  groupSegments: GroupSegment | GroupSegment[] | "*",
  context: Context,
  datafileReader: DatafileReader,
): boolean {
  if (groupSegments === "*") {
    return true;
  }

  if (typeof groupSegments === "string") {
    const segment = datafileReader.getSegment(groupSegments);

    if (segment) {
      return segmentIsMatched(segment, context);
    }

    return false;
  }

  if (typeof groupSegments === "object") {
    if ("and" in groupSegments && Array.isArray(groupSegments.and)) {
      return groupSegments.and.every((groupSegment) =>
        allGroupSegmentsAreMatched(groupSegment, context, datafileReader),
      );
    }

    if ("or" in groupSegments && Array.isArray(groupSegments.or)) {
      return groupSegments.or.some((groupSegment) =>
        allGroupSegmentsAreMatched(groupSegment, context, datafileReader),
      );
    }

    if ("not" in groupSegments && Array.isArray(groupSegments.not)) {
      return (
        allGroupSegmentsAreMatched({ and: groupSegments.not }, context, datafileReader) === false
      );
    }
  }

  if (Array.isArray(groupSegments)) {
    return groupSegments.every((groupSegment) =>
      allGroupSegmentsAreMatched(groupSegment, context, datafileReader),
    );
  }

  return false;
}
