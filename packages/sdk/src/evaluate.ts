import type { Feature, VariableSchema } from "@featurevisor/types";

import { EvaluateOptions, Evaluation, EvaluationReason } from "./evaluation";
import { evaluateDisabled } from "./evaluateDisabled";
import { evaluateSticky } from "./evaluateSticky";
import { evaluateNotFound } from "./evaluateNotFound";
import { evaluateForced } from "./evaluateForced";
import { evaluateByBucketing } from "./evaluateByBucketing";

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

function evaluateRequired(options: EvaluateOptions, feature: Feature): Evaluation | null {
  const { type, featureKey, logger } = options;

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

export function evaluate(options: EvaluateOptions): Evaluation {
  const { type, featureKey, variableKey, logger } = options;

  let evaluation: Evaluation;

  try {
    // root
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

    // sticky
    const stickyEvaluation = evaluateSticky(options);
    if (stickyEvaluation) {
      return stickyEvaluation;
    }

    // not found
    const notFoundResult = evaluateNotFound(options);

    if (notFoundResult.evaluation) {
      return notFoundResult.evaluation;
    }

    const feature = notFoundResult.feature as Feature;
    const variableSchema = notFoundResult.variableSchema as VariableSchema;

    // forced
    const forcedResult = evaluateForced(options, feature, variableSchema);
    const { force } = forcedResult;

    if (forcedResult.evaluation) {
      return forcedResult.evaluation;
    }

    // required
    const requiredEvaluation = evaluateRequired(options, feature);
    if (requiredEvaluation) {
      return requiredEvaluation;
    }

    // bucket
    const bucketingResult = evaluateByBucketing(options, feature, variableSchema, force);
    const { bucketKey, bucketValue } = bucketingResult;

    if (bucketingResult.evaluation) {
      return bucketingResult.evaluation;
    }

    // nothing matched
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
