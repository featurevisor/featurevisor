import { Rule, ExistingFeature, Traffic, Variation, Range, Percentage } from "@featurevisor/types";
import { MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";

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
  console.log({ ranges });
  const availableRanges =
    ranges && ranges.length > 0 ? ranges : [{ start: 0, end: MAX_BUCKETED_NUMBER }];

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

    if (existingTrafficRule && !needsRebucketing) {
      // increase: build on top of existing allocations
      traffic.allocation = existingTrafficRule.allocation.map(function ({
        variation,
        percentage,
        range,
      }) {
        return {
          variation,
          percentage, // @TODO remove it in next breaking semver
          range: range || {
            start: 0,
            end: percentage,
          },
        };
      });
    }

    let updatedAvailableRanges = JSON.parse(JSON.stringify(availableRanges));

    variations.forEach(function (variation) {
      const weight = variation.weight as number;
      const percentage = weight * (MAX_BUCKETED_NUMBER / 100);

      let rangesToFill: Range[] = [];
      if (needsRebucketing) {
        rangesToFill = getAllocation(updatedAvailableRanges, percentage * (rulePercentage / 100));
      } else if (existingTrafficRule && rulePercentageDiff > 0) {
        rangesToFill = getAllocation(
          updatedAvailableRanges,
          rulePercentageDiff * (rulePercentage / 100),
        );
      } else {
        // should never happen
        throw new Error("An error occurred while building traffic allocations");
      }

      console.log({
        key: parsedRule.key,
        weight,
        rulePercentage,
        percentage,
        updatedAvailableRanges,
        rangesToFill,
      });

      rangesToFill.forEach(function (range) {
        traffic.allocation.push({
          variation: variation.value,
          percentage: percentage * (rulePercentage / 100), // @TODO remove it in next breaking semver
          range,
        });
      });

      updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(
        updatedAvailableRanges,
        percentage * (rulePercentage / 100),
      );
    });

    result.push(traffic);
  });

  return result;
}

/**
 * @TODO: Old code, remove it soon.
 */
export function getNewTraffic(
  // from current YAML
  variations: Variation[],
  parsedRules: Rule[],

  // from previous release
  existingFeature: ExistingFeature | undefined,

  // ranges from group slots
  ranges?: Range[],
): Traffic[] {
  const result: Traffic[] = [];

  // @TODO: for now we pick first one only. in future, we can pick more,
  // and allow a Feature to exist in multiple slots inside a single Group
  const offset = ranges && ranges.length > 0 ? ranges[0].start : 0;

  parsedRules.forEach((parsedRollout) => {
    const rolloutPercentage = parsedRollout.percentage;

    const traffic: Traffic = {
      key: parsedRollout.key, // @TODO: not needed in datafile. keep it for now
      segments:
        typeof parsedRollout.segments !== "string"
          ? JSON.stringify(parsedRollout.segments)
          : parsedRollout.segments,
      percentage: rolloutPercentage * (MAX_BUCKETED_NUMBER / 100), // @TODO: remove in next breaking semver
      // range: {
      //   start: offset,
      //   end: offset + rolloutPercentage * (MAX_BUCKETED_NUMBER / 100),
      // },
      allocation: [],
    };

    if (parsedRollout.variables) {
      traffic.variables = parsedRollout.variables;
    }

    if (parsedRollout.variation) {
      traffic.variation = parsedRollout.variation;
    }

    const existingTrafficRollout = existingFeature?.traffic.find(
      (t) => t.key === parsedRollout.key,
    );

    // @TODO: handle if Variations changed (added/removed, or weight changed)

    //  - new variation added
    //  - variation removed
    //  - variation weight changed
    //
    // @TODO: make it better by maintaining as much of the previous bucketing as possible
    const variationsChanged = existingFeature
      ? JSON.stringify(
          existingFeature.variations.map(({ value, weight }) => ({
            value,
            weight,
          })),
        ) !== JSON.stringify(variations.map(({ value, weight }) => ({ value, weight })))
      : false;

    let diffPercentage = 0;

    if (existingTrafficRollout) {
      diffPercentage =
        rolloutPercentage - existingTrafficRollout.percentage / (MAX_BUCKETED_NUMBER / 100);

      let rangesChanged = false;
      if (
        ranges &&
        ranges.length > 0 &&
        JSON.stringify(existingFeature ? existingFeature.ranges : undefined) !==
          JSON.stringify(ranges)
      ) {
        rangesChanged = true;
      }

      if (
        diffPercentage > 0 &&
        !variationsChanged && // if variations changed, we need to re-bucket
        !rangesChanged // if ranges changed, we need to re-bucket
      ) {
        // increase: build on top of existing allocations
        traffic.allocation = existingTrafficRollout.allocation.map(
          ({ variation, percentage, range }, allocationIndex) => {
            const isFirstAllocation = allocationIndex === 0;
            const isLastAllocation =
              allocationIndex === existingTrafficRollout.allocation.length - 1;

            const start = isFirstAllocation ? offset : offset + percentage;
            const end = start + percentage;

            return {
              variation,
              percentage, // @TODO: remove in next breaking semver
              range: range
                ? range
                : {
                    start,
                    end,
                  },
            };
          },
        );
      }
    }

    let lastVariationEndPercentage = 0;
    variations.forEach((variation, variationIndex) => {
      const isFirstVariation = variationIndex === 0;

      const newPercentage = parseInt(
        (
          ((variation.weight as number) / 100) *
          rolloutPercentage *
          (MAX_BUCKETED_NUMBER / 100)
        ).toFixed(2),
      );

      const start = isFirstVariation ? offset : lastVariationEndPercentage + 1;
      const end = isFirstVariation ? start + newPercentage : start + newPercentage - 1;

      if (!existingTrafficRollout || variationsChanged === true) {
        traffic.allocation.push({
          variation: variation.value,
          percentage: offset + newPercentage, // @TODO: remove in next breaking semver
          range: {
            start,
            end,
          },
        });

        lastVariationEndPercentage = end;

        return;
      }

      if (diffPercentage === 0) {
        // no change
        traffic.allocation.push({
          variation: variation.value,
          percentage: offset + newPercentage, // @TODO: remove in next breaking semver
          range: {
            start,
            end,
          },
        });

        lastVariationEndPercentage = end;

        return;
      }

      if (diffPercentage > 0) {
        // increase - need to consistently bucket
        const start =
          offset +
          parseInt(
            (
              (variation.weight as number) *
              (diffPercentage / 100) *
              (MAX_BUCKETED_NUMBER / 100)
            ).toFixed(2),
          );
        const end = start + newPercentage; // @TODO: verify this

        traffic.allocation.push({
          variation: variation.value,
          percentage:
            offset +
            parseInt(
              (
                (variation.weight as number) *
                (diffPercentage / 100) *
                (MAX_BUCKETED_NUMBER / 100)
              ).toFixed(2),
            ),
          range: {
            start,
            end,
          },
        });

        lastVariationEndPercentage = end;

        return;
      }

      if (diffPercentage < 0) {
        // decrease - need to re-bucket

        // @TODO: can we maintain as much pre bucketed values as possible? to be close to consistent bucketing?

        traffic.allocation.push({
          variation: variation.value,
          percentage: offset + newPercentage, // @TODO: remove in next breaking semver
          range: {
            start,
            end,
          },
        });

        lastVariationEndPercentage = end;

        return;
      }
    });

    result.push(traffic);
  });

  return result;
}
