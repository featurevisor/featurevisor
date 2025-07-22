import { EvaluateOptions, Evaluation, EvaluationReason } from "./evaluation";

export function evaluateDisabled(options: EvaluateOptions, flag: Evaluation): Evaluation | null {
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
