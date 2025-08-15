import { Feature, Force, VariableSchema, Traffic, Allocation } from "@featurevisor/types";

import { BucketKey, BucketValue, getBucketKey, getBucketedNumber } from "./bucketer";
import { EvaluateOptions, Evaluation, EvaluationReason } from "./evaluation";

interface EvaluateByBucketingResult {
  evaluation?: Evaluation;
  bucketKey?: BucketKey;
  bucketValue?: BucketValue;
  matchedTraffic?: Traffic;
  matchedAllocation?: Allocation;
}

export function evaluateByBucketing(
  options: EvaluateOptions,
  feature: Feature,
  variableSchema: VariableSchema,
  force: Force | undefined,
): EvaluateByBucketingResult {
  const { type, featureKey, context, variableKey, logger, datafileReader, hooksManager } = options;
  const hooks = hooksManager.getAll();

  // bucketKey
  let bucketKey = getBucketKey({
    featureKey,
    bucketBy: feature.bucketBy,
    context,

    logger,
  });
  for (const hook of hooks) {
    if (hook.bucketKey) {
      bucketKey = hook.bucketKey({
        featureKey,
        context,
        bucketBy: feature.bucketBy,
        bucketKey,
      });
    }
  }

  // bucketValue
  let bucketValue = getBucketedNumber(bucketKey);

  for (const hook of hooks) {
    if (hook.bucketValue) {
      bucketValue = hook.bucketValue({
        featureKey,
        bucketKey,
        context,
        bucketValue,
      });
    }
  }

  let matchedTraffic: Traffic | undefined;
  let matchedAllocation: Allocation | undefined;

  if (type !== "flag") {
    matchedTraffic = datafileReader.getMatchedTraffic(feature.traffic, context);

    if (matchedTraffic) {
      matchedAllocation = datafileReader.getMatchedAllocation(matchedTraffic, bucketValue);
    }
  } else {
    matchedTraffic = datafileReader.getMatchedTraffic(feature.traffic, context);
  }

  const result: EvaluateByBucketingResult = {
    bucketKey,
    bucketValue,
    matchedTraffic,
    matchedAllocation,
  };

  if (matchedTraffic) {
    // percentage: 0
    if (matchedTraffic.percentage === 0) {
      result.evaluation = {
        type,
        featureKey,
        reason: EvaluationReason.RULE,
        bucketKey,
        bucketValue,
        ruleKey: matchedTraffic.key,
        traffic: matchedTraffic,
        enabled: false,
      };

      logger.debug("matched rule with 0 percentage", result.evaluation);

      return result;
    }

    // flag
    if (type === "flag") {
      // flag: check if mutually exclusive
      if (feature.ranges && feature.ranges.length > 0) {
        const matchedRange = feature.ranges.find((range) => {
          return bucketValue >= range[0] && bucketValue < range[1];
        });

        // matched
        if (matchedRange) {
          result.evaluation = {
            type,
            featureKey,
            reason: EvaluationReason.ALLOCATED,
            bucketKey,
            bucketValue,
            ruleKey: matchedTraffic.key,
            traffic: matchedTraffic,
            enabled: typeof matchedTraffic.enabled === "undefined" ? true : matchedTraffic.enabled,
          };

          logger.debug("matched", result.evaluation);

          return result;
        }

        // no match
        result.evaluation = {
          type,
          featureKey,
          reason: EvaluationReason.OUT_OF_RANGE,
          bucketKey,
          bucketValue,
          enabled: false,
        };

        logger.debug("not matched", result.evaluation);

        return result;
      }

      // flag: override from rule
      if (typeof matchedTraffic.enabled !== "undefined") {
        result.evaluation = {
          type,
          featureKey,
          reason: EvaluationReason.RULE,
          bucketKey,
          bucketValue,
          ruleKey: matchedTraffic.key,
          traffic: matchedTraffic,
          enabled: matchedTraffic.enabled,
        };

        logger.debug("override from rule", result.evaluation);

        return result;
      }

      // treated as enabled because of matched traffic
      if (bucketValue <= matchedTraffic.percentage) {
        result.evaluation = {
          type,
          featureKey,
          reason: EvaluationReason.RULE,
          bucketKey,
          bucketValue,
          ruleKey: matchedTraffic.key,
          traffic: matchedTraffic,
          enabled: true,
        };

        logger.debug("matched traffic", result.evaluation);

        return result;
      }
    }

    // variation
    if (type === "variation" && feature.variations) {
      // override from rule
      if (matchedTraffic.variation) {
        const variation = feature.variations.find((v) => v.value === matchedTraffic.variation);

        if (variation) {
          result.evaluation = {
            type,
            featureKey,
            reason: EvaluationReason.RULE,
            bucketKey,
            bucketValue,
            ruleKey: matchedTraffic.key,
            traffic: matchedTraffic,
            variation,
          };

          logger.debug("override from rule", result.evaluation);

          return result;
        }
      }

      // regular allocation
      if (matchedAllocation && matchedAllocation.variation) {
        const variation = feature.variations.find((v) => v.value === matchedAllocation.variation);

        if (variation) {
          result.evaluation = {
            type,
            featureKey,
            reason: EvaluationReason.ALLOCATED,
            bucketKey,
            bucketValue,
            ruleKey: matchedTraffic.key,
            traffic: matchedTraffic,
            variation,
          };

          logger.debug("allocated variation", result.evaluation);

          return result;
        }
      }
    }
  }

  // variable
  if (type === "variable" && variableKey) {
    // override from rule
    if (
      matchedTraffic &&
      matchedTraffic.variables &&
      typeof matchedTraffic.variables[variableKey] !== "undefined"
    ) {
      result.evaluation = {
        type,
        featureKey,
        reason: EvaluationReason.RULE,
        bucketKey,
        bucketValue,
        ruleKey: matchedTraffic.key,
        traffic: matchedTraffic,
        variableKey,
        variableSchema,
        variableValue: matchedTraffic.variables[variableKey],
      };

      logger.debug("override from rule", result.evaluation);

      return result;
    }

    // check variations
    let variationValue;

    if (force && force.variation) {
      variationValue = force.variation;
    } else if (matchedTraffic && matchedTraffic.variation) {
      variationValue = matchedTraffic.variation;
    } else if (matchedAllocation && matchedAllocation.variation) {
      variationValue = matchedAllocation.variation;
    }

    if (variationValue && Array.isArray(feature.variations)) {
      const variation = feature.variations.find((v) => v.value === variationValue);

      if (variation && variation.variableOverrides && variation.variableOverrides[variableKey]) {
        const overrides = variation.variableOverrides[variableKey];

        const override = overrides.find((o) => {
          if (o.conditions) {
            return datafileReader.allConditionsAreMatched(
              typeof o.conditions === "string" && o.conditions !== "*"
                ? JSON.parse(o.conditions)
                : o.conditions,
              context,
            );
          }

          if (o.segments) {
            return datafileReader.allSegmentsAreMatched(
              datafileReader.parseSegmentsIfStringified(o.segments),
              context,
            );
          }

          return false;
        });

        if (override) {
          result.evaluation = {
            type,
            featureKey,
            reason: EvaluationReason.VARIABLE_OVERRIDE,
            bucketKey,
            bucketValue,
            ruleKey: matchedTraffic?.key,
            traffic: matchedTraffic,
            variableKey,
            variableSchema,
            variableValue: override.value,
          };

          logger.debug("variable override", result.evaluation);

          return result;
        }
      }

      if (
        variation &&
        variation.variables &&
        typeof variation.variables[variableKey] !== "undefined"
      ) {
        result.evaluation = {
          type,
          featureKey,
          reason: EvaluationReason.ALLOCATED,
          bucketKey,
          bucketValue,
          ruleKey: matchedTraffic?.key,
          traffic: matchedTraffic,
          variableKey,
          variableSchema,
          variableValue: variation.variables[variableKey],
        };

        logger.debug("allocated variable", result.evaluation);

        return result;
      }
    }
  }

  /**
   * Nothing matched
   */
  if (type === "variation") {
    result.evaluation = {
      type,
      featureKey,
      reason: EvaluationReason.NO_MATCH,
      bucketKey,
      bucketValue,
    };

    logger.debug("no matched variation", result.evaluation);

    return result;
  }

  if (type === "variable") {
    if (variableSchema) {
      result.evaluation = {
        type,
        featureKey,
        reason: EvaluationReason.VARIABLE_DEFAULT,
        bucketKey,
        bucketValue,
        variableKey,
        variableSchema,
        variableValue: variableSchema.defaultValue,
      };

      logger.debug("using default value", result.evaluation);

      return result;
    }

    result.evaluation = {
      type,
      featureKey,
      reason: EvaluationReason.VARIABLE_NOT_FOUND,
      variableKey,
      bucketKey,
      bucketValue,
    };

    logger.debug("variable not found", result.evaluation);

    return result;
  }

  return result;
}
