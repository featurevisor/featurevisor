import {
  Feature,
  FeatureKey,
  Context,
  BucketKey,
  BucketValue,
  RuleKey,
  Traffic,
  Force,
  Required,
  OverrideFeature,
  Variation,
  VariationValue,
  VariableKey,
  VariableValue,
  VariableSchema,
  StickyFeatures,
  InitialFeatures,
  Allocation,
} from "@featurevisor/types";

import { Logger } from "./logger";
import { DatafileReader } from "./datafileReader";
import { getBucket, ConfigureBucketKey, ConfigureBucketValue } from "./bucket";
import {
  getMatchedTraffic,
  getMatchedTrafficAndAllocation,
  findForceFromFeature,
  parseFromStringifiedSegments,
} from "./feature";
import { allConditionsAreMatched } from "./conditions";
import { allGroupSegmentsAreMatched } from "./segments";
import type { Statuses, InterceptContext } from "./instance";

export enum EvaluationReason {
  NOT_FOUND = "not_found",
  NO_VARIATIONS = "no_variations",
  NO_MATCH = "no_match",
  DISABLED = "disabled",
  REQUIRED = "required",
  OUT_OF_RANGE = "out_of_range",
  FORCED = "forced",
  INITIAL = "initial",
  STICKY = "sticky",
  RULE = "rule",
  ALLOCATED = "allocated",
  DEFAULTED = "defaulted",
  OVERRIDE = "override",
  ERROR = "error",
}

type EvaluationType = "flag" | "variation" | "variable";

export interface Evaluation {
  // required
  // type: EvaluationType; // @TODO: bring in later
  featureKey: FeatureKey;
  reason: EvaluationReason;

  // common
  bucketKey?: BucketKey;
  bucketValue?: BucketValue;
  ruleKey?: RuleKey;
  error?: Error;
  enabled?: boolean;
  traffic?: Traffic;
  forceIndex?: number;
  force?: Force;
  required?: Required[];
  sticky?: OverrideFeature;
  initial?: OverrideFeature;

  // variation
  variation?: Variation;
  variationValue?: VariationValue;

  // variable
  variableKey?: VariableKey;
  variableValue?: VariableValue;
  variableSchema?: VariableSchema;
}

export interface EvaluateOptions {
  type: EvaluationType;

  featureKey: FeatureKey | Feature;
  variableKey?: VariableKey;
  context: Context;

  logger: Logger;
  datafileReader: DatafileReader;
  statuses?: Statuses;
  interceptContext?: InterceptContext;

  stickyFeatures?: StickyFeatures;
  initialFeatures?: InitialFeatures;

  bucketKeySeparator?: string;
  configureBucketKey?: ConfigureBucketKey;
  configureBucketValue?: ConfigureBucketValue;
}

export function evaluate(options: EvaluateOptions): Evaluation {
  let evaluation: Evaluation;
  const {
    type,
    featureKey,
    variableKey,
    context,
    logger,
    datafileReader,
    statuses,
    stickyFeatures,
    initialFeatures,
    interceptContext,
    bucketKeySeparator,
    configureBucketKey,
    configureBucketValue,
  } = options;

  try {
    const key = typeof featureKey === "string" ? featureKey : featureKey.key;

    /**
     * Root flag evaluation
     */
    let flag: Evaluation;
    if (type !== "flag") {
      // needed by variation and variable evaluations
      flag = evaluate({
        type: "flag",
        featureKey: key,
        context,
        logger,
        datafileReader,
        statuses,
        stickyFeatures,
        initialFeatures,
        bucketKeySeparator,
        configureBucketKey,
        configureBucketValue,
      });

      if (flag.enabled === false) {
        evaluation = {
          featureKey: key,
          reason: EvaluationReason.DISABLED,
        };

        logger.debug("feature is disabled", evaluation);

        return evaluation;
      }
    }

    /**
     * Sticky
     */
    if (stickyFeatures && stickyFeatures[key]) {
      // flag
      if (type === "flag" && typeof stickyFeatures[key].enabled !== "undefined") {
        evaluation = {
          featureKey: key,
          reason: EvaluationReason.STICKY,
          sticky: stickyFeatures[key],
          enabled: stickyFeatures[key].enabled,
        };

        logger.debug("using sticky enabled", evaluation);

        return evaluation;
      }

      // variation
      if (type === "variation") {
        const variationValue = stickyFeatures[key].variation;

        if (typeof variationValue !== "undefined") {
          evaluation = {
            featureKey: key,
            reason: EvaluationReason.STICKY,
            variationValue,
          };

          logger.debug("using sticky variation", evaluation);

          return evaluation;
        }
      }

      // variable
      if (variableKey) {
        const variables = stickyFeatures[key].variables;

        if (variables) {
          const result = variables[variableKey];

          if (typeof result !== "undefined") {
            evaluation = {
              featureKey: key,
              reason: EvaluationReason.STICKY,
              variableKey,
              variableValue: result,
            };

            logger.debug("using sticky variable", evaluation);

            return evaluation;
          }
        }
      }
    }

    /**
     * Initial
     */
    if (statuses && !statuses.ready && initialFeatures && initialFeatures[key]) {
      // flag
      if (type === "flag" && typeof initialFeatures[key].enabled !== "undefined") {
        evaluation = {
          featureKey: key,
          reason: EvaluationReason.INITIAL,
          initial: initialFeatures[key],
          enabled: initialFeatures[key].enabled,
        };

        logger.debug("using initial enabled", evaluation);

        return evaluation;
      }

      // variation
      if (type === "variation" && typeof initialFeatures[key].variation !== "undefined") {
        const variationValue = initialFeatures[key].variation;

        evaluation = {
          featureKey: key,
          reason: EvaluationReason.INITIAL,
          variationValue,
        };

        logger.debug("using initial variation", evaluation);

        return evaluation;
      }

      // variable
      if (variableKey) {
        const variables = initialFeatures[key].variables;

        if (variables) {
          if (typeof variables[variableKey] !== "undefined") {
            evaluation = {
              featureKey: key,
              reason: EvaluationReason.INITIAL,
              variableKey,
              variableValue: variables[variableKey],
            };

            logger.debug("using initial variable", evaluation);

            return evaluation;
          }
        }
      }
    }

    /**
     * Feature
     */
    const feature =
      typeof featureKey === "string" ? datafileReader.getFeature(featureKey) : featureKey;

    // feature: not found
    if (!feature) {
      evaluation = {
        featureKey: key,
        reason: EvaluationReason.NOT_FOUND, // @TODO: make it type-specific
      };

      logger.warn("feature not found", evaluation);

      return evaluation;
    }

    // feature: deprecated
    if (type === "flag" && feature.deprecated) {
      logger.warn("feature is deprecated", { featureKey: feature.key });
    }

    // variableSchema
    let variableSchema: VariableSchema | undefined;

    if (variableKey) {
      if (feature.variablesSchema && feature.variablesSchema[variableKey]) {
        variableSchema = feature.variablesSchema[variableKey];
      }

      // variable schema not found
      if (!variableSchema) {
        evaluation = {
          featureKey: key,
          reason: EvaluationReason.NOT_FOUND,
          variableKey,
        };

        logger.warn("variable schema not found", evaluation);

        return evaluation;
      }
    }

    // variation: no variations
    if (type === "variation" && (!feature.variations || feature.variations.length === 0)) {
      evaluation = {
        featureKey: key,
        reason: EvaluationReason.NO_VARIATIONS,
      };

      logger.warn("no variations", evaluation);

      return evaluation;
    }

    const finalContext = interceptContext ? interceptContext(context) : context;

    /**
     * Forced
     */
    const { force, forceIndex } = findForceFromFeature(feature, context, datafileReader, logger);

    if (force) {
      // flag
      if (type === "flag" && typeof force.enabled !== "undefined") {
        evaluation = {
          featureKey: feature.key,
          reason: EvaluationReason.FORCED,
          forceIndex,
          force,
          enabled: force.enabled,
        };

        logger.debug("forced enabled found", evaluation);

        return evaluation;
      }

      // variation
      if (type === "variation" && force.variation && feature.variations) {
        const variation = feature.variations.find((v) => v.value === force.variation);

        if (variation) {
          evaluation = {
            featureKey: feature.key,
            reason: EvaluationReason.FORCED,
            forceIndex,
            force,
            variation,
          };

          logger.debug("forced variation found", evaluation);

          return evaluation;
        }
      }

      // variable
      if (variableKey && force.variables && typeof force.variables[variableKey] !== "undefined") {
        evaluation = {
          featureKey: feature.key,
          reason: EvaluationReason.FORCED,
          forceIndex,
          force,
          variableKey,
          variableSchema,
          variableValue: force.variables[variableKey],
        };

        logger.debug("forced variable", evaluation);

        return evaluation;
      }
    }

    /**
     * Required
     */
    if (type === "flag" && feature.required && feature.required.length > 0) {
      const requiredFeaturesAreEnabled = feature.required.every((required) => {
        let requiredKey;
        let requiredVariation;

        if (typeof required === "string") {
          requiredKey = required;
        } else {
          requiredKey = required.key;
          requiredVariation = required.variation;
        }

        const requiredEvaluation = evaluate({
          type: "flag",
          featureKey: requiredKey,
          context: finalContext,
          logger,
          datafileReader,
          statuses,
          stickyFeatures,
          initialFeatures,
          bucketKeySeparator,
          configureBucketKey,
          configureBucketValue,
        });
        const requiredIsEnabled = requiredEvaluation.enabled;

        if (!requiredIsEnabled) {
          return false;
        }

        if (typeof requiredVariation !== "undefined") {
          const requiredVariationEvaluation = evaluate({
            type: "variation",
            featureKey: requiredKey,
            context: finalContext,
            logger,
            datafileReader,
            statuses,
            stickyFeatures,
            initialFeatures,
            bucketKeySeparator,
            configureBucketKey,
            configureBucketValue,
          });

          let requiredVariationValue;

          if (requiredVariationEvaluation.variationValue) {
            requiredVariationValue = requiredVariationEvaluation.variationValue;
          } else if (requiredVariationEvaluation.variation) {
            requiredVariationValue = requiredVariationEvaluation.variation.value;
          }

          return requiredVariationValue === requiredVariation;
        }

        return true;
      });

      if (!requiredFeaturesAreEnabled) {
        evaluation = {
          featureKey: feature.key,
          reason: EvaluationReason.REQUIRED,
          required: feature.required,
          enabled: requiredFeaturesAreEnabled,
        };

        logger.debug("required features not enabled", evaluation);

        return evaluation;
      }
    }

    /**
     * Bucketing
     */
    const { bucketKey, bucketValue } = getBucket({
      feature,
      context: finalContext,
      logger,
      bucketKeySeparator,
      configureBucketKey,
      configureBucketValue,
    });

    let matchedTraffic: Traffic | undefined;
    let matchedAllocation: Allocation | undefined;

    if (type !== "flag") {
      const matched = getMatchedTrafficAndAllocation(
        feature.traffic,
        finalContext,
        bucketValue,
        datafileReader,
        logger,
      );

      matchedTraffic = matched.matchedTraffic;
      matchedAllocation = matched.matchedAllocation;
    } else {
      matchedTraffic = getMatchedTraffic(feature.traffic, finalContext, datafileReader, logger);
    }

    if (matchedTraffic) {
      // flag
      if (type === "flag") {
        // flag: check if mutually exclusive
        if (feature.ranges && feature.ranges.length > 0) {
          const matchedRange = feature.ranges.find((range) => {
            return bucketValue >= range[0] && bucketValue < range[1];
          });

          // matched
          if (matchedRange) {
            evaluation = {
              featureKey: feature.key,
              reason: EvaluationReason.ALLOCATED,
              bucketKey,
              bucketValue,
              ruleKey: matchedTraffic.key,
              traffic: matchedTraffic,
              enabled:
                typeof matchedTraffic.enabled === "undefined" ? true : matchedTraffic.enabled,
            };

            logger.debug("matched", evaluation);

            return evaluation;
          }

          // no match
          evaluation = {
            featureKey: feature.key,
            reason: EvaluationReason.OUT_OF_RANGE,
            bucketKey,
            bucketValue,
            enabled: false,
          };

          logger.debug("not matched", evaluation);

          return evaluation;
        }

        // flag: override from rule
        if (typeof matchedTraffic.enabled !== "undefined") {
          evaluation = {
            featureKey: feature.key,
            reason: EvaluationReason.OVERRIDE,
            bucketKey,
            bucketValue,
            ruleKey: matchedTraffic.key,
            traffic: matchedTraffic,
            enabled: matchedTraffic.enabled,
          };

          logger.debug("override from rule", evaluation);

          return evaluation;
        }

        // treated as enabled because of matched traffic
        if (bucketValue <= matchedTraffic.percentage) {
          evaluation = {
            featureKey: feature.key,
            reason: EvaluationReason.RULE,
            bucketKey,
            bucketValue,
            ruleKey: matchedTraffic.key,
            traffic: matchedTraffic,
            enabled: true,
          };

          logger.debug("matched traffic", evaluation);

          return evaluation;
        }
      }

      // variation
      if (type === "variation" && feature.variations) {
        // override from rule
        if (matchedTraffic.variation) {
          const variation = feature.variations.find((v) => v.value === matchedTraffic.variation);

          if (variation) {
            evaluation = {
              featureKey: feature.key,
              reason: EvaluationReason.RULE,
              bucketKey,
              bucketValue,
              ruleKey: matchedTraffic.key,
              traffic: matchedTraffic,
              variation,
            };

            logger.debug("override from rule", evaluation);

            return evaluation;
          }
        }

        // regular allocation
        if (matchedAllocation && matchedAllocation.variation) {
          const variation = feature.variations.find((v) => v.value === matchedAllocation.variation);

          if (variation) {
            evaluation = {
              featureKey: feature.key,
              reason: EvaluationReason.ALLOCATED,
              bucketKey,
              bucketValue,
              ruleKey: matchedTraffic.key,
              traffic: matchedTraffic,
              variation,
            };

            logger.debug("allocated variation", evaluation);

            return evaluation;
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
        evaluation = {
          featureKey: feature.key,
          reason: EvaluationReason.RULE,
          bucketKey,
          bucketValue,
          ruleKey: matchedTraffic.key,
          traffic: matchedTraffic,
          variableKey,
          variableSchema,
          variableValue: matchedTraffic.variables[variableKey],
        };

        logger.debug("override from rule", evaluation);

        return evaluation;
      }

      // check variations
      let variationValue;

      if (force && force.variation) {
        variationValue = force.variation;
      } else if (matchedAllocation && matchedAllocation.variation) {
        variationValue = matchedAllocation.variation;
      }

      if (variationValue && Array.isArray(feature.variations)) {
        const variation = feature.variations.find((v) => v.value === variationValue);

        if (variation && variation.variables) {
          const variableFromVariation = variation.variables.find((v) => v.key === variableKey);

          if (variableFromVariation) {
            if (variableFromVariation.overrides) {
              const override = variableFromVariation.overrides.find((o) => {
                if (o.conditions) {
                  return allConditionsAreMatched(
                    typeof o.conditions === "string" ? JSON.parse(o.conditions) : o.conditions,
                    finalContext,
                    logger,
                  );
                }

                if (o.segments) {
                  return allGroupSegmentsAreMatched(
                    parseFromStringifiedSegments(o.segments),
                    finalContext,
                    datafileReader,
                    logger,
                  );
                }

                return false;
              });

              if (override) {
                evaluation = {
                  featureKey: feature.key,
                  reason: EvaluationReason.OVERRIDE,
                  bucketKey,
                  bucketValue,
                  ruleKey: matchedTraffic?.key,
                  traffic: matchedTraffic,
                  variableKey,
                  variableSchema,
                  variableValue: override.value,
                };

                logger.debug("variable override", evaluation);

                return evaluation;
              }
            }

            if (typeof variableFromVariation.value !== "undefined") {
              evaluation = {
                featureKey: feature.key,
                reason: EvaluationReason.ALLOCATED,
                bucketKey,
                bucketValue,
                ruleKey: matchedTraffic?.key,
                traffic: matchedTraffic,
                variableKey,
                variableSchema,
                variableValue: variableFromVariation.value,
              };

              logger.debug("allocated variable", evaluation);

              return evaluation;
            }
          }
        }
      }
    }

    /**
     * Nothing matched
     */
    if (type === "variation") {
      evaluation = {
        featureKey: feature.key,
        reason: EvaluationReason.NO_MATCH,
        bucketKey,
        bucketValue,
      };

      logger.debug("no matched variation", evaluation);

      return evaluation;
    }

    if (type === "variable" && variableSchema) {
      evaluation = {
        featureKey: feature.key,
        reason: EvaluationReason.DEFAULTED,
        bucketKey,
        bucketValue,
        variableKey,
        variableSchema,
        variableValue: variableSchema.defaultValue,
      };

      logger.debug("using default value", evaluation);

      return evaluation;
    }

    evaluation = {
      featureKey: feature.key,
      reason: EvaluationReason.NO_MATCH,
      bucketKey,
      bucketValue,
      enabled: false,
    };

    logger.debug("nothing matched", evaluation);

    return evaluation;
  } catch (e) {
    evaluation = {
      featureKey: typeof featureKey === "string" ? featureKey : featureKey.key,
      reason: EvaluationReason.ERROR,
      error: e,
    };

    logger.error("error", evaluation);

    return evaluation;
  }
}
