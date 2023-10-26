import { Allocation, Context, Traffic, Feature, Force } from "@featurevisor/types";
import { DatafileReader } from "./datafileReader";
import { allGroupSegmentsAreMatched } from "./segments";
import { allConditionsAreMatched } from "./conditions";

export function getMatchedAllocation(
  traffic: Traffic,
  bucketValue: number,
): Allocation | undefined {
  for (const allocation of traffic.allocation) {
    const [start, end] = allocation.range;

    if (allocation.range && start <= bucketValue && end >= bucketValue) {
      return allocation;
    }
  }

  return undefined;
}

function parseFromStringifiedSegments(value) {
  if (typeof value === "string" && (value.startsWith("{") || value.startsWith("["))) {
    return JSON.parse(value);
  }

  return value;
}

export function getMatchedTraffic(
  traffic: Traffic[],
  context: Context,
  datafileReader: DatafileReader,
): Traffic | undefined {
  return traffic.find((t) => {
    if (
      !allGroupSegmentsAreMatched(parseFromStringifiedSegments(t.segments), context, datafileReader)
    ) {
      return false;
    }

    return true;
  });
}

export interface MatchedTrafficAndAllocation {
  matchedTraffic: Traffic | undefined;
  matchedAllocation: Allocation | undefined;
}

export function getMatchedTrafficAndAllocation(
  traffic: Traffic[],
  context: Context,
  bucketValue: number,
  datafileReader: DatafileReader,
): MatchedTrafficAndAllocation {
  const matchedTraffic = traffic.find((t) => {
    return allGroupSegmentsAreMatched(
      parseFromStringifiedSegments(t.segments),
      context,
      datafileReader,
    );
  });

  if (!matchedTraffic) {
    return {
      matchedTraffic: undefined,
      matchedAllocation: undefined,
    };
  }

  const matchedAllocation = getMatchedAllocation(matchedTraffic, bucketValue);

  return {
    matchedTraffic,
    matchedAllocation,
  };
}

export function findForceFromFeature(
  feature: Feature,
  context: Context,
  datafileReader: DatafileReader,
): Force | undefined {
  if (!feature.force) {
    return undefined;
  }

  return feature.force.find((f: Force) => {
    if (f.conditions) {
      return allConditionsAreMatched(f.conditions, context);
    }

    if (f.segments) {
      return allGroupSegmentsAreMatched(f.segments, context, datafileReader);
    }

    return false;
  });
}
