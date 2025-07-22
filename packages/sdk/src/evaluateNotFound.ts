import { Feature, VariableSchema } from "@featurevisor/types";

import { Evaluation, EvaluationReason, EvaluateOptions } from "./evaluation";

interface EvaluateNotFoundResult {
  evaluation?: Evaluation;
  feature?: Feature;
  variableSchema?: VariableSchema;
}

export function evaluateNotFound(options: EvaluateOptions): EvaluateNotFoundResult {
  const { type, featureKey, variableKey, logger, datafileReader } = options;

  const result: EvaluateNotFoundResult = {};

  const feature =
    typeof featureKey === "string" ? datafileReader.getFeature(featureKey) : featureKey;

  // feature: not found
  if (!feature) {
    result.evaluation = {
      type,
      featureKey,
      reason: EvaluationReason.FEATURE_NOT_FOUND,
    };

    logger.warn("feature not found", result.evaluation);

    return result;
  }

  result.feature = feature;

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
      result.evaluation = {
        type,
        featureKey,
        reason: EvaluationReason.VARIABLE_NOT_FOUND,
        variableKey,
      };

      logger.warn("variable schema not found", result.evaluation);

      return result;
    }

    result.variableSchema = variableSchema;

    if (variableSchema.deprecated) {
      logger.warn("variable is deprecated", {
        featureKey,
        variableKey,
      });
    }
  }

  // variation: no variations
  if (type === "variation" && (!feature.variations || feature.variations.length === 0)) {
    result.evaluation = {
      type,
      featureKey,
      reason: EvaluationReason.NO_VARIATIONS,
    };

    logger.warn("no variations", result.evaluation);

    return result;
  }

  return result;
}
