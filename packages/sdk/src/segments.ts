import { Attributes, GroupSegment, Segment, Condition } from "@featurevisor/types";
import { allConditionsAreMatched } from "./conditions";
import { DatafileReader } from "./datafileReader";

export function segmentIsMatched(segment: Segment, attributes: Attributes): boolean {
  return allConditionsAreMatched(segment.conditions as Condition | Condition[], attributes);
}

export function allGroupSegmentsAreMatched(
  groupSegments: GroupSegment | GroupSegment[] | "*",
  attributes: Attributes,
  datafileReader: DatafileReader,
): boolean {
  if (groupSegments === "*") {
    return true;
  }

  if (typeof groupSegments === "string") {
    const segment = datafileReader.getSegment(groupSegments);

    if (segment) {
      return segmentIsMatched(segment, attributes);
    }

    return false;
  }

  if (typeof groupSegments === "object") {
    if ("and" in groupSegments && Array.isArray(groupSegments.and)) {
      return groupSegments.and.every((groupSegment) =>
        allGroupSegmentsAreMatched(groupSegment, attributes, datafileReader),
      );
    }

    if ("or" in groupSegments && Array.isArray(groupSegments.or)) {
      return groupSegments.or.some((groupSegment) =>
        allGroupSegmentsAreMatched(groupSegment, attributes, datafileReader),
      );
    }
  }

  if (Array.isArray(groupSegments)) {
    return groupSegments.every((groupSegment) =>
      allGroupSegmentsAreMatched(groupSegment, attributes, datafileReader),
    );
  }

  return false;
}
