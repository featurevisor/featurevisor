import { Rule, ExistingFeature, Traffic, Variation, Range } from "@featurevisor/types";
import { MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";

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
      range: {
        start: offset,
        end: offset + rolloutPercentage * (MAX_BUCKETED_NUMBER / 100),
      },
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
