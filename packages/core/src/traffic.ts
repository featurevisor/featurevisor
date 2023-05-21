import {
  Rule,
  ExistingFeature,
  Traffic,
  Variation,
  Range,
  Percentage,
  RangeTuple,
} from "@featurevisor/types";
import { MAX_BUCKETED_NUMBER, getStartEndFromRange } from "@featurevisor/sdk";

import { getAllocation, getUpdatedAvailableRangesAfterFilling } from "./allocator";

export function detectIfVariationsChanged(
  yamlVariations: Variation[], // as exists in latest YAML
  existingFeature?: ExistingFeature, // from state file
): boolean {
  if (!existingFeature) {
    return false;
  }

  return (
    JSON.stringify(
      existingFeature.variations.map(({ value, weight }) => ({
        value,
        weight,
      })),
    ) !== JSON.stringify(yamlVariations.map(({ value, weight }) => ({ value, weight })))
  );
}

export function getRulePercentageDiff(
  trafficPercentage: Percentage, // 0 to 100k
  existingTrafficRule,
): number {
  if (!existingTrafficRule) {
    return 0;
  }

  const existingPercentage = existingTrafficRule.percentage;

  return trafficPercentage - existingPercentage;
}

export function detectIfRangesChanged(
  availableRanges: Range[], // as exists in latest YAML
  existingFeature?: ExistingFeature, // from state file
): boolean {
  if (!existingFeature) {
    return false;
  }

  if (!existingFeature.ranges) {
    return false;
  }

  return JSON.stringify(existingFeature.ranges) !== JSON.stringify(availableRanges);
}

export function getTraffic(
  // from current YAML
  variations: Variation[],
  parsedRules: Rule[],
  // from previous release
  existingFeature: ExistingFeature | undefined,
  // ranges from group slots
  ranges?: Range[],
): Traffic[] {
  const result: Traffic[] = [];

  // @TODO: may be pass from builder directly?
  const availableRanges =
    ranges && ranges.length > 0 ? ranges : ([[0, MAX_BUCKETED_NUMBER]] as RangeTuple[]);

  parsedRules.forEach(function (parsedRule) {
    const rulePercentage = parsedRule.percentage; // 0 - 100

    const traffic: Traffic = {
      key: parsedRule.key, // @TODO: not needed in datafile. keep it for now
      segments:
        typeof parsedRule.segments !== "string"
          ? JSON.stringify(parsedRule.segments)
          : parsedRule.segments,
      percentage: rulePercentage * (MAX_BUCKETED_NUMBER / 100),
      allocation: [],
    };

    // overrides
    if (parsedRule.variables) {
      traffic.variables = parsedRule.variables;
    }

    if (parsedRule.variation) {
      traffic.variation = parsedRule.variation;
    }

    // detect changes
    const variationsChanged = detectIfVariationsChanged(variations, existingFeature);
    const existingTrafficRule = existingFeature?.traffic.find((t) => t.key === parsedRule.key);
    const rulePercentageDiff = getRulePercentageDiff(traffic.percentage, existingTrafficRule);
    const rangesChanged = detectIfRangesChanged(availableRanges, existingFeature);

    const needsRebucketing =
      !existingTrafficRule || // new rule
      variationsChanged || // variations changed
      rulePercentageDiff < 0 || // percentage decreased
      rangesChanged; // belongs to a group, and group ranges changed

    let updatedAvailableRanges = JSON.parse(JSON.stringify(availableRanges));

    let lastEnd = 0;
    if (existingTrafficRule && !needsRebucketing) {
      // increase: build on top of existing allocations
      let existingSum = 0;

      traffic.allocation = existingTrafficRule.allocation.map(function ({
        variation,
        percentage, // @TODO: remove it in next breaking semver
        range,
      }) {
        const result = {
          variation,
          percentage, // @TODO remove it in next breaking semver
          range: range ? getStartEndFromRange(range) : ([lastEnd, percentage] as RangeTuple),
        };

        existingSum += percentage || 0;
        lastEnd = lastEnd + (percentage || 0);

        return result;
      });

      updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, existingSum);
    }

    variations.forEach(function (variation) {
      const weight = variation.weight as number;
      const percentage = weight * (MAX_BUCKETED_NUMBER / 100);

      let toFillValue = needsRebucketing
        ? percentage * (rulePercentage / 100) // whole value
        : (weight / 100) * rulePercentageDiff; // incrementing
      const rangesToFill = getAllocation(updatedAvailableRanges, toFillValue);

      rangesToFill.forEach(function (range) {
        traffic.allocation.push({
          variation: variation.value,
          percentage: toFillValue, // @TODO remove it in next breaking semver
          range,
        });
      });

      updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(
        updatedAvailableRanges,
        toFillValue,
      );
    });

    result.push(traffic);
  });

  return result;
}
