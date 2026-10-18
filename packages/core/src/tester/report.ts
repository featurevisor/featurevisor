import type { Test, TestResult, TestResultAssertionError } from "@featurevisor/types";
import type { CoverageSelection } from "./coverage";
import type { TestInputProvenance } from "./provenance";

export interface TestCounter {
  passed: number;
  failed: number;
}

export interface ReportError {
  message: string;
  type?: string;
  path?: Array<string | number>;
  expected?: unknown;
  actual?: unknown;
  details?: Record<string, unknown>;
}

export interface ReportCase {
  id: string;
  description: string;
  environment: string | null;
  target: string | null;
  context: Record<string, unknown>;
  matrixValues: Record<string, unknown>;
  passed: boolean;
  errors: ReportError[];
  rerun: { command: string; args: string[]; argumentEncoding?: "maven-exec" };
}

export interface ReportSpec {
  type: TestResult["type"];
  key: string;
  source: string;
  set: string | null;
  passed: boolean;
  cases: ReportCase[];
}

export interface TestReport {
  schemaVersion: 1;
  provenance?: TestInputProvenance;
  runner: string;
  passed: boolean;
  summary: Record<
    "specs" | "assertions" | "entitySpecs" | "entityAssertions" | "scenarioSpecs" | "scenarioCases",
    TestCounter
  >;
  results: ReportSpec[];
  errors: ReportError[];
  uncovered?: Array<{ set: string | null; features: string[]; variables: string[] }>;
  coverage?: { mode: "observed-selections"; selections: CoverageSelection[] };
}

export function createTestReport(runner = "javascript"): TestReport {
  return {
    schemaVersion: 1,
    runner,
    passed: true,
    summary: {
      specs: { passed: 0, failed: 0 },
      assertions: { passed: 0, failed: 0 },
      entitySpecs: { passed: 0, failed: 0 },
      entityAssertions: { passed: 0, failed: 0 },
      scenarioSpecs: { passed: 0, failed: 0 },
      scenarioCases: { passed: 0, failed: 0 },
    },
    results: [],
    errors: [],
  };
}

/** Report missing values explicitly rather than losing them during JSON encoding. */
export function reportValue(value: unknown): unknown {
  if (value === undefined) return { $type: "undefined" };
  if (typeof value === "number" && !Number.isFinite(value)) return { $type: String(value) };
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map(reportValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, reportValue(entry)]),
    );
  }
  return value;
}

function expectedField(error: TestResultAssertionError, type: TestResult["type"]): string[] {
  if (error.type === "flag") return ["expectedToBeEnabled"];
  if (error.type === "variation") return ["expectedVariation"];
  if (error.type === "segment") return ["expectedToMatch"];
  if (error.type === "variable")
    return type === "variable"
      ? ["expectedValue"]
      : ["expectedVariables", error.details?.variableKey];
  if (error.type === "evaluation") {
    if (type === "variable") return ["expectedEvaluation", error.details?.evaluationKey];
    if (error.details?.variableKey !== undefined)
      return [
        "expectedEvaluations",
        "variables",
        error.details.variableKey,
        error.details.evaluationKey,
      ];
    return ["expectedEvaluations", error.details?.evaluationType, error.details?.evaluationKey];
  }
  return [];
}

export function createReportSpec(
  test: Test,
  result: TestResult,
  options: { set?: string | null; target?: string | string[]; rootDirectoryPath?: string } = {},
): ReportSpec {
  const metadata = (test as any)._test;
  const set = metadata?.set ?? options.set ?? null;
  return {
    type: result.type,
    key: result.key,
    source: metadata?.source || test.key || "",
    set,
    passed: result.passed,
    cases: result.assertions.map((assertion, index) => {
      const input = test.assertions[index] as any;
      const provenance = input?._case;
      const id = provenance?.id || JSON.stringify([set, result.type, test.key || "", index, null]);
      const args = ["test", `--case=${id}`];
      if (options.rootDirectoryPath) args.push(`--rootDirectoryPath=${options.rootDirectoryPath}`);
      if (set !== null) args.push(`--set=${set}`);
      for (const target of Array.isArray(options.target)
        ? options.target
        : options.target
          ? [options.target]
          : []) {
        args.push(`--target=${target}`);
      }
      const prefix: Array<string | number> =
        result.type === "scenario" ? [] : ["assertions", provenance?.assertionIndex ?? index];
      const errors = (assertion.errors || []).map((error): ReportError => {
        const child = error.details?.childIndex;
        const base = [...prefix, ...(child !== undefined ? ["children", child] : [])];
        const path =
          error.type === "check"
            ? [
                ...base,
                "checks",
                ...(error.details?.checkIndex !== undefined ? [error.details.checkIndex] : []),
              ]
            : [...base, ...expectedField(error, result.type).filter((key) => key !== undefined)];
        const details = { ...error.details };
        if (Array.isArray(details.evaluated)) {
          details.evaluated = details.evaluated.map((leaf) => ({
            ...leaf,
            path: [...base, "checks", ...(leaf.path || [])],
          }));
        }
        return {
          type: error.type,
          message:
            error.message ||
            (error.type === "check"
              ? "Check did not match"
              : `${error.type} expectation did not match`),
          path,
          expected: reportValue(error.expected),
          actual: reportValue(error.actual),
          details: reportValue(details) as Record<string, unknown>,
        };
      });
      return {
        id,
        description: assertion.description,
        environment: input?.environment || null,
        target: input?.target || null,
        context: input?.context || {},
        matrixValues: provenance?.matrixValues || {},
        passed: assertion.passed,
        errors,
        rerun: { command: "npx featurevisor", args },
      };
    }),
  };
}

export function appendReportSpec(report: TestReport, spec: ReportSpec) {
  report.results.push(spec);
  if (!spec.passed) report.passed = false;
  const status = spec.passed ? "passed" : "failed";
  report.summary.specs[status]++;
  report.summary[spec.type === "scenario" ? "scenarioSpecs" : "entitySpecs"][status]++;
  for (const testCase of spec.cases) {
    const caseStatus = testCase.passed ? "passed" : "failed";
    report.summary.assertions[caseStatus]++;
    report.summary[spec.type === "scenario" ? "scenarioCases" : "entityAssertions"][caseStatus]++;
  }
}

export function appendReportError(report: TestReport, error: unknown) {
  report.passed = false;
  report.errors.push({ message: error instanceof Error ? error.message : String(error) });
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** The structured args are authoritative. Human commands name their supported shell. */
export function formatRerun(rerun: ReportCase["rerun"], shell: "posix" | "powershell" = "posix") {
  const quote = shell === "powershell" ? powerShellQuote : shellQuote;
  const args = rerun.args.map((argument) => {
    const option = /^(--[a-zA-Z][a-zA-Z0-9-]*=)(.*)$/s.exec(argument);
    if (option) {
      const [, flag, value] = option;
      return (
        flag + (flag === "--case=" || !/^[a-zA-Z0-9_./=-]+$/.test(value) ? quote(value) : value)
      );
    }
    return /^[a-zA-Z0-9_./=-]+$/.test(argument) ? argument : quote(argument);
  });
  return `${rerun.command} ${args.join(" ")}`;
}

export function formatCaseLabel(
  testCase: ReportCase,
  assertionIndex: number,
  source?: { key?: string; _case?: { assertionIndex?: number; matrixIndex?: number | null } },
): string {
  const matrixIndex = source?._case?.matrixIndex;
  const originalIndex = source?._case?.assertionIndex ?? assertionIndex;
  const label = testCase.description || source?.key || `assertion ${originalIndex + 1}`;
  const details = [
    source?.key && source.key !== label ? `key ${source.key}` : undefined,
    matrixIndex === undefined || matrixIndex === null ? undefined : `case ${matrixIndex + 1}`,
  ];
  if (Object.keys(testCase.matrixValues).length) {
    details.push(
      `matrix ${Object.entries(testCase.matrixValues)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(", ")}`,
    );
  }
  if (testCase.target) details.push(`target ${testCase.target}`);
  return `${label}${details.filter(Boolean).length ? ` (${details.filter(Boolean).join("; ")})` : ""}`;
}

export function printReportSummary(
  report: TestReport,
  errorMessages = report.errors.map((error) => error.message),
) {
  for (const message of errorMessages) console.error(message);
  if (
    report.errors.length &&
    report.summary.assertions.passed + report.summary.assertions.failed === 0
  ) {
    console.log("Tests did not run.");
    return;
  }
  const labels = {
    entitySpecs: "Entity specs",
    entityAssertions: "Entity assertions",
    scenarioSpecs: "Scenario specs",
    scenarioCases: "Scenario cases",
  };
  console.log("");
  for (const key of Object.keys(labels) as Array<keyof typeof labels>) {
    const counts = report.summary[key];
    if ((key === "scenarioSpecs" || key === "scenarioCases") && counts.passed + counts.failed === 0)
      continue;
    console.log(`${labels[key]}: ${counts.passed} passed, ${counts.failed} failed`);
  }
  console.log(
    `Total cases: ${report.summary.assertions.passed} passed, ${report.summary.assertions.failed} failed`,
  );
  if (report.uncovered) {
    console.log("\nDefinitions without associated specs (not evaluation coverage):");
    for (const entry of report.uncovered) {
      if (entry.set !== null) console.log(`  Set: ${entry.set}`);
      console.log(`  Features: ${entry.features.join(", ") || "none"}`);
      console.log(`  Global variables: ${entry.variables.join(", ") || "none"}`);
    }
  }
  if (report.coverage) {
    console.log("\nObserved rule and override selections (not branch coverage):");
    for (const entry of report.coverage.selections) {
      const owner = entry.featureKey
        ? `feature ${entry.featureKey}${entry.variableKey ? ` variable ${entry.variableKey}` : ""}`
        : `global variable ${entry.variableKey}`;
      const scope = [
        entry.set && `set ${entry.set}`,
        entry.environment && `environment ${entry.environment}`,
        entry.target && `target ${entry.target}`,
      ].filter(Boolean);
      const selection = [
        entry.ruleKey && `rule ${entry.ruleKey}`,
        entry.variation !== undefined && `variation ${JSON.stringify(entry.variation)}`,
        entry.overridePath && `override ${entry.overridePath.join(" > ")}`,
        entry.overrideIndex !== undefined && `override ${entry.overrideIndex + 1}`,
      ].filter(Boolean);
      console.log(
        `  ${owner}${scope.length ? ` (${scope.join(", ")})` : ""}: ${selection.join(", ")}`,
      );
    }
    if (!report.coverage.selections.length) console.log("  No selections observed");
  }
}
