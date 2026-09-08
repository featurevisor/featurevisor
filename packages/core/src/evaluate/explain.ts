import type { DatafileContent, ParsedVariable, ParsedVariableOverride } from "@featurevisor/types";
import type { Evaluation, FeaturevisorDiagnostic } from "@featurevisor/sdk";
import { colorize } from "../tester/cliFormat";

export interface ExplanationEvidence {
  basis: "sdk-result" | "sdk-diagnostic" | "definition";
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
    case "required":
      return "A required feature did not satisfy its enabled or variation requirement.";
    case "required_features_unmet":
      return "The global variable's required features were not satisfied. Its disabled value policy supplied the result, if any.";
    case "forced":
      return "A force entry supplied the result.";
    case "sticky":
      return "A sticky value supplied the result.";
    case "no_variations":
      return "The feature has no variations to evaluate.";
    case "out_of_range":
      return "The bucket value is outside the feature's allocated group ranges.";
    case "no_match":
      return "No eligible result was selected. A selector, rollout boundary, or variation allocation can cause this result.";
    case "variable_override_rule":
      return evaluation.featureKey
        ? "A variable override on the matched feature rule supplied the value."
        : "A global variable override supplied the value.";
    case "variable_override_variation":
      return "A variable override on the selected variation supplied the value.";
    case "allocated":
      return evaluation.type === "flag"
        ? "The SDK enabled the feature within its allocated group range."
        : "The selected variation supplied the result.";
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

function selectors(value: {
  conditions?: unknown;
  segments?: unknown;
  requiredFeatures?: unknown;
}): Record<string, unknown> {
  return {
    ...(value.conditions !== undefined && { conditions: readableSelector(value.conditions) }),
    ...(value.segments !== undefined && { segments: readableSelector(value.segments) }),
    ...(value.requiredFeatures !== undefined && { requiredFeatures: value.requiredFeatures }),
  };
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
  if (options.target) {
    limitations.push(
      "Target context can simplify selectors during building. Authored selectors are shown as provenance, not replayed against the supplied context.",
    );
  }
  const feature = featureKey ? datafile.features[featureKey] : undefined;
  const variable = !featureKey && variableKey ? datafile.variables?.[variableKey] : undefined;

  const describeSelectors = (candidate: Parameters<typeof selectors>[0]) => {
    const details = selectors(candidate);
    const keys = new Set<string>();
    const visit = (expression: unknown) => {
      if (typeof expression === "string" && expression !== "*") keys.add(expression);
      else if (Array.isArray(expression)) expression.forEach(visit);
      else if (expression && typeof expression === "object") {
        for (const key of ["and", "or", "not"]) {
          if (key in expression) visit((expression as Record<string, unknown>)[key]);
        }
      }
    };
    visit(details.segments);
    if (keys.size) {
      details.segmentDefinitions = Array.from(keys, (key) => ({
        key,
        present: Object.prototype.hasOwnProperty.call(datafile.segments, key),
        conditions: readableSelector(datafile.segments[key]?.conditions),
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
      ...evaluation.force,
      ...describeSelectors(evaluation.force),
    });
  }
  const requirements =
    evaluation.requiredFeatures ??
    evaluation.required ??
    variable?.requiredFeatures ??
    feature?.requiredFeatures ??
    feature?.required;
  if (requirements !== undefined) {
    add("definition", "Declared root requirements (not a per requirement trace)", {
      requiredFeatures: requirements,
    });
  }
  if (evaluation.type === "variation" && value !== undefined) {
    add("sdk-result", "Returned variation", { value });
  }
  if (evaluation.type === "variable") {
    const schema = evaluation.variableSchema ?? variable;
    if (schema) {
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
    const selected =
      variable?.overrides?.[evaluation.variableOverrideIndex ?? -1] ??
      (evaluation.reason === "variable_override_rule" && variableKey
        ? evaluation.traffic?.variableOverrides?.[variableKey]?.[
            evaluation.variableOverrideIndex ?? -1
          ]
        : undefined);
    if (selected) {
      add("definition", "Selected compiled override selectors", describeSelectors(selected));
      if (variable) {
        add("definition", "Global override selection policy", {
          policy:
            "The SDK selects the first matching compiled override. Nested descendants precede their parent fallbacks. Mutations are resolved during building, not in the SDK.",
        });
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
              ...selectors(override),
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
    };
    const operator = String(group.operator);
    return `${group.attribute} ${operators[operator] ?? operator}${group.value !== undefined ? ` ${compact(group.value)}` : ""}`;
  }
  return compact(value);
}

export function printExplanation(explanation: EvaluationExplanation, showNotice = true): void {
  const { result, evidence } = explanation;
  const detail = (title: string) => evidence.find((entry) => entry.title === title)?.details;
  const line = (label: string, value: string) => console.log(`  ${paint(label, 36)} ${value}`);
  const resultColour =
    result.reason === "error" ? 31 : !result.hasValue || result.value === false ? 33 : 32;
  const value = result.hasValue ? JSON.stringify(result.value, null, 2) : "No value returned";
  console.log(`\n  ${paint(`Value: ${value.replace(/\n/g, "\n  ")}`, resultColour)}`);
  console.log(`  Explanation: ${explanation.summary}`);

  const rule = detail("Matched rule");
  if (rule)
    line(
      "Rule:",
      `${paint(String(rule.key), 36)}${typeof rule.percentage === "number" ? ` (${rule.percentage / 1000}% rollout)` : ""}`,
    );
  const force = detail("Selected force");
  if (force) line("Force:", `entry ${Number(force.index) + 1}`);
  const override = detail("Selected variable override");
  if (override)
    line(
      "Override:",
      Array.isArray(override.path)
        ? override.path.join(" → ")
        : String(override.key ?? `compiled entry ${Number(override.compiledIndex) + 1}`),
    );

  const selection = detail("Selected compiled override selectors") ?? force ?? rule;
  if (selection) {
    if (selection.conditions !== undefined)
      line("Conditions (definition):", describeSelector(selection.conditions));
    if (selection.segments !== undefined)
      line("Segments (definition):", describeSelector(selection.segments));
    const segments = (selection.segmentDefinitions ?? []) as Array<Record<string, unknown>>;
    for (const segment of segments.slice(0, 4)) {
      console.log(
        paint(
          `    ${segment.key}: ${segment.present ? describeSelector(segment.conditions) : "absent from datafile"}`,
          2,
        ),
      );
    }
    if (segments.length > 4)
      console.log(paint(`    +${segments.length - 4} segment definitions in JSON`, 2));
  }
  const root = detail("Declared root requirements (not a per requirement trace)");
  const requirements = (label: string, input: unknown) => {
    if (input === undefined) return;
    const items = Array.isArray(input) ? input : [input];
    line(
      label,
      items
        .map((item) =>
          typeof item === "string"
            ? `${item} enabled`
            : `${item.feature ?? item.key} ${item.enabled === false ? "disabled" : "enabled"}${item.variation !== undefined ? `, variation ${compact(item.variation)}` : ""}`,
        )
        .join("; "),
    );
  };
  requirements("Requires (definition):", root?.requiredFeatures);
  requirements("Override requires (definition):", selection?.requiredFeatures);

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
    const fields = Array.from(
      new Set(
        steps.flatMap((step) =>
          step.mutate && typeof step.mutate === "object" ? Object.keys(step.mutate) : [],
        ),
      ),
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
