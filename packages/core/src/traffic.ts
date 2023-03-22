import { Rule, ExistingFeature, Traffic, Variation } from "@featurevisor/types";
import { MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";

export function getNewTraffic(
  // from current YAML
  variations: Variation[],
  parsedRules: Rule[],

  // from previous release
  existingFeature: ExistingFeature | undefined,
): Traffic[] {
  const result: Traffic[] = [];

  parsedRules.forEach((parsedRollout) => {
    const rolloutPercentage = parsedRollout.percentage;

    const traffic: Traffic = {
      key: parsedRollout.key, // @TODO: not needed in datafile. keep it for now
      segments:
        typeof parsedRollout.segments !== "string"
          ? JSON.stringify(parsedRollout.segments)
          : parsedRollout.segments,
      percentage: rolloutPercentage * (MAX_BUCKETED_NUMBER / 100),
      allocation: [],
    };

    if (parsedRollout.variables) {
      traffic.variables = parsedRollout.variables;
    }

    const existingTrafficRollout = existingFeature?.traffic.find(
      (t) => t.key === parsedRollout.key,
    );

    // @TODO: handle if Variations changed (added/removed, or weight changed)

    //  - new variation added
    //  - variation removed
    //  - variation weight changed
    //
    // make it better by maintaining as much of the previous bucketing as possible
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

      if (
        diffPercentage > 0 &&
        !variationsChanged // if variations changed, we need to re-bucket
      ) {
        // increase: build on top of existing allocations

        traffic.allocation = existingTrafficRollout.allocation.map(({ variation, percentage }) => {
          return {
            variation,
            percentage,
          };
        });
      }
    }

    variations.forEach((variation) => {
      const newPercentage = parseInt(
        (
          ((variation.weight as number) / 100) *
          rolloutPercentage *
          (MAX_BUCKETED_NUMBER / 100)
        ).toFixed(2),
      );

      if (!existingTrafficRollout || variationsChanged === true) {
        traffic.allocation.push({
          variation: variation.value,
          percentage: newPercentage,
        });

        return;
      }

      // const prevTotalWeightForVariation = existingTrafficRollout.allocation
      //   .filter((a) => a.variation === variation.value)
      //   .reduce((acc, curr) => acc + curr.percentage, 0);

      // const diffWeightForVariation = (variation.weight as number) - prevTotalWeightForVariation / (MAX_BUCKETED_NUMBER / 100));

      if (diffPercentage === 0) {
        // no change
        traffic.allocation.push({
          variation: variation.value,
          percentage: newPercentage,
        });

        return;
      }

      if (diffPercentage > 0) {
        // increase - need to consistently bucket
        traffic.allocation.push({
          variation: variation.value,
          percentage: parseInt(
            (
              (variation.weight as number) *
              (diffPercentage / 100) *
              (MAX_BUCKETED_NUMBER / 100)
            ).toFixed(2),
          ),
        });

        return;
      }

      if (diffPercentage < 0) {
        // decrease - need to re-bucket

        // @TODO: can we maintain as much pre bucketed values as possible? to be close to consistent bucketing?

        traffic.allocation.push({
          variation: variation.value,
          percentage: newPercentage,
        });

        return;
      }
    });

    result.push(traffic);
  });

  return result;
}
