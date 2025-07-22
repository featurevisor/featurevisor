import type {
  FeatureKey,
  Feature,
  Context,
  RuleKey,
  Traffic,
  Force,
  Required,
  Variation,
  VariationValue,
  VariableKey,
  VariableValue,
  VariableSchema,
  EvaluatedFeature,
  StickyFeatures,
  Allocation,
} from "@featurevisor/types";

import { Logger } from "./logger";
import { HooksManager } from "./hooks";
import { DatafileReader } from "./datafileReader";
import { BucketKey, BucketValue, getBucketKey, getBucketedNumber } from "./bucketer";

export enum EvaluationReason {
  // feature specific
  FEATURE_NOT_FOUND = "feature_not_found", // feature is not found in datafile
  DISABLED = "disabled", // feature is disabled
  REQUIRED = "required", // required features are not enabled
  OUT_OF_RANGE = "out_of_range", // out of range when mutually exclusive experiments are involved via Groups

  // variations specific
  NO_VARIATIONS = "no_variations", // feature has no variations
  VARIATION_DISABLED = "variation_disabled", // feature is disabled, and variation's disabledVariationValue is used

  // variable specific
  VARIABLE_NOT_FOUND = "variable_not_found", // variable's schema is not defined in the feature
  VARIABLE_DEFAULT = "variable_default", // default variable value used
  VARIABLE_DISABLED = "variable_disabled", // feature is disabled, and variable's disabledValue is used
  VARIABLE_OVERRIDE = "variable_override", // variable overridden from inside a variation

  // common
  NO_MATCH = "no_match", // no rules matched
  FORCED = "forced", // against a forced rule
  STICKY = "sticky", // against a sticky feature
  RULE = "rule", // against a regular rule
  ALLOCATED = "allocated", // regular allocation based on bucketing

  ERROR = "error", // error
}

type EvaluationType = "flag" | "variation" | "variable";

export interface Evaluation {
  // required
  type: EvaluationType;
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
  sticky?: EvaluatedFeature;

  // variation
  variation?: Variation;
  variationValue?: VariationValue;

  // variable
  variableKey?: VariableKey;
  variableValue?: VariableValue;
  variableSchema?: VariableSchema;
}

export interface EvaluateDependencies {
  context: Context;

  logger: Logger;
  hooksManager: HooksManager;
  datafileReader: DatafileReader;

  // OverrideOptions
  sticky?: StickyFeatures;

  defaultVariationValue?: VariationValue;
  defaultVariableValue?: VariableValue;

  flagEvaluation?: Evaluation;
}

export interface EvaluateParams {
  type: EvaluationType;
  featureKey: FeatureKey;
  variableKey?: VariableKey;
}

export type EvaluateOptions = EvaluateParams & EvaluateDependencies;

export function evaluateWithHooks(opts: EvaluateOptions): Evaluation {
  try {
    const { hooksManager } = opts;
    const hooks = hooksManager.getAll();

    // run before hooks
    let options = opts;
    for (const hook of hooksManager.getAll()) {
      if (hook.before) {
        options = hook.before(options);
      }
    }

    // evaluate
    let evaluation = evaluate(options);

    // default: variation
    if (
      typeof options.defaultVariationValue !== "undefined" &&
      evaluation.type === "variation" &&
      typeof evaluation.variationValue === "undefined"
    ) {
      evaluation.variationValue = options.defaultVariationValue;
    }

    // default: variable
    if (
      typeof options.defaultVariableValue !== "undefined" &&
      evaluation.type === "variable" &&
      typeof evaluation.variableValue === "undefined"
    ) {
      evaluation.variableValue = options.defaultVariableValue;
    }

    // run after hooks
    for (const hook of hooks) {
      if (hook.after) {
        evaluation = hook.after(evaluation, options);
      }
    }

    return evaluation;
  } catch (e) {
    const { type, featureKey, variableKey, logger } = opts;

    const evaluation: Evaluation = {
      type,
      featureKey,
      variableKey,
      reason: EvaluationReason.ERROR,
      error: e,
    };

    logger.error("error during evaluation", evaluation);

    return evaluation;
  }
}

function evaluateDisabled(options: EvaluateOptions, flag: Evaluation): Evaluation | null {
  const { type, featureKey, datafileReader, variableKey, logger } = options;

  if (type !== "flag") {
    let evaluation: Evaluation;

    if (flag.enabled === false) {
      evaluation = {
        type,
        featureKey,
        reason: EvaluationReason.DISABLED,
      };

      const feature = datafileReader.getFeature(featureKey);

      // serve variable default value if feature is disabled (if explicitly specified)
      if (type === "variable") {
        if (
          feature &&
          variableKey &&
          feature.variablesSchema &&
          feature.variablesSchema[variableKey]
        ) {
          const variableSchema = feature.variablesSchema[variableKey];

          if (typeof variableSchema.disabledValue !== "undefined") {
            // disabledValue: <value>
            evaluation = {
              type,
              featureKey,
              reason: EvaluationReason.VARIABLE_DISABLED,
              variableKey,
              variableValue: variableSchema.disabledValue,
              variableSchema,
              enabled: false,
            };
          } else if (variableSchema.useDefaultWhenDisabled) {
            // useDefaultWhenDisabled: true
            evaluation = {
              type,
              featureKey,
              reason: EvaluationReason.VARIABLE_DEFAULT,
              variableKey,
              variableValue: variableSchema.defaultValue,
              variableSchema,
              enabled: false,
            };
          }
        }
      }

      // serve disabled variation value if feature is disabled (if explicitly specified)
      if (type === "variation" && feature && feature.disabledVariationValue) {
        evaluation = {
          type,
          featureKey,
          reason: EvaluationReason.VARIATION_DISABLED,
          variationValue: feature.disabledVariationValue,
          enabled: false,
        };
      }

      logger.debug("feature is disabled", evaluation);

      return evaluation;
    }
  }

  return null;
}

function evaluateSticky(options: EvaluateOptions): Evaluation | null {
  const { type, featureKey, variableKey, sticky, logger } = options;

  if (sticky && sticky[featureKey]) {
    let evaluation: Evaluation;

    // flag
    if (type === "flag" && typeof sticky[featureKey].enabled !== "undefined") {
      evaluation = {
        type,
        featureKey,
        reason: EvaluationReason.STICKY,
        sticky: sticky[featureKey],
        enabled: sticky[featureKey].enabled,
      };

      logger.debug("using sticky enabled", evaluation);

      return evaluation;
    }

    // variation
    if (type === "variation") {
      const variationValue = sticky[featureKey].variation;

      if (typeof variationValue !== "undefined") {
        evaluation = {
          type,
          featureKey,
          reason: EvaluationReason.STICKY,
          variationValue,
        };

        logger.debug("using sticky variation", evaluation);

        return evaluation;
      }
    }

    // variable
    if (variableKey) {
      const variables = sticky[featureKey].variables;

      if (variables) {
        const result = variables[variableKey];

        if (typeof result !== "undefined") {
          evaluation = {
            type,
            featureKey,
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

  return null;
}

interface EvaluateForcedResult {
  evaluation?: Evaluation;
  force?: Force;
  forceIndex?: number;
}

function evaluateForced(
  options: EvaluateOptions,
  feature: Feature,
  variableSchema: VariableSchema | undefined,
): EvaluateForcedResult {
  const { type, featureKey, variableKey, context, logger, datafileReader } = options;

  const { force, forceIndex } = datafileReader.getMatchedForce(feature, context);

  const result: EvaluateForcedResult = {
    force,
    forceIndex,
  };

  if (force) {
    // flag
    if (type === "flag" && typeof force.enabled !== "undefined") {
      result.evaluation = {
        type,
        featureKey,
        reason: EvaluationReason.FORCED,
        forceIndex,
        force,
        enabled: force.enabled,
      };

      logger.debug("forced enabled found", result.evaluation);

      return result;
    }

    // variation
    if (type === "variation" && force.variation && feature.variations) {
      const variation = feature.variations.find((v) => v.value === force.variation);

      if (variation) {
        result.evaluation = {
          type,
          featureKey,
          reason: EvaluationReason.FORCED,
          forceIndex,
          force,
          variation,
        };

        logger.debug("forced variation found", result.evaluation);

        return result;
      }
    }

    // variable
    if (variableKey && force.variables && typeof force.variables[variableKey] !== "undefined") {
      result.evaluation = {
        type,
        featureKey,
        reason: EvaluationReason.FORCED,
        forceIndex,
        force,
        variableKey,
        variableSchema,
        variableValue: force.variables[variableKey],
      };

      logger.debug("forced variable", result.evaluation);

      return result;
    }
  }

  return result;
}

function evaluateRequired(options: EvaluateOptions, feature: Feature): Evaluation | null {
  const { type, featureKey, variableKey, context, logger, datafileReader } = options;

  if (type === "flag" && feature.required && feature.required.length > 0) {
    let evaluation: Evaluation;

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
        ...options,
        type: "flag",
        featureKey: requiredKey,
      });
      const requiredIsEnabled = requiredEvaluation.enabled;

      if (!requiredIsEnabled) {
        return false;
      }

      if (typeof requiredVariation !== "undefined") {
        const requiredVariationEvaluation = evaluate({
          ...options,
          type: "variation",
          featureKey: requiredKey,
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
        type,
        featureKey,
        reason: EvaluationReason.REQUIRED,
        required: feature.required,
        enabled: requiredFeaturesAreEnabled,
      };

      logger.debug("required features not enabled", evaluation);

      return evaluation;
    }
  }

  return null;
}

interface EvaluateByBucketingResult {
  evaluation?: Evaluation;
  bucketKey?: BucketKey;
  bucketValue?: BucketValue;
  matchedTraffic?: Traffic;
  matchedAllocation?: Allocation;
}

function evaluateByBucketing(
  options: EvaluateOptions,
  feature: Feature,
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

export function evaluate(options: EvaluateOptions): Evaluation {
  const { type, featureKey, variableKey, context, logger, datafileReader, sticky, hooksManager } =
    options;

  const hooks = hooksManager.getAll();
  let evaluation: Evaluation;

  try {
    /**
     * Root flag evaluation
     */
    let flag: Evaluation;

    if (type !== "flag") {
      // needed by variation and variable evaluations
      flag =
        options.flagEvaluation ||
        evaluate({
          ...options,
          type: "flag",
        });

      const disabledEvaluation = evaluateDisabled(options, flag);
      if (disabledEvaluation) {
        return disabledEvaluation;
      }
    }

    /**
     * Sticky
     */
    const stickyEvaluation = evaluateSticky(options);
    if (stickyEvaluation) {
      return stickyEvaluation;
    }

    /**
     * Feature
     */
    const feature =
      typeof featureKey === "string" ? datafileReader.getFeature(featureKey) : featureKey;

    // feature: not found
    if (!feature) {
      evaluation = {
        type,
        featureKey,
        reason: EvaluationReason.FEATURE_NOT_FOUND,
      };

      logger.warn("feature not found", evaluation);

      return evaluation;
    }

    // feature: deprecated
    if (type === "flag" && feature.deprecated) {
      logger.warn("feature is deprecated", { featureKey });
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
          type,
          featureKey,
          reason: EvaluationReason.VARIABLE_NOT_FOUND,
          variableKey,
        };

        logger.warn("variable schema not found", evaluation);

        return evaluation;
      }

      if (variableSchema.deprecated) {
        logger.warn("variable is deprecated", {
          featureKey,
          variableKey,
        });
      }
    }

    // variation: no variations
    if (type === "variation" && (!feature.variations || feature.variations.length === 0)) {
      evaluation = {
        type,
        featureKey,
        reason: EvaluationReason.NO_VARIATIONS,
      };

      logger.warn("no variations", evaluation);

      return evaluation;
    }

    /**
     * Forced
     */
    const forcedResult = evaluateForced(options, feature, variableSchema);
    const { force } = forcedResult;

    if (forcedResult.evaluation) {
      return forcedResult.evaluation;
    }

    /**
     * Required
     */
    const requiredEvaluation = evaluateRequired(options, feature);
    if (requiredEvaluation) {
      return requiredEvaluation;
    }

    /**
     * Bucketing
     */
    const bucketingResult = evaluateByBucketing(options, feature, force);
    const { bucketKey, bucketValue } = bucketingResult;

    if (bucketingResult.evaluation) {
      return bucketingResult.evaluation;
    }

    evaluation = {
      type,
      featureKey,
      reason: EvaluationReason.NO_MATCH,
      bucketKey,
      bucketValue,
      enabled: false,
    };

    logger.debug("nothing matched", evaluation);

    return evaluation;
  } catch (e) {
    evaluation = {
      type,
      featureKey,
      variableKey,
      reason: EvaluationReason.ERROR,
      error: e,
    };

    logger.error("error", evaluation);

    return evaluation;
  }
}
