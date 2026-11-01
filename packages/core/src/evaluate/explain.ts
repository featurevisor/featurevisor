import type {
  ComposeReference,
  Conditions,
  DatafileContent,
  DatafileVariableOverrideStep,
  ParsedVariable,
  ParsedVariableOverride,
  VariableMutations,
} from "@featurevisor/types";
import type { Evaluation, FeaturevisorDiagnostic } from "@featurevisor/sdk";
import { print, type ExpressionOptions } from "@featurevisor/expressions";
import { colorize } from "../tester/cliFormat";
import { mutationEntries } from "../builder/mutationEntries";
import { getConditionReferences } from "../datasource/conditions";
import type { ConditionsProbe, ConditionProbeNode } from "./probeConditions";

export interface ExplanationEvidence {
  basis: "sdk-result" | "sdk-diagnostic" | "definition" | "cli-probe";
  title: string;
  details: Record<string, unknown>;
}

export interface EvaluationExplanation {
  version: 1;
  mode: "outcome";
  source: {
    kind: "local-project";
    environment: string | false;
    set?: string;
    target?: string;
  };
  result: {
    type: Evaluation["type"];
    featureKey?: string;
    variableKey?: string;
    reason: Evaluation["reason"];
    hasValue: boolean;
    value?: unknown;
  };
  summary: string;
  evidence: ExplanationEvidence[];
  limitations: string[];
}

export interface ExplanationOptions {
  environment?: string;
  set?: string;
  target?: string;
  feature?: string;
  variable?: string;
  definitionExists?: boolean;
  /** The definition is read through the project's configured datasource. */
  authoredVariable?: ParsedVariable;
  /** Separate CLI checks, never observations from the authoritative call. */
  conditionsProbe?: ConditionsProbe;
  selectionProbes?: ConditionsProbe[];
  /** Prints declared conditions as expressions, in a project that allows them */
  expressions?: ExpressionOptions;
}

export function getEvaluationValue(evaluation: Evaluation): unknown {
  if (evaluation.type === "flag") return evaluation.enabled;
  if (evaluation.type === "variable") return evaluation.variableValue;
  return typeof evaluation.variationValue !== "undefined"
    ? evaluation.variationValue
    : evaluation.variation?.value;
}

export function summarizeEvaluation(evaluation: Evaluation): string {
  switch (evaluation.reason) {
    case "feature_not_found":
      return "The feature is absent from the generated datafile.";
    case "variable_not_found":
      return "The variable is absent from the evaluated datafile entity.";
    case "disabled":
      return "The feature is disabled; no value was supplied for this evaluation.";
    case "variation_disabled":
      return "The feature is disabled. Its disabledVariationValue supplied the variation.";
    case "variable_disabled":
      return "The feature is disabled. The variable's disabledValue supplied the value.";
    case "variable_default":
      return evaluation.enabled === false
        ? "The feature is disabled. useDefaultWhenDisabled supplied the variable's defaultValue."
        : "The SDK returned the variable's defaultValue.";
    case "variable_composed":
      return "The SDK assembled the composition from its referenced sources.";
    case "conditions_unmet":
      return evaluation.featureKey
        ? "The feature's root conditions were not satisfied."
        : "The global variable's root conditions were not satisfied. Its disabled value policy supplied the result, if any.";
    case "forced":
      return "A force entry supplied the result.";
    case "sticky":
      return "A sticky value supplied the result.";
    case "no_variations":
      return "The feature has no variations to evaluate.";
    case "no_match":
      return evaluation.type === "flag"
        ? "No rule's conditions matched, or the bucket is above the first matching rule's percentage. A bucket above the percentage does not fall through to later rules."
        : "No eligible result was selected. A selector, rollout boundary, or variation allocation can cause this result.";
    case "variable_override_rule":
      return evaluation.featureKey
        ? "A variable override on the matched feature rule supplied the value."
        : (evaluation.variableOverridePaths?.length ?? 0) > 1
          ? "Global variable overrides supplied the value."
          : "A global variable override supplied the value.";
    case "variable_override_variation":
      return "A variable override on the selected variation supplied the value.";
    case "allocated":
      return "The selected variation supplied the result.";
    case "rule":
      return evaluation.traffic?.percentage === 0
        ? "The matched rule has a rollout percentage of 0, so the feature is disabled."
        : evaluation.type === "flag"
          ? "The SDK determined the flag result from the matched rule and its rollout."
          : "The matched rule supplied the result.";
    case "error":
      return "The SDK reported an evaluation error.";
  }
}

// Decode only for presentation. Never match selectors or repeat an SDK evaluation.
function readableSelector(value: unknown): unknown {
  if (typeof value !== "string" || !/^[\[{]/.test(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Declared conditions as an expression, in a project that allows them, where the tree has one */
function expressionOf(value: unknown, expressions?: ExpressionOptions): string | undefined {
  if (!expressions || value === undefined || value === "*") return undefined;
  try {
    return print(readableSelector(value) as Conditions, { ...expressions, width: Infinity });
  } catch {
    // a tree the printer cannot read has no expression
    return undefined;
  }
}

/** Declared conditions, with their expression in a project that allows them */
function conditionsOf(value: unknown, expressions?: ExpressionOptions): Record<string, unknown> {
  const expression = expressionOf(value, expressions);
  return { conditions: readableSelector(value), ...(expression ? { expression } : {}) };
}

function selectors(
  value: { conditions?: unknown },
  expressions?: ExpressionOptions,
): Record<string, unknown> {
  return value.conditions !== undefined ? conditionsOf(value.conditions, expressions) : {};
}

function authoredPath(
  variable: ParsedVariable,
  environment: string | undefined,
  path: string[],
): ParsedVariableOverride[] | undefined {
  let overrides = Array.isArray(variable.overrides)
    ? variable.overrides
    : environment
      ? variable.overrides?.[environment]
      : undefined;
  const result: ParsedVariableOverride[] = [];
  for (const key of path) {
    const override = overrides?.find((entry) => entry.key === key);
    if (!override) return undefined;
    result.push(override);
    overrides = override.overrides;
  }
  return result;
}

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function programStepDetails(
  program: DatafileVariableOverrideStep[],
  path: string[],
): Record<string, unknown> {
  const index = program.findIndex((step) => samePath(step.keyPath || [step.key], path));
  if (index === -1) return { path, presentInProgram: false };
  const step = program[index];
  return {
    index,
    key: step.key,
    path: step.keyPath || [step.key],
    operations: step.operations,
    onMatch: step.onMatch,
    onMiss: step.onMiss,
  };
}

export function getCompositionSourceKind(source: ComposeReference, datafile: DatafileContent) {
  if (source.feature !== undefined) {
    if (source.variable !== undefined) return "feature variable";
    return source.variation ? "variation" : "flag";
  }
  const composition = datafile.variables?.[source.variable]?.compose;
  return typeof composition === "string"
    ? "alias"
    : composition
      ? "composition"
      : "global variable";
}

export const ROLLOUT_BOUNDARY_TITLE = "Rollout boundary (supplementary CLI probe)";

/**
 * A flag with `no_match` either matched no rule or landed above the matched
 * rule's percentage. The SDK reports both the same way. When a reliable probe
 * shows the first matching rule, name it and compare its percentage with the
 * SDK's bucket.
 */
export function getRolloutBoundary(
  evaluation: Evaluation,
  feature: DatafileContent["features"][string] | undefined,
  options: Pick<ExplanationOptions, "selectionProbes">,
): Record<string, unknown> | undefined {
  if (evaluation.type !== "flag" || evaluation.reason !== "no_match") return undefined;
  if (typeof evaluation.bucketValue !== "number") return undefined;
  const rules = (options.selectionProbes || []).filter((probe) => probe.scope === "rule");
  // An unreliable probe before the first passing one could hide an earlier match.
  const first = rules.find((probe) => !probe.reliable || probe.passed);
  if (!first?.reliable) return undefined;
  const rule = feature?.traffic?.find((entry) => entry.key === first.key);
  if (!rule || evaluation.bucketValue <= rule.percentage) return undefined;
  return { rule: rule.key, percentage: rule.percentage, bucketValue: evaluation.bucketValue };
}

/** Augment an existing result. This function never calls or reimplements the SDK. */
export function explainEvaluation(
  evaluation: Evaluation,
  datafile: DatafileContent,
  diagnostics: FeaturevisorDiagnostic[],
  options: ExplanationOptions,
): EvaluationExplanation {
  const value = getEvaluationValue(evaluation);
  const featureKey = evaluation.featureKey ?? options.feature;
  const variableKey = evaluation.variableKey ?? options.variable;
  const evidence: ExplanationEvidence[] = [];
  const add = (
    basis: ExplanationEvidence["basis"],
    title: string,
    details: Record<string, unknown>,
  ) => evidence.push({ basis, title, details });
  const limitations = [
    "This explains the SDK outcome, not a complete execution trace. Individual failed checks and short circuits are not recorded.",
    "Definitions and compiled selectors are supporting information, not additional evaluations. Local definitions may differ from deployed datafiles.",
  ];
  if (options.conditionsProbe) {
    limitations.push(
      "Condition probes include leaves and rules skipped by SDK short circuiting. They use a separate SDK instance with no application modules and are not an execution trace.",
    );
  }
  if (options.target) {
    limitations.push(
      "Target context can simplify selectors during building. Authored selectors are shown as provenance, not replayed against the supplied context.",
    );
  }
  const feature = featureKey ? datafile.features[featureKey] : undefined;
  const variable = !featureKey && variableKey ? datafile.variables?.[variableKey] : undefined;

  const describeSelectors = (candidate: Parameters<typeof selectors>[0]) => {
    const details = selectors(candidate, options.expressions);
    const keys = getConditionReferences(candidate.conditions as Conditions | undefined).segments;
    if (keys.size) {
      details.segmentDefinitions = Array.from(keys, (key) => ({
        key,
        present: Object.prototype.hasOwnProperty.call(datafile.segments, key),
        ...conditionsOf(datafile.segments[key]?.conditions, options.expressions),
      }));
    }
    return details;
  };

  if ((featureKey && !feature) || (!featureKey && !variable)) {
    add("definition", "Entity availability", {
      definedInProject: options.definitionExists,
      presentInDatafile: false,
      note: options.definitionExists
        ? "The entity exists locally but is absent from this datafile. Check Target selection, exposure and archiving. No specific exclusion cause is inferred."
        : "The SDK result is authoritative for this datafile.",
    });
  }

  if (evaluation.error) {
    add("sdk-result", "Evaluation error", {
      name: evaluation.error.name,
      message: evaluation.error.message,
    });
  }
  if (evaluation.bucketValue !== undefined || evaluation.bucketKey !== undefined) {
    add("sdk-result", "Bucketing reported by the SDK", {
      bucketKey: evaluation.bucketKey,
      bucketValue: evaluation.bucketValue,
      bucketBy: feature?.bucketBy,
    });
  }
  if (evaluation.traffic) {
    add("sdk-result", "Matched rule", {
      key: evaluation.ruleKey,
      percentage: evaluation.traffic.percentage,
      ...describeSelectors(evaluation.traffic),
      allocation: evaluation.traffic.allocation,
    });
  }
  if (evaluation.force) {
    add("sdk-result", "Selected force", {
      index: evaluation.forceIndex,
      enabled: evaluation.force.enabled,
      variation: evaluation.force.variation,
      variables: evaluation.force.variables,
      ...describeSelectors(evaluation.force),
    });
  }
  const conditions = evaluation.conditions ?? variable?.conditions ?? feature?.conditions;
  if (conditions !== undefined) {
    add(
      "definition",
      "Declared root conditions (not an execution trace)",
      conditionsOf(conditions, options.expressions),
    );
  }
  if (options.conditionsProbe) {
    add("cli-probe", "Supplementary CLI condition probe (not an execution trace)", {
      ...structuredClone(options.conditionsProbe),
    });
  }
  for (const probe of options.selectionProbes || []) {
    add("cli-probe", "Supplementary CLI selection condition probe (not an execution trace)", {
      ...structuredClone(probe),
    });
  }
  const boundary = getRolloutBoundary(evaluation, feature, options);
  if (boundary) {
    add("cli-probe", ROLLOUT_BOUNDARY_TITLE, boundary);
  }
  if (evaluation.type === "variation" && value !== undefined) {
    add("sdk-result", "Returned variation", { value });
  }
  if (evaluation.type === "variable") {
    const schema = evaluation.variableSchema ?? variable;
    if (variable?.compose && evaluation.reason !== "conditions_unmet") {
      if (variable.overrideProgram)
        limitations.push(
          typeof variable.compose === "string"
            ? "Composed overrides start from runtime getter results. Their paths and operations are verified, but the CLI does not replay a starting value by evaluating sources again."
            : "Composed overrides start from runtime getter results. Their paths and operations are verified, but the CLI does not replay a starting object by evaluating sources again.",
        );
      if (typeof variable.compose === "string") {
        const source = { variable: variable.compose };
        add("sdk-result", "Composition source", {
          afterOverrides: evaluation.reason === "variable_override_rule",
          source,
          sourceKind: getCompositionSourceKind(source, datafile),
          hasValue: value !== undefined,
          value,
        });
      } else {
        add("sdk-result", "Composition members", {
          afterOverrides: evaluation.reason === "variable_override_rule",
          members: variable.compose.map(({ key, ...source }) => ({
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
        });
      }
    } else if (schema) {
      add("definition", "Variable value policy", {
        type: schema.type,
        defaultValue: schema.defaultValue,
        disabledValue: schema.disabledValue,
        useDefaultWhenDisabled: schema.useDefaultWhenDisabled,
      });
    }
    if (
      evaluation.variableOverrideIndex !== undefined ||
      evaluation.variableOverrideKey !== undefined
    ) {
      add("sdk-result", "Selected variable override", {
        key: evaluation.variableOverrideKey,
        path: evaluation.variableOverridePath,
        compiledIndex: evaluation.variableOverrideIndex,
      });
    }
    const program = variable?.overrideProgram;
    const selected = program
      ? program[evaluation.variableOverrideIndex ?? -1]
      : (variable?.overrides?.[evaluation.variableOverrideIndex ?? -1] ??
        (evaluation.reason === "variable_override_rule" && variableKey
          ? evaluation.traffic?.variableOverrides?.[variableKey]?.[
              evaluation.variableOverrideIndex ?? -1
            ]
          : undefined));
    if (selected) {
      add("definition", "Selected compiled override selectors", describeSelectors(selected));
      if (variable) {
        add("definition", "Global override selection policy", {
          policy: program
            ? "The SDK follows the compiled runtime override program. Its jumps preserve authored first match and continuation rules. Recorded paths and operations below are runtime facts; selectors are not replayed here."
            : "The SDK selects the first matching compiled override. Nested descendants precede their parent fallbacks. Mutations are resolved during building, not in the SDK.",
        });
        if (!program && "value" in selected) {
          const path =
            evaluation.variableOverridePath ??
            (evaluation.variableOverrideKey !== undefined ? [evaluation.variableOverrideKey] : []);
          const authored =
            options.authoredVariable && path.length > 0
              ? authoredPath(options.authoredVariable, options.environment, path)
              : undefined;
          if (authored) {
            add("definition", "Authored value construction (build time)", {
              defaultValue: options.authoredVariable?.defaultValue,
              overrides: authored.map((override, index) => ({
                path: path.slice(0, index + 1),
                ...selectors(override, options.expressions),
                ...(override.mutate !== undefined
                  ? { mutate: override.mutate }
                  : { value: override.value }),
              })),
              compiledValue: selected.value,
            });
          } else if (options.authoredVariable) {
            limitations.push(
              "The selected compiled override could not be mapped to an authored override path.",
            );
          }
        }
      }
    }
    if (program && evaluation.reason === "variable_override_rule") {
      const paths = evaluation.variableOverridePaths || [];
      add("sdk-result", "Applied runtime global variable overrides", {
        paths,
        steps: paths.map((path) => programStepDetails(program, path)),
      });
    }
    if (featureKey) {
      limitations.push(
        "Feature variable mutations are resolved during building. The result identifies the selected source where available, but does not contain a mutation history.",
      );
    }
  }

  // Preserve observation order and repeated calls. Diagnostics do not identify
  // parent evaluations, so do not invent a dependency tree or expected values.
  const observations = diagnostics.flatMap((diagnostic) => {
    const nested = diagnostic.details.evaluation;
    if (!nested || typeof nested !== "object" || !("type" in nested) || !("reason" in nested))
      return [];
    const observed = nested as Evaluation;
    if (observed === evaluation) return [];
    return [
      {
        type: observed.type,
        featureKey: observed.featureKey,
        variableKey: observed.variableKey,
        reason: observed.reason,
        hasValue: getEvaluationValue(observed) !== undefined,
        value: getEvaluationValue(observed),
        ruleKey: observed.ruleKey,
      },
    ];
  });
  if (observations.length) {
    add("sdk-diagnostic", "Related evaluations observed during this call", { observations });
  }
  const issues = diagnostics
    .filter((entry) => entry.level === "warn" || entry.level === "error")
    .map((entry) => ({ level: entry.level, code: entry.code, message: entry.message }));
  if (issues.length) add("sdk-diagnostic", "Warnings and errors", { issues });

  return {
    version: 1,
    mode: "outcome",
    source: {
      kind: "local-project",
      environment: options.environment || false,
      set: options.set,
      target: options.target,
    },
    result: {
      type: evaluation.type,
      featureKey,
      variableKey,
      reason: evaluation.reason,
      hasValue: value !== undefined,
      ...(value !== undefined && { value }),
    },
    summary: summarizeEvaluation(evaluation),
    evidence,
    limitations,
  };
}

function paint(text: string, colour: number): string {
  return process.env.NO_COLOR !== undefined || process.env.FORCE_COLOR === "0"
    ? text
    : colorize(text, colour);
}

function compact(value: unknown): string {
  const text = JSON.stringify(value) ?? "unavailable";
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

// Describe declarations, never claim that these individual checks were executed.
function describeFeatureResult(value: unknown): string {
  if (!value || typeof value !== "object") return "unavailable";
  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${key} ${compact(entry)}`)
    .join(", ");
}

function describeSelector(value: unknown): string {
  if (value === "*") return "everyone";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(describeSelector).join(" AND ");
  if (!value || typeof value !== "object") return compact(value);
  const group = value as Record<string, unknown>;
  for (const operator of ["and", "or", "not"]) {
    if (Array.isArray(group[operator])) {
      const expression = (group[operator] as unknown[])
        .map(describeSelector)
        .join(operator === "or" ? " OR " : " AND ");
      return `${operator === "not" ? "NOT " : ""}(${expression})`;
    }
  }
  if (typeof group.attribute === "string") {
    const operators: Record<string, string> = {
      equals: "=",
      notEquals: "!=",
      greaterThan: ">",
      greaterThanOrEquals: ">=",
      lessThan: "<",
      lessThanOrEquals: "<=",
      notExists: "is absent",
      exists: "is present",
      empty: "is empty",
      notEmpty: "is not empty",
      includesAny: "includes any of",
      notIncludesAny: "includes none of",
    };
    const operator = String(group.operator);
    return `${group.attribute} ${operators[operator] ?? operator}${group.value !== undefined ? ` ${compact(group.value)}` : ""}`;
  }
  if (typeof group.variable === "string") {
    const owner = group.feature ? `${group.feature}.` : "global ";
    const path = Array.isArray(group.path) ? group.path.map(String).join(".") : group.path;
    return `${owner}${group.variable}${path ? ` at ${path}` : ""} ${group.operator}${group.value !== undefined ? ` ${compact(group.value)}` : ""}`;
  }
  if (typeof group.feature === "string") {
    return `${group.feature} ${group.enabled === false ? "disabled" : "enabled"}${group.variation !== undefined ? `, variation ${compact(group.variation)}` : ""}`;
  }
  return compact(value);
}

/**
 * Declared conditions as the project writes them: as an expression in a project that allows
 * them, where the tree has one, and in words otherwise.
 */
function describeConditions(value: unknown, expressions?: ExpressionOptions): string {
  return expressionOf(value, expressions) ?? describeSelector(value);
}

export function printExplanation(
  explanation: EvaluationExplanation,
  showNotice = true,
  expressions?: ExpressionOptions,
): void {
  const { result, evidence } = explanation;
  const detail = (title: string) => evidence.find((entry) => entry.title === title)?.details;
  const line = (label: string, value: string) => console.log(`  ${paint(label, 36)} ${value}`);
  const resultColour =
    result.reason === "error" ? 31 : !result.hasValue || result.value === false ? 33 : 32;
  const value = result.hasValue ? JSON.stringify(result.value, null, 2) : "No value returned";
  console.log(`\n  ${paint(`Value: ${value.replace(/\n/g, "\n  ")}`, resultColour)}`);
  console.log(`  Explanation: ${explanation.summary}`);
  const composition = detail("Composition members");
  const alias = detail("Composition source");
  if (alias) {
    line("Alias source:", `${(alias.source as ComposeReference).variable}, ${alias.sourceKind}`);
    line(
      alias.afterOverrides ? "SDK result after overrides:" : "SDK result:",
      alias.hasValue ? compact(alias.value) : "unavailable",
    );
  }
  if (composition) {
    if (composition.afterOverrides) line("Composition:", "final property values after overrides");
    for (const member of composition.members as Array<{
      property: string;
      source: ComposeReference;
      sourceKind: string;
      hasValue: boolean;
      value?: unknown;
    }>) {
      const source =
        member.source.feature !== undefined
          ? `${member.source.feature}${member.source.variable !== undefined ? ` / ${member.source.variable}` : ""}`
          : member.source.variable;
      line(
        `${member.property}:`,
        `${member.hasValue ? compact(member.value) : "unavailable"} (source: ${source}, ${member.sourceKind})`,
      );
    }
  }

  const rule = detail("Matched rule");
  if (rule)
    line(
      "Rule:",
      `${paint(String(rule.key), 36)}${typeof rule.percentage === "number" ? ` (${rule.percentage / 1000}% rollout)` : ""}`,
    );
  const force = detail("Selected force");
  if (force) line("Force:", `entry ${Number(force.index) + 1}`);
  const runtimeOverrides = detail("Applied runtime global variable overrides");
  const override = detail("Selected variable override");
  if (override)
    line(
      runtimeOverrides ? "Last override:" : "Override:",
      Array.isArray(override.path)
        ? override.path.join(" → ")
        : String(override.key ?? `compiled entry ${Number(override.compiledIndex) + 1}`),
    );
  if (runtimeOverrides) {
    const paths = (runtimeOverrides.paths ?? []) as string[][];
    if (paths.length > 3) {
      line("Applied overrides:", `${paths.length} matched paths`);
      paths.forEach((path) => console.log(`    ${path.join(" → ")}`));
    } else {
      line("Applied overrides:", paths.map((path) => path.join(" → ")).join("; ") || "none");
    }
    const operationCount = (
      (runtimeOverrides.steps ?? []) as Array<Record<string, unknown>>
    ).reduce((count, step) => count + ((step.operations ?? []) as unknown[]).length, 0);
    if (operationCount)
      line(
        "Operations:",
        `${operationCount} compiled mutation${operationCount === 1 ? "" : "s"} (details: --explain --json)`,
      );
  }

  const selection = detail("Selected compiled override selectors") ?? force ?? rule;
  if (selection) {
    if (selection.conditions !== undefined)
      line("Conditions (definition):", describeConditions(selection.conditions, expressions));
    const segments = (selection.segmentDefinitions ?? []) as Array<Record<string, unknown>>;
    for (const segment of segments.slice(0, 4)) {
      console.log(
        paint(
          `    ${segment.key}: ${segment.present ? describeConditions(segment.conditions, expressions) : "absent from datafile"}`,
          2,
        ),
      );
    }
    if (segments.length > 4)
      console.log(paint(`    +${segments.length - 4} segment definitions in JSON`, 2));
  }
  const root = detail("Declared root conditions (not an execution trace)");
  if (root?.conditions !== undefined)
    line("Root conditions (definition):", describeConditions(root.conditions, expressions));

  const probes = explanation.evidence.filter(
    (entry) => entry.basis === "cli-probe" && entry.details.expression !== undefined,
  );
  for (const { details: probe } of probes) {
    const state = (node: ConditionProbeNode) =>
      node.reliable
        ? node.passed
          ? paint("PASS", 32)
          : paint("FAIL", 31)
        : paint("INCONCLUSIVE", 33);
    const name =
      probe.scope === "root"
        ? "root"
        : probe.scope === "rule"
          ? `rule ${probe.key ?? probe.index}`
          : `force ${probe.index}`;
    line(
      `CLI probe, ${name}:`,
      `${state(probe.expression as ConditionProbeNode)}${probe.reliable ? "" : " (UNRELIABLE)"}`,
    );
    const printNode = (node: ConditionProbeNode, depth: number) => {
      const prefix = `    ${"  ".repeat(depth)}${state(node)} `;
      if (node.kind !== "leaf") {
        console.log(`${prefix}${node.kind.toUpperCase()}`);
      } else {
        const identity =
          node.attribute ??
          node.segment ??
          (node.variable
            ? `${node.feature ? `${node.feature}.` : "global "}${node.variable}${node.path?.length ? ` at ${node.path.map(String).join(".")}` : ""}`
            : (node.feature ?? "*"));
        const error = node.error ? ` (${node.error})` : "";
        if (node.leafKind === "wildcard") {
          console.log(`${prefix}* matches every context${error}`);
        } else if (node.leafKind === "feature") {
          console.log(
            `${prefix}feature ${identity}: ${describeFeatureResult(node.operandPresent ? node.operand : undefined)}, expected ${describeFeatureResult(node.expectedPresent ? node.expected : undefined)}${error}`,
          );
        } else {
          const operand = node.operandPresent
            ? compact(node.operand)
            : node.leafKind === "segment"
              ? String(node.passed)
              : "<missing path>";
          const expected = node.expectedPresent ? ` ${compact(node.expected)}` : "";
          console.log(
            `${prefix}${identity}: ${operand}${node.operator ? ` ${node.operator}` : ""}${expected}${error}`,
          );
        }
      }
      node.children?.forEach((child) => printNode(child, depth + 1));
    };
    printNode(probe.expression as ConditionProbeNode, 0);
  }
  if (probes.length)
    console.log(paint("  Supplementary CLI probes; not an SDK execution trace.", 2));

  const boundary = detail(ROLLOUT_BOUNDARY_TITLE);
  if (boundary)
    line(
      "Rollout:",
      `rule ${paint(String(boundary.rule), 36)} matched, but bucket ${Number(boundary.bucketValue) / 1000} is above its ${Number(boundary.percentage) / 1000}% rollout`,
    );
  const bucket = detail("Bucketing reported by the SDK");
  if (bucket)
    console.log(
      paint(
        `  Bucket: ${bucket.bucketValue ?? "unavailable"} / 100000 · key ${compact(bucket.bucketKey)}`,
        2,
      ),
    );
  const construction = detail("Authored value construction (build time)");
  if (construction) {
    const steps = construction.overrides as Array<Record<string, unknown>>;
    const fields = steps.flatMap((step) =>
      step.mutate && typeof step.mutate === "object"
        ? mutationEntries(step.mutate as VariableMutations).map(([path]) => path)
        : [],
    );
    const replacements = steps.filter((step) =>
      Object.prototype.hasOwnProperty.call(step, "value"),
    ).length;
    line(
      "Built from:",
      `default value${fields.length ? `; mutations to ${fields.join(", ")}` : ""}${replacements ? `; ${replacements} value replacement${replacements === 1 ? "" : "s"}` : ""}`,
    );
  }
  const related = detail("Related evaluations observed during this call");
  if (related) {
    // Collapse repeated observations only in the human view, not in the JSON evidence.
    const observations = Array.from(
      new Set(
        (related.observations as Array<Record<string, unknown>>).map(
          (entry) =>
            `${entry.featureKey}${entry.variableKey ? `.${entry.variableKey}` : ""} ${entry.type}: ${entry.hasValue ? compact(entry.value) : "no value"} (${entry.reason})`,
        ),
      ),
    );
    for (const observation of observations.slice(0, 4)) line("Observed:", observation);
    if (observations.length > 4)
      console.log(paint(`  +${observations.length - 4} related results in JSON`, 2));
  }
  const availability = detail("Entity availability");
  if (availability?.definedInProject)
    console.log(
      paint(
        "  Defined locally, but absent from this datafile. Check Target selection, exposure and archiving.",
        33,
      ),
    );
  const error = detail("Evaluation error");
  if (error) console.log(paint(`  ${error.name}: ${error.message}`, 31));
  const issues = detail("Warnings and errors");
  for (const issue of (issues?.issues ?? []) as Array<Record<string, unknown>>) {
    console.log(paint(`  ${issue.level}: ${issue.message}`, issue.level === "error" ? 31 : 33));
  }
  if (showNotice) {
    console.log(
      paint(
        `\n  Local project${explanation.source.set ? ` · set ${explanation.source.set}` : ""}. Outcome explanation, not a complete execution trace.`,
        2,
      ),
    );
    console.log(paint("  Full evidence and limitations: --explain --json", 2));
  }
}
