import { Allocation, Context, Traffic, Feature, Force } from "@featurevisor/types";
import { DatafileReader } from "./datafileReader";
import { allGroupSegmentsAreMatched } from "./segments";
import { allConditionsAreMatched } from "./conditions";
import { Logger } from "./logger";

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

export interface MatchedTrafficAndAllocation {
  matchedTraffic: Traffic | undefined;
  matchedAllocation: Allocation | undefined;
}

export function getMatchedTrafficAndAllocation(
  traffic: Traffic[],
  context: Context,
  bucketValue: number,
  datafileReader: DatafileReader,
  logger: Logger,
): MatchedTrafficAndAllocation {
  let matchedAllocation: Allocation | undefined;

  const matchedTraffic = traffic.find((t) => {
    if (
      !allGroupSegmentsAreMatched(
        typeof t.segments === "string" && t.segments !== "*" ? JSON.parse(t.segments) : t.segments,
        context,
        datafileReader,
      )
    ) {
      return false;
    }

    matchedAllocation = getMatchedAllocation(t, bucketValue);

    if (matchedAllocation) {
      return true;
    }

    return false;
  });

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
