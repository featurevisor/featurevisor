import { isDeepStrictEqual } from "node:util";
import type { DatafileContent } from "@featurevisor/types";
import type { Evaluation } from "@featurevisor/sdk";
import { FeaturevisorCLIError } from "../error";
import { getEvaluationValue, summarizeEvaluation } from "./explain";
import type { EvaluationExplanation, ExplanationOptions } from "./explain";

/** Check recorded facts, not unobserved selectors or a second evaluation. */
export function assertExplanationMatchesEvaluation(
  evaluation: Evaluation,
  explanation: EvaluationExplanation,
  datafile: DatafileContent,
  options: ExplanationOptions,
): void {
  const mismatches: Array<{
    field: string;
    expected: { available: boolean; value?: unknown };
    actual: { available: boolean; value?: unknown };
  }> = [];
  const describe = (value: unknown) => ({
    available: value !== undefined,
    ...(value !== undefined && { value }),
  });
  const check = (field: string, expected: unknown, actual: unknown) => {
    if (!isDeepStrictEqual(expected, actual)) {
      mismatches.push({ field, expected: describe(expected), actual: describe(actual) });
    }
  };
  const decode = (value: unknown) => {
    if (typeof value !== "string" || !/^[\[{]/.test(value)) return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };
  const checkSelectors = (
    field: string,
    expected:
      | {
          conditions?: unknown;
          segments?: unknown;
          requiredFeatures?: unknown;
        }
      | undefined,
    actual: Record<string, unknown>,
  ) => {
    check(`${field}.conditions`, decode(expected?.conditions), actual.conditions);
    check(`${field}.segments`, decode(expected?.segments), actual.segments);
    check(`${field}.requiredFeatures`, expected?.requiredFeatures, actual.requiredFeatures);
    for (const segment of (actual.segmentDefinitions ?? []) as Array<Record<string, unknown>>) {
      const key = String(segment.key);
      check(
        `${field}.segment.${key}.present`,
        Object.prototype.hasOwnProperty.call(datafile.segments, key),
        segment.present,
      );
      check(
        `${field}.segment.${key}.conditions`,
        decode(datafile.segments[key]?.conditions),
        segment.conditions,
      );
    }
  };
  const featureKey = evaluation.featureKey ?? options.feature;
  const variableKey = evaluation.variableKey ?? options.variable;
  const value = getEvaluationValue(evaluation);
  check("result.type", evaluation.type, explanation.result.type);
  check("result.featureKey", featureKey, explanation.result.featureKey);
  check("result.variableKey", variableKey, explanation.result.variableKey);
  check("result.reason", evaluation.reason, explanation.result.reason);
  check("result.hasValue", value !== undefined, explanation.result.hasValue);
  check("result.value", value, explanation.result.value);
  check("summary", summarizeEvaluation(evaluation), explanation.summary);
  check("source.environment", options.environment || false, explanation.source.environment);
  check("source.set", options.set, explanation.source.set);
  check("source.target", options.target, explanation.source.target);

  const feature = featureKey ? datafile.features[featureKey] : undefined;
  const variable = !featureKey && variableKey ? datafile.variables?.[variableKey] : undefined;
  const schema = evaluation.variableSchema ?? variable;
  const selected =
    variable?.overrides?.[evaluation.variableOverrideIndex ?? -1] ??
    (evaluation.reason === "variable_override_rule" && variableKey
      ? evaluation.traffic?.variableOverrides?.[variableKey]?.[
          evaluation.variableOverrideIndex ?? -1
        ]
      : undefined);

  // These are the concrete sources the explanation attributes the value to.
  // Do not infer a variation override source when the SDK did not report it.
  if (evaluation.reason === "variable_default" && schema) {
    check("definition.defaultValue", value, schema.defaultValue);
  }
  if (evaluation.reason === "variable_disabled" && schema) {
    check("definition.disabledValue", value, schema.disabledValue);
  }
  if (evaluation.reason === "variation_disabled" && feature) {
    check("definition.disabledVariationValue", value, feature.disabledVariationValue);
  }
  if (evaluation.reason === "required_features_unmet" && variable) {
    check(
      "definition.disabledPolicy",
      value,
      variable.useDefaultWhenDisabled ? variable.defaultValue : variable.disabledValue,
    );
  }
  if (
    evaluation.reason === "variable_override_rule" &&
    evaluation.variableOverrideIndex !== undefined &&
    (variable || evaluation.traffic?.variableOverrides?.[variableKey ?? ""])
  ) {
    check("definition.overrideExists", true, selected !== undefined);
  }
  if (selected) {
    check("definition.override.value", value, selected.value);
    check("definition.override.key", evaluation.variableOverrideKey, selected.key);
    if (variable) {
      check(
        "definition.override.path",
        evaluation.variableOverridePath,
        variable.overrides?.[evaluation.variableOverrideIndex ?? -1]?.keyPath,
      );
    }
  }
  if (evaluation.traffic) {
    check("definition.rule.key", evaluation.ruleKey, evaluation.traffic.key);
    if (
      evaluation.reason === "rule" &&
      evaluation.type === "variable" &&
      variableKey &&
      evaluation.traffic.variables &&
      Object.prototype.hasOwnProperty.call(evaluation.traffic.variables, variableKey)
    ) {
      check("definition.rule.variableValue", value, evaluation.traffic.variables[variableKey]);
    }
  }
  if (evaluation.reason === "forced" && evaluation.force) {
    if (evaluation.type === "flag" && evaluation.force.enabled !== undefined) {
      check("definition.force.enabled", value, evaluation.force.enabled);
    } else if (evaluation.type === "variation" && evaluation.force.variation !== undefined) {
      check("definition.force.variation", value, evaluation.force.variation);
    } else if (
      evaluation.type === "variable" &&
      variableKey &&
      evaluation.force.variables &&
      Object.prototype.hasOwnProperty.call(evaluation.force.variables, variableKey)
    ) {
      check("definition.force.variableValue", value, evaluation.force.variables[variableKey]);
    }
  }

  for (const entry of explanation.evidence) {
    const details = entry.details;
    switch (entry.title) {
      case "Returned variation":
        check("evidence.variation.value", value, details.value);
        break;
      case "Bucketing reported by the SDK":
        check("evidence.bucketKey", evaluation.bucketKey, details.bucketKey);
        check("evidence.bucketValue", evaluation.bucketValue, details.bucketValue);
        break;
      case "Matched rule":
        check("evidence.rule.key", evaluation.ruleKey, details.key);
        check("evidence.rule.percentage", evaluation.traffic?.percentage, details.percentage);
        checkSelectors("evidence.rule", evaluation.traffic, details);
        check("evidence.rule.allocation", evaluation.traffic?.allocation, details.allocation);
        break;
      case "Selected force":
        check("evidence.force.index", evaluation.forceIndex, details.index);
        check("evidence.force.enabled", evaluation.force?.enabled, details.enabled);
        check("evidence.force.variation", evaluation.force?.variation, details.variation);
        checkSelectors("evidence.force", evaluation.force, details);
        break;
      case "Selected compiled override selectors":
        checkSelectors("evidence.override", selected, details);
        break;
      case "Variable value policy":
        check("evidence.policy.type", schema?.type, details.type);
        check("evidence.policy.defaultValue", schema?.defaultValue, details.defaultValue);
        check("evidence.policy.disabledValue", schema?.disabledValue, details.disabledValue);
        check(
          "evidence.policy.useDefaultWhenDisabled",
          schema?.useDefaultWhenDisabled,
          details.useDefaultWhenDisabled,
        );
        break;
      case "Declared root requirements (not a per requirement trace)":
        check(
          "evidence.requirements",
          evaluation.requiredFeatures ??
            evaluation.required ??
            variable?.requiredFeatures ??
            feature?.requiredFeatures ??
            feature?.required,
          details.requiredFeatures,
        );
        break;
      case "Selected variable override":
        check("evidence.override.key", evaluation.variableOverrideKey, details.key);
        check("evidence.override.path", evaluation.variableOverridePath, details.path);
        check("evidence.override.index", evaluation.variableOverrideIndex, details.compiledIndex);
        break;
      case "Authored value construction (build time)":
        check("evidence.construction.compiledValue", value, details.compiledValue);
        break;
    }
  }

  if (mismatches.length) {
    const identity = featureKey
      ? `feature "${featureKey}"${variableKey ? ` variable "${variableKey}"` : ""}`
      : `global variable "${variableKey}"`;
    throw new FeaturevisorCLIError(
      `Explanation does not match the SDK evaluation for ${identity} (${evaluation.type}): ${mismatches.map((entry) => entry.field).join(", ")}. No explanation was printed for this evaluation.`,
      {
        code: "evaluation_explanation_mismatch",
        details: {
          featureKey,
          variableKey,
          type: evaluation.type,
          environment: options.environment || false,
          set: options.set,
          target: options.target,
          mismatches,
        },
      },
    );
  }
}
