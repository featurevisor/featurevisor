import type {
  FeatureKey,
  Context,
  RuleKey,
  Traffic,
  Force,
  Conditions,
  StickyVariables,
  Variation,
  VariationValue,
  VariableKey,
  VariableValue,
  ResolvedVariableSchema,
  EvaluatedFeature,
  StickyFeatures,
  Allocation,
  Feature,
  DatafileVariable,
} from "@featurevisor/types";

import type { FeaturevisorModule } from "./modules.js";
import { getBucketKey, getBucketedNumber } from "./bucketer.js";
import type { BucketKey, BucketValue } from "./bucketer.js";
import type { FeaturevisorDiagnosticReporter } from "./diagnostics.js";
import {
  beginEvaluation,
  endEvaluation,
  updateEvaluation,
  DependencyError,
  type DependencyOf,
} from "./session.js";

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export type EvaluationReason =
  | "feature_not_found"
  | "disabled"
  | "no_variations"
  | "variation_disabled"
  | "variable_not_found"
  | "variable_default"
  | "variable_composed"
  | "variable_disabled"
  | "variable_override_variation"
  | "variable_override_rule"
  | "conditions_unmet"
  | "no_match"
  | "forced"
  | "sticky"
  | "rule"
  | "allocated"
  | "error";

export type EvaluationType = "flag" | "variation" | "variable";

export interface ForceResult {
  force?: Force;
  forceIndex?: number;
}

// Private evaluator dependency shape implemented by the main Featurevisor instance.
// Keep this small so ports can mirror the evaluation hot path without exposing
// every stored-datafile helper as public SDK API.
export interface EvaluationDataProvider {
  /** Current membership for a later callback phase. */
  readonly modules: FeaturevisorModule[];
  getFeature(featureKey: FeatureKey): Feature | undefined;
  conditionsAreMatched(conditions: Conditions, dependencies: EvaluateDependencies): boolean;
  getMatchedTraffic(traffic: Traffic[], dependencies: EvaluateDependencies): Traffic | undefined;
  getMatchedForce(
    featureKey: FeatureKey | Feature,
    dependencies: EvaluateDependencies,
  ): ForceResult;
  evaluateRequiredFeature(
    type: "flag" | "variation",
    featureKey: FeatureKey,
    dependencies: EvaluateDependencies,
  ): Evaluation;
}

export interface Evaluation {
  // identity
  type: EvaluationType;
  /** Present for feature evaluations and omitted for global variable evaluations. */
  featureKey?: FeatureKey;
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
  conditions?: Conditions;
  stickyFeature?: EvaluatedFeature;

  // variation
  variation?: Variation;
  variationValue?: VariationValue;

  // variable
  variableKey?: VariableKey;
  variableValue?: VariableValue;
  variableSchema?: ResolvedVariableSchema;
  variableOverrideIndex?: number;
  /** Present when a keyed feature or global variable override matched. */
  variableOverrideKey?: string;
  /** Authored key route when a global variable override matched. */
  variableOverridePath?: string[];
  /** Ordered matched paths in an accumulating global override program, including parent overrides. */
  variableOverridePaths?: string[][];
  /** Present when evaluating a global variable. */
  variable?: DatafileVariable;
}

export interface EvaluateDependencies {
  context: Context;
  /** Immediate requester for an internal dependency, absent on application calls. */
  dependencyOf?: DependencyOf;
  /** Whether the dependency gates eligibility or supplies a consumed composition value. */
  dependencyPurpose?: "condition" | "composition";

  reportDiagnostic: FeaturevisorDiagnosticReporter;
  modules: FeaturevisorModule[];
  datafile: EvaluationDataProvider;

  // OverrideOptions
  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;

  defaultVariationValue?: VariationValue;
  defaultVariableValue?: VariableValue;
}

export interface EvaluateParams {
  type: EvaluationType;
  featureKey: FeatureKey;
  variableKey?: VariableKey;
}

export type EvaluateOptions = EvaluateParams & EvaluateDependencies;

export interface VariableEvaluateOptions {
  type: "variable";
  variableKey: VariableKey;
  context: Context;
  defaultVariableValue?: VariableValue;
  /** Immediate requester for an internal dependency, absent on application calls. */
  dependencyOf?: DependencyOf;
  /** Whether the dependency gates eligibility or supplies a consumed composition value. */
  dependencyPurpose?: "condition" | "composition";
}

export type EvaluationOptions = EvaluateOptions | VariableEvaluateOptions;

function getMatchedAllocation(traffic: Traffic, bucketValue: number): Allocation | undefined {
  if (!traffic.allocation) return undefined;
  for (const allocation of traffic.allocation) {
    const [start, end] = allocation.range;
    if (allocation.range && start <= bucketValue && end >= bucketValue) return allocation;
  }
  return undefined;
}

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
    details: {
      featureKey: evaluation.featureKey,
      variableKey: evaluation.variableKey,
      reason: evaluation.reason,
      evaluation,
    },
    originalError: evaluation.error,
  });
}

function evaluationError(
  options: Pick<EvaluateOptions, "type" | "featureKey" | "variableKey" | "reportDiagnostic">,
  error: unknown,
  report = true,
): Evaluation {
  const { type, featureKey, variableKey, reportDiagnostic } = options;
  const evaluation: Evaluation = {
    type,
    featureKey,
    variableKey,
    reason: "error",
    error: error instanceof Error ? error : new Error(String(error)),
  };
  if (!report) return evaluation;
  reportEvaluationDiagnostic(
    reportDiagnostic,
    evaluation,
    "Error during evaluation",
    "error",
    "evaluation_error",
  );
  return evaluation;
}

export function beforeEvaluation<TOptions extends EvaluationOptions>(
  modules: FeaturevisorModule[],
  options: TOptions,
): TOptions {
  for (const module of modules) {
    if (module.beforeEvaluation) {
      beginEvaluation(options);
      const next = module.beforeEvaluation(options) as TOptions;
      updateEvaluation(options, next);
      options = next;
    }
  }
  return options;
}

export function afterEvaluation(
  modules: FeaturevisorModule[],
  evaluation: Evaluation,
  options: EvaluationOptions,
): Evaluation {
  if (evaluation.error instanceof DependencyError) throw evaluation.error;
  if (
    evaluation.type === "variation" &&
    typeof evaluation.variationValue === "undefined" &&
    typeof evaluation.variation === "undefined" &&
    typeof (options as EvaluateOptions).defaultVariationValue !== "undefined"
  ) {
    evaluation.variationValue = (options as EvaluateOptions).defaultVariationValue;
  }
  if (
    evaluation.type === "variable" &&
    typeof evaluation.variableValue === "undefined" &&
    typeof options.defaultVariableValue !== "undefined"
  ) {
    evaluation.variableValue = options.defaultVariableValue;
  }
  for (const module of modules) {
    if (module.afterEvaluation) evaluation = module.afterEvaluation(evaluation, options);
  }
  return evaluation;
}

export function evaluateWithModules(opts: EvaluateOptions): Evaluation {
  let options = opts;
  try {
    options = beforeEvaluation(opts.modules, opts);
    const evaluation = evaluate(options);
    return afterEvaluation(opts.datafile.modules, evaluation, options);
  } catch (e) {
    // A dependency failure fails the complete public call. Nested getters
    // rethrow it, so only the outermost evaluation reports it.
    return evaluationError(opts, e, !(e instanceof DependencyError && opts.dependencyOf));
  } finally {
    endEvaluation(options);
  }
}

function evaluate(options: EvaluateOptions, flagOnly = false): Evaluation {
  const { featureKey, variableKey, context, reportDiagnostic, datafile, stickyFeatures } = options;
  const type = flagOnly ? "flag" : options.type;

  let evaluation: Evaluation;

  try {
    /**
     * Root flag evaluation
     */
    let flag: Evaluation;
    if (type !== "flag") {
      // needed by variation and variable evaluations
      flag = evaluate(options, true);
      if (flag.error instanceof DependencyError) throw flag.error;

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
            hasOwn(feature.variablesSchema, variableKey)
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
    const stickyFeature =
      stickyFeatures && hasOwn(stickyFeatures, featureKey) ? stickyFeatures[featureKey] : undefined;
    if (stickyFeature) {
      // flag
      if (type === "flag" && typeof stickyFeature.enabled !== "undefined") {
        evaluation = {
          type,
          featureKey,
          reason: "sticky",
          stickyFeature,
          enabled: stickyFeature.enabled,
        };

        reportEvaluationDiagnostic(reportDiagnostic, evaluation, "using sticky enabled");

        return evaluation;
      }

      // variation
      if (type === "variation") {
        const variationValue = stickyFeature.variation;

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
        const variables = stickyFeature.variables;

        if (variables && hasOwn(variables, variableKey)) {
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
        details: { featureKey },
      });
    }

    // variableSchema (from datafile, always resolved)
    let variableSchema: ResolvedVariableSchema | undefined;

    if (variableKey) {
      if (feature.variablesSchema && hasOwn(feature.variablesSchema, variableKey)) {
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
          details: { featureKey, variableKey },
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
    const { force, forceIndex } = datafile.getMatchedForce(feature, options);

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
      if (
        variableKey &&
        force.variables &&
        hasOwn(force.variables, variableKey) &&
        typeof force.variables[variableKey] !== "undefined"
      ) {
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
     * Root gate, after force and before bucketing.
     */
    if (
      type === "flag" &&
      feature.conditions !== undefined &&
      !datafile.conditionsAreMatched(feature.conditions, options)
    ) {
      evaluation = {
        type,
        featureKey,
        enabled: false,
        reason: "conditions_unmet",
        conditions: feature.conditions,
      };
      reportEvaluationDiagnostic(reportDiagnostic, evaluation, "root conditions did not match");
      return evaluation;
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
    for (const module of datafile.modules) {
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

    for (const module of datafile.modules) {
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
      matchedTraffic = datafile.getMatchedTraffic(feature.traffic, options);

      if (matchedTraffic) {
        matchedAllocation = getMatchedAllocation(matchedTraffic, bucketValue);
      }
    } else {
      matchedTraffic = datafile.getMatchedTraffic(feature.traffic, options);
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
        if (
          matchedTraffic.variableOverrides &&
          hasOwn(matchedTraffic.variableOverrides, variableKey)
        ) {
          const overrides = matchedTraffic.variableOverrides[variableKey];

          const overrideIndex = overrides.findIndex(
            (o) =>
              o.conditions !== undefined && datafile.conditionsAreMatched(o.conditions, options),
          );

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
              variableOverrideKey: override.key,
            };

            reportEvaluationDiagnostic(reportDiagnostic, evaluation, "variable override from rule");

            return evaluation;
          }
        }

        // from "variables"
        if (
          matchedTraffic.variables &&
          hasOwn(matchedTraffic.variables, variableKey) &&
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

        if (
          variation &&
          variation.variableOverrides &&
          hasOwn(variation.variableOverrides, variableKey)
        ) {
          const overrides = variation.variableOverrides[variableKey];

          const overrideIndex = overrides.findIndex(
            (o) =>
              o.conditions !== undefined && datafile.conditionsAreMatched(o.conditions, options),
          );

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
              variableOverrideKey: override.key,
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
          hasOwn(variation.variables, variableKey) &&
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
    // afterEvaluation rethrows dependency failures to the enclosing call.
    return evaluationError(
      { type, featureKey, variableKey, reportDiagnostic },
      e,
      !(e instanceof DependencyError),
    );
  }
}
