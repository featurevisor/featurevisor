import type {
  AssertionMatrix,
  FeatureAssertion,
  ScenarioAssertion,
  SegmentAssertion,
  TestCheck,
  VariableAssertion,
  Test,
} from "@featurevisor/types";
import type { TestReportResult } from "./types";

/** Match the complete public case identity, including keyed assertions and matrix position. */
export function findTestReportCase(
  report: TestReportResult | undefined,
  test: Test,
  expanded: ExpandedTestAssertion,
  set?: string,
) {
  const id = getTestCaseId(test, expanded, set);
  const matches = report?.cases.filter((item) => item.id === id) || [];
  if (matches.length < 2) return matches[0];
  // Display every failure without removing the raw rows used to detect ambiguous coverage.
  return {
    ...matches[0],
    passed: matches.every((item) => item.passed),
    errors: matches.flatMap((item) => item.errors),
  };
}

function getTestCaseId(test: Test, expanded: ExpandedTestAssertion, set?: string) {
  const type =
    "scenario" in test
      ? "scenario"
      : "feature" in test
        ? "feature"
        : "segment" in test
          ? "segment"
          : "variable";
  return JSON.stringify([
    set || null,
    type,
    test.key || "",
    expanded.assertion.key ?? expanded.assertionIndex,
    expanded.caseIndex ?? null,
  ]);
}

/** Coverage is a comparison of identities, not the number of report rows. */
export function getTestReportCoverage(report: TestReportResult, test: Test, set?: string) {
  const expected = new Set(
    expandTestAssertions(test).map((item) => getTestCaseId(test, item, set)),
  );
  const seen = new Set<string>();
  const failedIds = new Set<string>();
  let duplicates = 0;
  let unmatched = 0;
  let passed = true;
  for (const result of report.cases) {
    if (!result.id || !expected.has(result.id)) {
      unmatched++;
      continue;
    }
    if (seen.has(result.id)) duplicates++;
    seen.add(result.id);
    if (!result.passed) failedIds.add(result.id);
    passed = passed && result.passed;
  }
  return {
    total: expected.size,
    executed: seen.size,
    failed: failedIds.size,
    passed,
    duplicates,
    unmatched,
    complete: seen.size === expected.size && duplicates === 0 && unmatched === 0,
  };
}

function cases(count: number) {
  return `${count} case${count === 1 ? "" : "s"}`;
}

export const NOT_IN_REPORT = "Not in supplied report";

/** Short sentences describing which cases a report covers and how they ended. */
export function getTestReportStatus(report: TestReportResult, test: Test, set?: string) {
  const coverage = getTestReportCoverage(report, test, set);
  const { executed, total, failed, duplicates, unmatched } = coverage;
  const historical = report.verification !== "current";
  const parts: string[] = [];

  if (historical) {
    parts.push(
      `${executed} of ${cases(total)} found in an earlier report`,
      report.verification === "stale"
        ? "Inputs changed since that report"
        : "Report inputs could not be verified",
    );
  } else if (executed === 0) {
    parts.push(NOT_IN_REPORT);
  } else if (executed === total) {
    parts.push(
      failed === 0 ? `${cases(total)} passed` : `${executed - failed} passed, ${failed} failed`,
    );
  } else {
    parts.push(
      `${executed} of ${cases(total)} in report`,
      failed === 0 ? "All reported cases passed" : `${failed} failed`,
    );
  }

  if (duplicates) parts.push(`${duplicates} duplicate case result${duplicates === 1 ? "" : "s"}`);
  if (unmatched) parts.push(`${unmatched} unmatched case result${unmatched === 1 ? "" : "s"}`);
  if (duplicates || unmatched) parts.push("Completeness cannot be confirmed");
  // Keep the runner's raw outcome visible even when its case rows disagree.
  if (historical || report.passed !== coverage.passed || duplicates || unmatched)
    parts.push(`Reported result: ${report.passed ? "passed" : "failed"}`);
  return parts.join(". ");
}

export interface ExpandedTestAssertion {
  assertion: FeatureAssertion | SegmentAssertion | VariableAssertion | ScenarioAssertion;
  assertionIndex: number;
  caseIndex?: number;
  caseCount?: number;
  label: string;
  matrixValues?: Record<string, unknown>;
}

export function getTestValuePresence(value: unknown): "missing" | "null" | "value" {
  if (value === undefined) {
    return "missing";
  }

  return value === null ? "null" : "value";
}

function getMatrixCombinations(matrix: AssertionMatrix) {
  const keys = Object.keys(matrix);

  if (keys.length === 0) {
    return [];
  }

  return keys.reduce<Array<Record<string, unknown>>>(
    (combinations, key) =>
      combinations.flatMap((combination) =>
        matrix[key].map((value) => ({ ...combination, [key]: value })),
      ),
    [{}],
  );
}

function applyCombinationToValue(value: unknown, combination: Record<string, unknown>) {
  if (typeof value === "string") {
    const placeholders = value.match(/\${{(.+?)}}/g);
    if (!placeholders) {
      return value;
    }

    if (placeholders.length === 1 && value.startsWith("${{") && value.endsWith("}}")) {
      const key = value.replace("${{", "").replace("}}", "").trim();
      return combination[key];
    }

    return value.replace(/\${{(.+?)}}/g, (_, key) => String(combination[key.trim()]));
  }

  if (Array.isArray(value)) {
    return value.map((item) => applyCombinationToValue(item, combination));
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, applyCombinationToValue(item, combination)]),
    );
  }

  return value;
}

function applyCombinationToContext(
  context: Record<string, unknown> | undefined,
  combination: Record<string, unknown>,
) {
  return Object.fromEntries(
    Object.entries(context || {}).map(([key, value]) => [
      key,
      applyCombinationToValue(value, combination),
    ]),
  );
}

function applyCombinationToAssertion(
  test: Test,
  assertion: FeatureAssertion | SegmentAssertion | VariableAssertion | ScenarioAssertion,
  combination: Record<string, unknown>,
) {
  const result = {
    ...assertion,
    context: applyCombinationToContext(assertion.context, combination),
  };
  delete result.matrix;

  if (result.description) {
    result.description = String(applyCombinationToValue(result.description, combination));
  }

  if ("feature" in test) {
    const featureResult = result as FeatureAssertion;
    featureResult.environment = applyCombinationToValue(
      featureResult.environment,
      combination,
    ) as FeatureAssertion["environment"];
    featureResult.target = applyCombinationToValue(
      featureResult.target,
      combination,
    ) as FeatureAssertion["target"];
    const at = applyCombinationToValue(featureResult.at, combination);
    featureResult.at = (
      typeof at === "string" ? (at.includes(".") ? parseFloat(at) : parseInt(at, 10)) : at
    ) as FeatureAssertion["at"];
    featureResult.stickyFeatures = applyCombinationToValue(
      featureResult.stickyFeatures,
      combination,
    ) as FeatureAssertion["stickyFeatures"];
    featureResult.stickyVariables = applyCombinationToValue(
      featureResult.stickyVariables,
      combination,
    ) as FeatureAssertion["stickyVariables"];
    featureResult.defaultVariationValue = applyCombinationToValue(
      featureResult.defaultVariationValue,
      combination,
    ) as FeatureAssertion["defaultVariationValue"];
    featureResult.defaultVariableValues = applyCombinationToValue(
      featureResult.defaultVariableValues,
      combination,
    ) as FeatureAssertion["defaultVariableValues"];
    featureResult.expectedToBeEnabled = applyCombinationToValue(
      featureResult.expectedToBeEnabled,
      combination,
    ) as FeatureAssertion["expectedToBeEnabled"];
    featureResult.expectedVariation = applyCombinationToValue(
      featureResult.expectedVariation,
      combination,
    ) as FeatureAssertion["expectedVariation"];
    featureResult.expectedVariables = applyCombinationToValue(
      featureResult.expectedVariables,
      combination,
    ) as FeatureAssertion["expectedVariables"];
    featureResult.expectedEvaluations = applyCombinationToValue(
      featureResult.expectedEvaluations,
      combination,
    ) as FeatureAssertion["expectedEvaluations"];
    featureResult.children = applyCombinationToValue(
      featureResult.children,
      combination,
    ) as FeatureAssertion["children"];
  }
  if ("segment" in test) {
    const segmentResult = result as SegmentAssertion;
    segmentResult.expectedToMatch = applyCombinationToValue(
      segmentResult.expectedToMatch,
      combination,
    ) as SegmentAssertion["expectedToMatch"];
  }
  if ("variable" in test || "scenario" in test) {
    const checkResult = result as VariableAssertion | ScenarioAssertion;
    checkResult.environment = applyCombinationToValue(
      checkResult.environment,
      combination,
    ) as VariableAssertion["environment"];
    checkResult.target = applyCombinationToValue(
      checkResult.target,
      combination,
    ) as VariableAssertion["target"];
    const at = applyCombinationToValue(checkResult.at, combination);
    checkResult.at = (
      typeof at === "string" ? (at.includes(".") ? parseFloat(at) : parseInt(at, 10)) : at
    ) as VariableAssertion["at"];
    checkResult.stickyFeatures = applyCombinationToValue(
      checkResult.stickyFeatures,
      combination,
    ) as VariableAssertion["stickyFeatures"];
    checkResult.stickyVariables = applyCombinationToValue(
      checkResult.stickyVariables,
      combination,
    ) as VariableAssertion["stickyVariables"];
    checkResult.checks = applyCombinationToValue(
      checkResult.checks,
      combination,
    ) as VariableAssertion["checks"];
    checkResult.children = applyCombinationToValue(
      checkResult.children,
      combination,
    ) as VariableAssertion["children"];

    if ("variable" in test) {
      const variableResult = checkResult as VariableAssertion;
      variableResult.expectedValue = applyCombinationToValue(
        variableResult.expectedValue,
        combination,
      ) as VariableAssertion["expectedValue"];
      variableResult.defaultVariableValue = applyCombinationToValue(
        variableResult.defaultVariableValue,
        combination,
      ) as VariableAssertion["defaultVariableValue"];
      variableResult.expectedEvaluation = applyCombinationToValue(
        variableResult.expectedEvaluation,
        combination,
      ) as VariableAssertion["expectedEvaluation"];
    }
  }

  return result;
}

export function expandTestAssertions(test: Test): ExpandedTestAssertion[] {
  if (!Array.isArray(test.assertions)) return [];
  return test.assertions.flatMap((assertion, assertionIndex) => {
    const assertionLabel = assertion.key || String(assertionIndex + 1);

    if (!assertion.matrix) {
      return [
        {
          assertion: { ...assertion },
          assertionIndex,
          label: assertionLabel,
        },
      ];
    }

    const combinations = getMatrixCombinations(assertion.matrix);
    return combinations.map((combination, caseIndex) => ({
      assertion: applyCombinationToAssertion(test, assertion, combination),
      assertionIndex,
      caseIndex,
      caseCount: combinations.length,
      label: `${assertionLabel}.${caseIndex + 1}`,
      matrixValues: combination,
    }));
  });
}

export function getTestAssertionPermalink(testKey: string, assertionLabel: string) {
  return `${testKey}:${assertionLabel}`;
}

export type TestCheckPathPart =
  | [type: "key", value: string]
  | [type: "index", value: number]
  | [type: "child", value: number];

export function getTestCheckDisplayLabel(
  check: TestCheck,
  checkIndex: number,
  parentLabel?: string,
): string {
  const label = check.key || String(checkIndex + 1);
  return parentLabel ? `${parentLabel}.${label}` : label;
}

export function getTestCheckPath(
  check: TestCheck,
  checkIndex: number,
  parentPath: TestCheckPathPart[] = [],
): TestCheckPathPart[] {
  const part: TestCheckPathPart =
    typeof check.key === "string" ? ["key", check.key] : ["index", checkIndex];
  return [...parentPath, part];
}

export function getTestCheckPermalink(
  testKey: string,
  assertionLabel: string,
  checkPath: TestCheckPathPart[],
) {
  return `${getTestAssertionPermalink(testKey, assertionLabel)}:check:${JSON.stringify(checkPath)}`;
}
