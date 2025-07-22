import { Feature, Force, VariableSchema } from "@featurevisor/types";

import { Evaluation, EvaluationReason, EvaluateOptions } from "./evaluation";

interface EvaluateForcedResult {
  evaluation?: Evaluation;
  force?: Force;
  forceIndex?: number;
}

export function evaluateForced(
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
