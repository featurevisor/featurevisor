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

export function parseFromStringifiedSegments(value) {
  if (typeof value === "string" && (value.startsWith("{") || value.startsWith("["))) {
    return JSON.parse(value);
  }

  return value;
}

export function getMatchedTraffic(
  traffic: Traffic[],
  context: Context,
  datafileReader: DatafileReader,
  logger: Logger,
): Traffic | undefined {
  const matchedTraffic = traffic.find((t) => {
    if (
      !allGroupSegmentsAreMatched(
        parseFromStringifiedSegments(t.segments),
        context,
        datafileReader,
        logger,
      )
    ) {
      return false;
    }

    return true;
  });

  if (matchedTraffic && matchedTraffic.percentage > 0) {
    return matchedTraffic;
  }

  return;
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
  const matchedTraffic = traffic.find((t) => {
    return allGroupSegmentsAreMatched(
      parseFromStringifiedSegments(t.segments),
      context,
      datafileReader,
      logger,
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

export interface ForceResult {
  force?: Force;
  forceIndex?: number;
}

export function findForceFromFeature(
  feature: Feature,
  context: Context,
  datafileReader: DatafileReader,
  logger: Logger,
): ForceResult {
  const result: ForceResult = {
    force: undefined,
    forceIndex: undefined,
  };

  if (!feature.force) {
    return result;
  }

  for (let i = 0; i < feature.force.length; i++) {
    const currentForce = feature.force[i];

    if (
      currentForce.conditions &&
      allConditionsAreMatched(currentForce.conditions, context, logger)
    ) {
      result.force = currentForce;
      result.forceIndex = i;
      break;
    }

    if (
      currentForce.segments &&
      allGroupSegmentsAreMatched(currentForce.segments, context, datafileReader, logger)
    ) {
      result.force = currentForce;
      result.forceIndex = i;
      break;
    }
  }

  return result;
}
