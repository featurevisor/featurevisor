import { isDeepStrictEqual } from "node:util";
import type {
  DatafileContent,
  DatafileVariableOverrideStep,
  VariableValue,
} from "@featurevisor/types";
import { applyVariableOperations } from "@featurevisor/sdk";
import type { Evaluation } from "@featurevisor/sdk";
import { FeaturevisorCLIError } from "../error";
import {
  getCompositionSourceKind,
  getEvaluationValue,
  getRolloutBoundary,
  ROLLOUT_BOUNDARY_TITLE,
  summarizeEvaluation,
} from "./explain";
import type { EvaluationExplanation, ExplanationOptions } from "./explain";

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function stepPath(step: DatafileVariableOverrideStep): string[] {
  return step.keyPath || [step.key];
}

function validJump(
  program: DatafileVariableOverrideStep[],
  index: number,
  target: unknown,
): boolean {
  return (
    Number.isInteger(target) && (target as number) > index && (target as number) <= program.length
  );
}

/** Follow only recorded misses. Match predicates must never be replayed by explain validation. */
function reachesByMisses(
  program: DatafileVariableOverrideStep[],
  start: number,
  target: number,
): boolean {
  const visited = new Set<number>();
  let index = start;
  while (index < program.length && !visited.has(index)) {
    if (index === target) return true;
    visited.add(index);
    const next = program[index].onMiss;
    if (!validJump(program, index, next)) return false;
    index = next;
  }
  return false;
}

function programStepDetails(
  program: DatafileVariableOverrideStep[],
  path: string[],
): Record<string, unknown> {
  const index = program.findIndex((step) => samePath(stepPath(step), path));
  if (index === -1) return { path, presentInProgram: false };
  const step = program[index];
  return {
    index,
    key: step.key,
    path: stepPath(step),
    operations: step.operations,
    onMatch: step.onMatch,
    onMiss: step.onMiss,
  };
}

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
        }
      | undefined,
    actual: Record<string, unknown>,
  ) => {
    check(`${field}.conditions`, decode(expected?.conditions), actual.conditions);
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
  const compositionEvidence = explanation.evidence.filter(
    (entry) => entry.title === "Composition members" || entry.title === "Composition source",
  );
  check(
    "evidence.composition.count",
    evaluation.type === "variable" && variable?.compose && evaluation.reason !== "conditions_unmet"
      ? 1
      : 0,
    compositionEvidence.length,
  );
  if (evaluation.reason === "variable_composed") {
    check("definition.compose", true, !!variable?.compose);
  }
  if (
    evaluation.type === "variable" &&
    variable?.compose &&
    evaluation.reason !== "conditions_unmet"
  ) {
    const isAlias = typeof variable.compose === "string";
    check(
      "evidence.composition.title",
      isAlias ? "Composition source" : "Composition members",
      compositionEvidence[0]?.title,
    );
    check("evidence.composition.basis", "sdk-result", compositionEvidence[0]?.basis);
    check(
      "evidence.composition.afterOverrides",
      evaluation.reason === "variable_override_rule",
      compositionEvidence[0]?.details.afterOverrides,
    );
    if (typeof variable.compose === "string") {
      const source = { variable: variable.compose };
      check("evidence.composition.source", source, compositionEvidence[0]?.details.source);
      check(
        "evidence.composition.sourceKind",
        getCompositionSourceKind(source, datafile),
        compositionEvidence[0]?.details.sourceKind,
      );
      check(
        "evidence.composition.hasValue",
        value !== undefined,
        compositionEvidence[0]?.details.hasValue,
      );
      check("evidence.composition.value", value, compositionEvidence[0]?.details.value);
      check("evidence.composition.members", undefined, compositionEvidence[0]?.details.members);
    } else {
      check(
        "evidence.composition.members",
        variable.compose.map(({ key, ...source }) => ({
          property: key,
          source,
          sourceKind: getCompositionSourceKind(source, datafile),
          hasValue:
            value !== null &&
            typeof value === "object" &&
            Object.prototype.hasOwnProperty.call(value, key),
          value:
            value !== null && typeof value === "object"
              ? (value as Record<string, unknown>)[key]
              : undefined,
        })),
        compositionEvidence[0]?.details.members,
      );
    }
  }
  const probeTitle = "Supplementary CLI condition probe (not an execution trace)";
  const probeEvidence = explanation.evidence.filter((entry) => entry.title === probeTitle);
  check("evidence.cliProbe.count", options.conditionsProbe ? 1 : 0, probeEvidence.length);
  if (options.conditionsProbe) {
    check("evidence.cliProbe.basis", "cli-probe", probeEvidence[0]?.basis);
    // Probe evidence is JSON output. Normalise SDK-returned object prototypes
    // before comparing the independently copied presentation tree.
    check(
      "evidence.cliProbe.details",
      JSON.parse(JSON.stringify(options.conditionsProbe)),
      probeEvidence[0]?.details === undefined
        ? undefined
        : JSON.parse(JSON.stringify(probeEvidence[0].details)),
    );
    if (
      options.conditionsProbe.reliable &&
      evaluation.reason === "conditions_unmet" &&
      (evaluation.type === "flag" || (evaluation.type === "variable" && !featureKey))
    ) {
      check("evidence.cliProbe.reachedRootFailure", false, options.conditionsProbe.passed);
    }
    const passedRoot = featureKey
      ? evaluation.type === "flag" && ["rule", "allocated", "no_match"].includes(evaluation.reason)
      : evaluation.type === "variable" &&
        ["variable_default", "variable_override_rule", "variable_composed"].includes(
          evaluation.reason,
        );
    if (options.conditionsProbe.reliable && passedRoot) {
      check("evidence.cliProbe.reachedRootSuccess", true, options.conditionsProbe.passed);
    }
  }
  const program = variable?.overrideProgram;
  const selectionEvidence = explanation.evidence.filter(
    (entry) =>
      entry.title === "Supplementary CLI selection condition probe (not an execution trace)",
  );
  check(
    "evidence.selectionProbes",
    JSON.parse(JSON.stringify(options.selectionProbes || [])),
    JSON.parse(JSON.stringify(selectionEvidence.map((entry) => entry.details))),
  );
  for (const entry of selectionEvidence)
    check("evidence.selectionProbe.basis", "cli-probe", entry.basis);
  check(
    "evidence.rolloutBoundary",
    getRolloutBoundary(evaluation, featureKey ? datafile.features[featureKey] : undefined, options),
    explanation.evidence.find((entry) => entry.title === ROLLOUT_BOUNDARY_TITLE)?.details,
  );
  const selected = program
    ? program[evaluation.variableOverrideIndex ?? -1]
    : (variable?.overrides?.[evaluation.variableOverrideIndex ?? -1] ??
      (evaluation.reason === "variable_override_rule" && variableKey
        ? evaluation.traffic?.variableOverrides?.[variableKey]?.[
            evaluation.variableOverrideIndex ?? -1
          ]
        : undefined));

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
  if (evaluation.reason === "conditions_unmet" && variable) {
    check(
      "definition.disabledPolicy",
      value,
      variable.compose
        ? (variable.disabledValue ?? null)
        : variable.useDefaultWhenDisabled
          ? variable.defaultValue
          : variable.disabledValue,
    );
  }
  if (
    !program &&
    evaluation.reason === "variable_override_rule" &&
    evaluation.variableOverrideIndex !== undefined &&
    (variable || evaluation.traffic?.variableOverrides?.[variableKey ?? ""])
  ) {
    check("definition.overrideExists", true, selected !== undefined);
  }
  if (selected && !program && "value" in selected) {
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
  if (program) {
    const paths = evaluation.variableOverridePaths;
    const isOverride = evaluation.reason === "variable_override_rule";
    if (isOverride) {
      check("definition.overrideProgram.paths", true, Array.isArray(paths) && paths.length > 0);
    }
    if (paths) {
      let nextIndex = 0;
      let replayedValue = variable!.defaultValue as VariableValue;
      let replayFailed = false;
      let lastStep:
        | { index: number; step: DatafileVariableOverrideStep; path: string[] }
        | undefined;
      paths.forEach((path, pathIndex) => {
        const index = program.findIndex((step) => samePath(stepPath(step), path));
        check(`definition.overrideProgram.path.${pathIndex}`, true, index !== -1);
        if (index === -1) {
          replayFailed = true;
          return;
        }
        const step = program[index];
        check(`definition.overrideProgram.pathValue.${pathIndex}`, stepPath(step), path);
        check(
          `definition.overrideProgram.jump.${pathIndex}`,
          true,
          reachesByMisses(program, nextIndex, index),
        );
        check(
          `definition.overrideProgram.onMatch.${pathIndex}`,
          true,
          validJump(program, index, step.onMatch),
        );
        check(
          `definition.overrideProgram.onMiss.${pathIndex}`,
          true,
          validJump(program, index, step.onMiss),
        );
        if (!variable?.compose) {
          try {
            replayedValue = applyVariableOperations(replayedValue, step.operations);
          } catch (error) {
            replayFailed = true;
            check(
              `definition.overrideProgram.replay.${pathIndex}`,
              undefined,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        nextIndex = step.onMatch;
        lastStep = { index, step, path };
      });
      if (!replayFailed && !variable?.compose) {
        check("definition.overrideProgram.finalValue", replayedValue, value);
      }
      if (lastStep) {
        check(
          "definition.overrideProgram.lastIndex",
          lastStep.index,
          evaluation.variableOverrideIndex,
        );
        check(
          "definition.overrideProgram.lastKey",
          lastStep.step.key,
          evaluation.variableOverrideKey,
        );
        check(
          "definition.overrideProgram.lastPath",
          lastStep.path,
          evaluation.variableOverridePath,
        );
      }
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

  if (program && evaluation.reason === "variable_override_rule") {
    check(
      "evidence.accumulatingOverride.present",
      true,
      explanation.evidence.some(
        (entry) => entry.title === "Applied runtime global variable overrides",
      ),
    );
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
      case "Applied runtime global variable overrides": {
        const paths = evaluation.variableOverridePaths || [];
        check("evidence.accumulatingOverride.paths", paths, details.paths);
        check(
          "evidence.accumulatingOverride.steps",
          paths.map((path) => programStepDetails(program || [], path)),
          details.steps,
        );
        break;
      }
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
      case "Declared root conditions (not an execution trace)":
        check(
          "evidence.conditions",
          decode(evaluation.conditions ?? variable?.conditions ?? feature?.conditions),
          details.conditions,
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
