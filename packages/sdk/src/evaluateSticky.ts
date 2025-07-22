import { EvaluateOptions, Evaluation, EvaluationReason } from "./evaluation";

export function evaluateSticky(options: EvaluateOptions): Evaluation | null {
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
