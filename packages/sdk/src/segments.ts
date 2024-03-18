import { Context, GroupSegment, Segment, Condition } from "@featurevisor/types";
import { allConditionsAreMatched } from "./conditions";
import { DatafileReader } from "./datafileReader";
import { Logger } from "./logger";

export function segmentIsMatched(segment: Segment, context: Context, logger: Logger): boolean {
  return allConditionsAreMatched(segment.conditions as Condition | Condition[], context, logger);
}

export function allGroupSegmentsAreMatched(
  groupSegments: GroupSegment | GroupSegment[] | "*",
  context: Context,
  datafileReader: DatafileReader,
  logger: Logger,
): boolean {
  if (groupSegments === "*") {
    return true;
  }

  if (typeof groupSegments === "string") {
    const segment = datafileReader.getSegment(groupSegments);

    if (segment) {
      return segmentIsMatched(segment, context, logger);
    }

    return false;
  }

  if (typeof groupSegments === "object") {
    if ("and" in groupSegments && Array.isArray(groupSegments.and)) {
      return groupSegments.and.every((groupSegment) =>
        allGroupSegmentsAreMatched(groupSegment, context, datafileReader, logger),
      );
    }

    if ("or" in groupSegments && Array.isArray(groupSegments.or)) {
      return groupSegments.or.some((groupSegment) =>
        allGroupSegmentsAreMatched(groupSegment, context, datafileReader, logger),
      );
    }

    if ("not" in groupSegments && Array.isArray(groupSegments.not)) {
      return groupSegments.not.every(
        (groupSegment) =>
          allGroupSegmentsAreMatched(groupSegment, context, datafileReader, logger) === false,
      );
    }
  }

  if (Array.isArray(groupSegments)) {
    return groupSegments.every((groupSegment) =>
      allGroupSegmentsAreMatched(groupSegment, context, datafileReader, logger),
    );
  }

  return false;
}
