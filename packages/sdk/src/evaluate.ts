import type {
  FeatureKey,
  Context,
  RuleKey,
  Traffic,
  Force,
  Required,
  Variation,
  VariationValue,
  VariableKey,
  VariableValue,
  ResolvedVariableSchema,
  EvaluatedFeature,
  StickyFeatures,
  Allocation,
  Feature,
  Condition,
  GroupSegment,
} from "@featurevisor/types";

import type { FeaturevisorModule } from "./modules.js";
import { BucketKey, BucketValue, getBucketKey, getBucketedNumber } from "./bucketer.js";
import type { FeaturevisorDiagnosticReporter } from "./diagnostics.js";

export type EvaluationReason =
  | "feature_not_found"
  | "disabled"
  | "required"
  | "out_of_range"
  | "no_variations"
  | "variation_disabled"
  | "variable_not_found"
  | "variable_default"
  | "variable_disabled"
  | "variable_override_variation"
  | "variable_override_rule"
  | "no_match"
  | "forced"
  | "sticky"
  | "rule"
  | "allocated"
  | "error";

type EvaluationType = "flag" | "variation" | "variable";

export interface ForceResult {
  force?: Force;
  forceIndex?: number;
}

export interface FeaturevisorDatafile {
  getFeature(featureKey: FeatureKey): Feature | undefined;
  allConditionsAreMatched(conditions: Condition[] | Condition, context: Context): boolean;
  allSegmentsAreMatched(
    groupSegments: GroupSegment | GroupSegment[] | "*",
    context: Context,
  ): boolean;
  getMatchedTraffic(traffic: Traffic[], context: Context): Traffic | undefined;
  getMatchedAllocation(traffic: Traffic, bucketValue: number): Allocation | undefined;
  getMatchedForce(featureKey: FeatureKey | Feature, context: Context): ForceResult;
  parseConditionsIfStringified(conditions: Condition | Condition[]): Condition | Condition[];
  parseSegmentsIfStringified(
    segments: GroupSegment | GroupSegment[],
  ): GroupSegment | GroupSegment[];
}

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
  variableSchema?: ResolvedVariableSchema;
  variableOverrideIndex?: number;
}

export interface EvaluateDependencies {
  context: Context;

  reportDiagnostic: FeaturevisorDiagnosticReporter;
  modules: FeaturevisorModule[];
  datafile: FeaturevisorDatafile;

  // OverrideOptions
  sticky?: StickyFeatures;

  defaultVariationValue?: VariationValue;
  defaultVariableValue?: VariableValue;
}

export interface EvaluateParams {
  type: EvaluationType;
  featureKey: FeatureKey;
  variableKey?: VariableKey;
}

export type EvaluateOptions = EvaluateParams & EvaluateDependencies;

function reportEvaluationDiagnostic(
  reportDiagnostic: FeaturevisorDiagnosticReporter,
  evaluation: Evaluation,
  message: string,
  level: "debug" | "warn" | "error" = "debug",
  code: string = evaluation.reason,
) {
  reportDiagnostic({
    level,
    code,
    message,
    featureKey: evaluation.featureKey,
    variableKey: evaluation.variableKey,
    reason: evaluation.reason,
    evaluation,
    originalError: evaluation.error,
  });
}

export function evaluateWithModules(opts: EvaluateOptions): Evaluation {
  try {
    const { modules } = opts;

    // run before modules
    let options = opts;
    for (const module of modules) {
      if (module.before) {
        options = module.before(options);
      }
    }

    // evaluate
    let evaluation = evaluate(options);

    // default: variation
    if (
      typeof options.defaultVariationValue !== "undefined" &&
      evaluation.type === "variation" &&
      typeof evaluation.variationValue === "undefined" &&
      typeof evaluation.variation === "undefined"
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

    // run after modules
    for (const module of modules) {
      if (module.after) {
        evaluation = module.after(evaluation, options);
      }
    }

    return evaluation;
  } catch (e) {
    const { type, featureKey, variableKey, reportDiagnostic } = opts;

    const evaluation: Evaluation = {
      type,
      featureKey,
      variableKey,
      reason: "error",
      error: e instanceof Error ? e : new Error(String(e)),
    };

    reportEvaluationDiagnostic(
      reportDiagnostic,
      evaluation,
      "Error during evaluation",
      "error",
      "evaluation_error",
    );

    return evaluation;
  }
}

function evaluate(options: EvaluateOptions): Evaluation {
  const { type, featureKey, variableKey, context, reportDiagnostic, datafile, sticky, modules } =
    options;

  let evaluation: Evaluation;

  try {
    /**
     * Root flag evaluation
     */
    let flag: Evaluation;
    if (type !== "flag") {
      // needed by variation and variable evaluations
      flag = evaluate({
        ...options,
        type: "flag",
      });

      if (flag.enabled === false) {
        evaluation = {
          type,
          featureKey,
          reason: "disabled",
        };

        const feature = datafile.getFeature(featureKey);

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
                reason: "variable_disabled",
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
                reason: "variable_default",
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
            reason: "variation_disabled",
            variationValue: feature.disabledVariationValue,
            enabled: false,
          };
        }

        reportEvaluationDiagnostic(reportDiagnostic, evaluation, "feature is disabled");

        return evaluation;
      }
    }

    /**
     * Sticky
     */
    if (sticky && sticky[featureKey]) {
      // flag
      if (type === "flag" && typeof sticky[featureKey].enabled !== "undefined") {
        evaluation = {
          type,
          featureKey,
          reason: "sticky",
          sticky: sticky[featureKey],
          enabled: sticky[featureKey].enabled,
        };

        reportEvaluationDiagnostic(reportDiagnostic, evaluation, "using sticky enabled");

        return evaluation;
      }

      // variation
      if (type === "variation") {
        const variationValue = sticky[featureKey].variation;

        if (typeof variationValue !== "undefined") {
          evaluation = {
            type,
            featureKey,
            reason: "sticky",
            variationValue,
          };

          reportEvaluationDiagnostic(reportDiagnostic, evaluation, "using sticky variation");

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
              reason: "sticky",
              variableKey,
              variableValue: result,
            };

            reportEvaluationDiagnostic(reportDiagnostic, evaluation, "using sticky variable");

            return evaluation;
          }
        }
      }
    }

    /**
     * Feature
     */
    const feature = typeof featureKey === "string" ? datafile.getFeature(featureKey) : featureKey;

    // feature: not found
    if (!feature) {
      evaluation = {
        type,
        featureKey,
        reason: "feature_not_found",
      };

      reportEvaluationDiagnostic(
        reportDiagnostic,
        evaluation,
        "Feature not found",
        "warn",
        "feature_not_found",
      );

      return evaluation;
    }

    // feature: deprecated
    if (type === "flag" && feature.deprecated) {
      reportDiagnostic({
        level: "warn",
        code: "deprecated_feature",
        message: "Feature is deprecated",
        featureKey,
      });
    }

    // variableSchema (from datafile, always resolved)
    let variableSchema: ResolvedVariableSchema | undefined;

    if (variableKey) {
      if (feature.variablesSchema && feature.variablesSchema[variableKey]) {
        variableSchema = feature.variablesSchema[variableKey];
      }

      // variable schema not found
      if (!variableSchema) {
        evaluation = {
          type,
          featureKey,
          reason: "variable_not_found",
          variableKey,
        };

        reportEvaluationDiagnostic(
          reportDiagnostic,
          evaluation,
          "Variable schema not found",
          "warn",
          "variable_not_found",
        );

        return evaluation;
      }

      if (variableSchema.deprecated) {
        reportDiagnostic({
          level: "warn",
          code: "deprecated_variable",
          message: "Variable is deprecated",
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
        reason: "no_variations",
      };

      reportEvaluationDiagnostic(
        reportDiagnostic,
        evaluation,
        "No variations",
        "warn",
        "no_variations",
      );

      return evaluation;
    }

    /**
     * Forced
     */
    const { force, forceIndex } = datafile.getMatchedForce(feature, context);

    if (force) {
      // flag
      if (type === "flag" && typeof force.enabled !== "undefined") {
        evaluation = {
          type,
          featureKey,
          reason: "forced",
          forceIndex,
          force,
          enabled: force.enabled,
        };

        reportEvaluationDiagnostic(reportDiagnostic, evaluation, "forced enabled found");

        return evaluation;
      }

      // variation
      if (type === "variation" && force.variation && feature.variations) {
        const variation = feature.variations.find((v) => v.value === force.variation);

        if (variation) {
          evaluation = {
            type,
            featureKey,
            reason: "forced",
            forceIndex,
            force,
            variation,
          };

          reportEvaluationDiagnostic(reportDiagnostic, evaluation, "forced variation found");

          return evaluation;
        }
      }

      // variable
      if (variableKey && force.variables && typeof force.variables[variableKey] !== "undefined") {
        evaluation = {
          type,
          featureKey,
          reason: "forced",
          forceIndex,
          force,
          variableKey,
          variableSchema,
          variableValue: force.variables[variableKey],
        };

        reportEvaluationDiagnostic(reportDiagnostic, evaluation, "forced variable");

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
          reason: "required",
          required: feature.required,
          enabled: requiredFeaturesAreEnabled,
        };

        reportEvaluationDiagnostic(reportDiagnostic, evaluation, "required features not enabled");

        return evaluation;
      }
    }

    /**
     * Bucketing
     */
    // bucketKey
    let bucketKey = getBucketKey({
      featureKey,
      bucketBy: feature.bucketBy,
      context,

      reportDiagnostic,
    });
    for (const module of modules) {
      if (module.bucketKey) {
        bucketKey = module.bucketKey({
          featureKey,
          context,
          bucketBy: feature.bucketBy,
          bucketKey,
        });
      }
    }

    // bucketValue
    let bucketValue = getBucketedNumber(bucketKey);

    for (const module of modules) {
      if (module.bucketValue) {
        bucketValue = module.bucketValue({
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
      matchedTraffic = datafile.getMatchedTraffic(feature.traffic, context);

      if (matchedTraffic) {
        matchedAllocation = datafile.getMatchedAllocation(matchedTraffic, bucketValue);
      }
    } else {
      matchedTraffic = datafile.getMatchedTraffic(feature.traffic, context);
    }

    if (matchedTraffic) {
      // percentage: 0
      if (matchedTraffic.percentage === 0) {
        evaluation = {
          type,
          featureKey,
          reason: "rule",
          bucketKey,
          bucketValue,
          ruleKey: matchedTraffic.key,
          traffic: matchedTraffic,
          enabled: false,
        };

        reportEvaluationDiagnostic(reportDiagnostic, evaluation, "matched rule with 0 percentage");

        return evaluation;
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
            evaluation = {
              type,
              featureKey,
              reason: "allocated",
              bucketKey,
              bucketValue,
              ruleKey: matchedTraffic.key,
              traffic: matchedTraffic,
              enabled:
                typeof matchedTraffic.enabled === "undefined" ? true : matchedTraffic.enabled,
            };

            reportEvaluationDiagnostic(reportDiagnostic, evaluation, "matched");

            return evaluation;
          }

          // no match
          evaluation = {
            type,
            featureKey,
            reason: "out_of_range",
            bucketKey,
            bucketValue,
            enabled: false,
          };

          reportEvaluationDiagnostic(reportDiagnostic, evaluation, "not matched");

          return evaluation;
        }

        // flag: override from rule
        if (typeof matchedTraffic.enabled !== "undefined") {
          evaluation = {
            type,
            featureKey,
            reason: "rule",
            bucketKey,
            bucketValue,
            ruleKey: matchedTraffic.key,
            traffic: matchedTraffic,
            enabled: matchedTraffic.enabled,
          };

          reportEvaluationDiagnostic(reportDiagnostic, evaluation, "override from rule");

          return evaluation;
        }

        // treated as enabled because of matched traffic
        if (bucketValue <= matchedTraffic.percentage) {
          evaluation = {
            type,
            featureKey,
            reason: "rule",
            bucketKey,
            bucketValue,
            ruleKey: matchedTraffic.key,
            traffic: matchedTraffic,
            enabled: true,
          };

          reportEvaluationDiagnostic(reportDiagnostic, evaluation, "matched traffic");

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
              type,
              featureKey,
              reason: "rule",
              bucketKey,
              bucketValue,
              ruleKey: matchedTraffic.key,
              traffic: matchedTraffic,
              variation,
            };

            reportEvaluationDiagnostic(reportDiagnostic, evaluation, "override from rule");

            return evaluation;
          }
        }

        // regular allocation
        if (matchedAllocation && matchedAllocation.variation) {
          const variation = feature.variations.find((v) => v.value === matchedAllocation.variation);

          if (variation) {
            evaluation = {
              type,
              featureKey,
              reason: "allocated",
              bucketKey,
              bucketValue,
              ruleKey: matchedTraffic.key,
              traffic: matchedTraffic,
              variation,
            };

            reportEvaluationDiagnostic(reportDiagnostic, evaluation, "allocated variation");

            return evaluation;
          }
        }
      }
    }

    // variable
    if (type === "variable" && variableKey) {
      // override from rule
      if (matchedTraffic) {
        // "variableOverrides"
        if (matchedTraffic.variableOverrides && matchedTraffic.variableOverrides[variableKey]) {
          const overrides = matchedTraffic.variableOverrides[variableKey];

          const overrideIndex = overrides.findIndex((o) => {
            if (o.conditions) {
              return datafile.allConditionsAreMatched(
                typeof o.conditions === "string" && o.conditions !== "*"
                  ? JSON.parse(o.conditions)
                  : o.conditions,
                context,
              );
            }

            if (o.segments) {
              return datafile.allSegmentsAreMatched(
                datafile.parseSegmentsIfStringified(o.segments),
                context,
              );
            }

            return false;
          });

          if (overrideIndex !== -1) {
            const override = overrides[overrideIndex];

            evaluation = {
              type,
              featureKey,
              reason: "variable_override_rule",
              bucketKey,
              bucketValue,
              ruleKey: matchedTraffic?.key,
              traffic: matchedTraffic,
              variableKey,
              variableSchema,
              variableValue: override.value,
              variableOverrideIndex: overrideIndex,
            };

            reportEvaluationDiagnostic(reportDiagnostic, evaluation, "variable override from rule");

            return evaluation;
          }
        }

        // from "variables"
        if (
          matchedTraffic.variables &&
          typeof matchedTraffic.variables[variableKey] !== "undefined"
        ) {
          evaluation = {
            type,
            featureKey,
            reason: "rule",
            bucketKey,
            bucketValue,
            ruleKey: matchedTraffic.key,
            traffic: matchedTraffic,
            variableKey,
            variableSchema,
            variableValue: matchedTraffic.variables[variableKey],
          };

          reportEvaluationDiagnostic(reportDiagnostic, evaluation, "override from rule");

          return evaluation;
        }
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

          const overrideIndex = overrides.findIndex((o) => {
            if (o.conditions) {
              return datafile.allConditionsAreMatched(
                typeof o.conditions === "string" && o.conditions !== "*"
                  ? JSON.parse(o.conditions)
                  : o.conditions,
                context,
              );
            }

            if (o.segments) {
              return datafile.allSegmentsAreMatched(
                datafile.parseSegmentsIfStringified(o.segments),
                context,
              );
            }

            return false;
          });

          if (overrideIndex !== -1) {
            const override = overrides[overrideIndex];

            evaluation = {
              type,
              featureKey,
              reason: "variable_override_variation",
              bucketKey,
              bucketValue,
              ruleKey: matchedTraffic?.key,
              traffic: matchedTraffic,
              variableKey,
              variableSchema,
              variableValue: override.value,
              variableOverrideIndex: overrideIndex,
            };

            reportEvaluationDiagnostic(
              reportDiagnostic,
              evaluation,
              "variable override from variation",
            );

            return evaluation;
          }
        }

        if (
          variation &&
          variation.variables &&
          typeof variation.variables[variableKey] !== "undefined"
        ) {
          evaluation = {
            type,
            featureKey,
            reason: "allocated",
            bucketKey,
            bucketValue,
            ruleKey: matchedTraffic?.key,
            traffic: matchedTraffic,
            variableKey,
            variableSchema,
            variableValue: variation.variables[variableKey],
          };

          reportEvaluationDiagnostic(reportDiagnostic, evaluation, "allocated variable");

          return evaluation;
        }
      }
    }

    /**
     * Nothing matched
     */
    if (type === "variation") {
      evaluation = {
        type,
        featureKey,
        reason: "no_match",
        bucketKey,
        bucketValue,
      };

      reportEvaluationDiagnostic(reportDiagnostic, evaluation, "no matched variation");

      return evaluation;
    }

    if (type === "variable") {
      if (variableSchema) {
        evaluation = {
          type,
          featureKey,
          reason: "variable_default",
          bucketKey,
          bucketValue,
          variableKey,
          variableSchema,
          variableValue: variableSchema.defaultValue,
        };

        reportEvaluationDiagnostic(reportDiagnostic, evaluation, "using default value");

        return evaluation;
      }

      evaluation = {
        type,
        featureKey,
        reason: "variable_not_found",
        variableKey,
        bucketKey,
        bucketValue,
      };

      reportEvaluationDiagnostic(reportDiagnostic, evaluation, "variable not found");

      return evaluation;
    }

    evaluation = {
      type,
      featureKey,
      reason: "no_match",
      bucketKey,
      bucketValue,
      enabled: false,
    };

    reportEvaluationDiagnostic(reportDiagnostic, evaluation, "nothing matched");

    return evaluation;
  } catch (e) {
    evaluation = {
      type,
      featureKey,
      variableKey,
      reason: "error",
      error: e instanceof Error ? e : new Error(String(e)),
    };

    reportEvaluationDiagnostic(
      reportDiagnostic,
      evaluation,
      "Error during evaluation",
      "error",
      "evaluation_error",
    );

    return evaluation;
  }
}
