import type {
  Rule,
  ExistingFeature,
  Traffic,
  Variation,
  Range,
  Percentage,
} from "@featurevisor/types";
import { MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";

import { getAllocation, getUpdatedAvailableRangesAfterFilling } from "./allocator";
import { FeaturevisorCLIError } from "../error";

function validateSavedAllocation(
  traffic: ExistingFeature["traffic"][number],
  variations: Variation[],
  feature?: string,
  stateFile?: string,
) {
  const fail = () => {
    throw new FeaturevisorCLIError(
      `Invalid saved variation allocation for feature "${feature || "(unknown)"}", rule "${traffic.key}".${stateFile ? ` State file: ${stateFile}.` : ""} Restore valid allocation state or deliberately rename this rule to create a new allocation. Existing audiences may change when allocating again. See https://featurevisor.com/docs/state-files/#traffic-allocation`,
      {
        code: "invalid_saved_allocation",
        details: { feature, rule: traffic.key, ...(stateFile ? { stateFile } : {}) },
      },
    );
  };
  if (
    !Number.isFinite(traffic.percentage) ||
    traffic.percentage < 0 ||
    traffic.percentage > MAX_BUCKETED_NUMBER
  )
    fail();
  const allocations = traffic.allocation || [];
  if (!Array.isArray(allocations)) fail();
  const ranges = allocations
    .map((allocation) => {
      if (!allocation || typeof allocation !== "object") fail();
      const { variation, range } = allocation;
      if (
        !variations.some(({ value }) => value === variation) ||
        !Array.isArray(range) ||
        range.length !== 2 ||
        !range.every(Number.isFinite) ||
        range[0] < 0 ||
        range[1] > MAX_BUCKETED_NUMBER ||
        range[1] < range[0]
      )
        fail();
      return range;
    })
    .sort((a, b) => a[0] - b[0]);
  let end = 0;
  // Shared endpoints are intentional. Only gaps and overlapping interiors are invalid.
  const tolerance = 1e-8;
  for (const range of ranges) {
    if (Math.abs(range[0] - end) > tolerance) fail();
    end = range[1];
  }
  if (Math.abs(end - traffic.percentage) > tolerance) fail();
}

export function detectIfVariationsChanged(
  yamlVariations: Variation[] | undefined, // as exists in latest YAML
  existingFeature?: ExistingFeature, // from state file
): boolean {
  if (!existingFeature || typeof existingFeature.variations === "undefined") {
    if (Array.isArray(yamlVariations) && yamlVariations.length > 0) {
      // feature did not previously have any variations,
      // but now variations have been added
      return true;
    }

    // variations didn't exist before, and not even now
    return false;
  }

  const checkVariations = Array.isArray(yamlVariations)
    ? JSON.stringify(yamlVariations.map(({ value, weight }) => ({ value, weight })))
    : undefined;

  return (
    JSON.stringify(
      existingFeature.variations.map(({ value, weight }) => ({
        value,
        weight,
      })),
    ) !== checkVariations
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

export function getTraffic(
  // from current YAML
  variations: Variation[] | undefined,
  parsedRules: Rule[],
  // from previous release
  existingFeature: ExistingFeature | undefined,
  featureKey?: string,
  stateFile?: string,
): Traffic[] {
  const result: Traffic[] = [];

  const availableRanges: Range[] = [[0, MAX_BUCKETED_NUMBER]];

  parsedRules.forEach(function (parsedRule) {
    const rulePercentage = parsedRule.percentage; // 0 - 100

    const traffic: Traffic = {
      key: parsedRule.key,
      conditions: parsedRule.conditions,
      percentage: rulePercentage * (MAX_BUCKETED_NUMBER / 100),
      allocation: [],
      variationWeights: parsedRule.variationWeights,
      variableOverrides: parsedRule.variableOverrides,
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

    const needsRebucketing =
      !existingTrafficRule || // new rule
      variationsChanged || // variations changed
      rulePercentageDiff < 0 || // percentage decreased
      // @NOTE: this means, if variationWeights is present, it will always rebucket.
      // worth checking if we can maintain consistent bucketing for this use case as well.
      // but this use case is unlikely to hit in practice because it doesn't matter if the feature itself is 100% rolled out.
      traffic.variationWeights; // variation weights overridden

    let updatedAvailableRanges = JSON.parse(JSON.stringify(availableRanges));

    if (existingTrafficRule && !needsRebucketing && variations?.length && !traffic.variation) {
      validateSavedAllocation(existingTrafficRule, variations, featureKey, stateFile);
    }
    if (existingTrafficRule && existingTrafficRule.allocation && !needsRebucketing) {
      // increase: build on top of existing allocations
      let existingSum = 0;

      traffic.allocation = existingTrafficRule.allocation.map(function ({ variation, range }) {
        const result = {
          variation,
          range: range,
        };

        existingSum += range[1] - range[0];

        return result;
      });

      updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(availableRanges, existingSum);
    }

    if (Array.isArray(variations)) {
      variations.forEach(function (variation) {
        let weight = variation.weight as number;

        if (traffic.variationWeights && traffic.variationWeights[variation.value]) {
          // override weight from rule
          weight = traffic.variationWeights[variation.value];
        }

        const percentage = weight * (MAX_BUCKETED_NUMBER / 100);

        const toFillValue = needsRebucketing
          ? percentage * (rulePercentage / 100) // whole value
          : (weight / 100) * rulePercentageDiff; // incrementing
        const rangesToFill = getAllocation(updatedAvailableRanges, toFillValue);

        rangesToFill.forEach(function (range) {
          if (traffic.allocation) {
            traffic.allocation.push({
              variation: variation.value,
              range,
            });
          }
        });

        updatedAvailableRanges = getUpdatedAvailableRangesAfterFilling(
          updatedAvailableRanges,
          toFillValue,
        );
      });
    }

    if (traffic.allocation) {
      traffic.allocation = traffic.allocation.filter((a) => {
        if (a.range && a.range[0] === a.range[1]) {
          return false;
        }

        return true;
      });

      if (traffic.allocation.length === 0) {
        delete traffic.allocation;
      }
    }

    result.push(traffic);
  });

  return result;
}
