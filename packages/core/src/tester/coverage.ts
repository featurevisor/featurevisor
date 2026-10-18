import type { Evaluation } from "@featurevisor/sdk";

export interface CoverageSelection {
  set: string | null;
  environment: string | null;
  target: string | null;
  featureKey?: string;
  variableKey?: string;
  ruleKey?: string;
  variation?: unknown;
  overridePath?: string[];
  overrideIndex?: number;
}

function getAssertionValue(assertion: any, key: "environment" | "target"): string | null {
  return typeof assertion?.[key] === "string" ? assertion[key] : null;
}

function selectionKey(selection: CoverageSelection): string {
  return JSON.stringify([
    selection.set,
    selection.environment,
    selection.target,
    selection.featureKey,
    selection.variableKey,
    selection.ruleKey,
    selection.variation,
    selection.overridePath,
    selection.overrideIndex,
  ]);
}

export function createCoverageCollector(set: string | null) {
  const selectionsByKey = new Map<string, CoverageSelection>();

  function onEvaluation(evaluation: Evaluation, assertion: any): void {
    const selection: CoverageSelection = {
      set,
      environment: getAssertionValue(assertion, "environment"),
      target: getAssertionValue(assertion, "target"),
      ...(typeof evaluation.featureKey === "string" ? { featureKey: evaluation.featureKey } : {}),
      ...(typeof evaluation.variableKey === "string"
        ? { variableKey: evaluation.variableKey }
        : {}),
      ...(typeof evaluation.ruleKey === "string" ? { ruleKey: evaluation.ruleKey } : {}),
      ...(evaluation.variation?.value !== undefined
        ? { variation: evaluation.variation.value }
        : {}),
    };
    const overridePaths = evaluation.variableOverridePaths?.length
      ? evaluation.variableOverridePaths
      : evaluation.variableOverridePath
        ? [evaluation.variableOverridePath]
        : typeof evaluation.variableOverrideKey === "string"
          ? [[evaluation.variableOverrideKey]]
          : [];

    if (overridePaths.length) {
      for (const overridePath of overridePaths) {
        const observedSelection = { ...selection, overridePath: [...overridePath] };
        selectionsByKey.set(selectionKey(observedSelection), observedSelection);
      }
    } else if (typeof evaluation.variableOverrideIndex === "number") {
      const observedSelection = { ...selection, overrideIndex: evaluation.variableOverrideIndex };
      selectionsByKey.set(selectionKey(observedSelection), observedSelection);
    } else if (selection.ruleKey !== undefined) {
      selectionsByKey.set(selectionKey(selection), selection);
    }
  }

  function getSelections(): CoverageSelection[] {
    return [...selectionsByKey.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, selection]) => selection);
  }

  return { onEvaluation, getSelections };
}
