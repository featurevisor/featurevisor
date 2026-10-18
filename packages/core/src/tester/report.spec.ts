import type { Test, TestResult, TestResultAssertionError } from "@featurevisor/types";
import { execFileSync } from "child_process";

import {
  createTestReport,
  createReportSpec,
  appendReportSpec,
  appendReportError,
  reportValue,
  formatRerun,
  formatCaseLabel,
  printReportSummary,
} from "./report";
import { printTestResult } from "./printTestResult";

function fixture(type: TestResult["type"] = "scenario") {
  const id = JSON.stringify(["staging", type, "limits.spec", "capacity", 2]);
  const test = {
    key: "limits.spec",
    [type]: "limits",
    _test: {
      source: "sets/staging/tests/scenarios/limits.spec.yml",
      set: "staging",
      entityType: type,
    },
    assertions: [
      {
        description: "Capacity",
        context: { country: "nl" },
        target: "web",
        _case: { id, assertionIndex: 4, matrixIndex: 2, matrixValues: { country: "nl" } },
      },
    ],
  } as unknown as Test;
  const error: TestResultAssertionError = {
    type: "check",
    expected: true,
    actual: false,
    details: {
      childIndex: 0,
      checkIndex: 1,
      checkKey: "bounds",
      checkDescription: "Stay within capacity",
      evaluated: [
        {
          path: [1, "and", 0],
          reference: { variable: "minimum" },
          operator: "lessThan",
          expected: 10,
          actual: 12,
        },
      ],
    },
  };
  const result: TestResult = {
    type,
    key: "limits",
    passed: false,
    duration: 1,
    assertions: [{ description: "Capacity", passed: false, duration: 1, errors: [error] }],
  };
  return { test, result, error, id };
}

describe("core: structured test reporting", () => {
  afterEach(() => jest.restoreAllMocks());

  it("retains authored provenance and exact matrix identity after filtering", () => {
    const { test, result, id } = fixture();
    const report = createReportSpec(test, result, { target: ["web", "mobile"] });
    expect(report).toMatchObject({
      source: "sets/staging/tests/scenarios/limits.spec.yml",
      set: "staging",
    });
    expect(report.cases[0]).toMatchObject({
      id,
      environment: null,
      target: "web",
      context: { country: "nl" },
      matrixValues: { country: "nl" },
      errors: [{ path: ["children", 0, "checks", 1] }],
    });
    expect(report.cases[0].rerun.args).toEqual([
      "test",
      `--case=${id}`,
      "--set=staging",
      "--target=web",
      "--target=mobile",
    ]);
    expect(report.cases[0].errors[0].details?.evaluated).toEqual([
      expect.objectContaining({ path: ["children", 0, "checks", 1, "and", 0] }),
    ]);
    expect(result.assertions[0].errors![0].details!.evaluated[0].path).toEqual([1, "and", 0]);
  });

  it("includes authored assertion indices for entity check paths", () => {
    const { test, result } = fixture("variable");
    const report = createReportSpec(test, result);
    expect(report.cases[0].errors[0].path).toEqual(["assertions", 4, "children", 0, "checks", 1]);
    expect(report.cases[0].errors[0].message).toBe("Check did not match");
  });

  it("retains an explicitly supplied project directory for commands run outside the project", () => {
    const { test, result } = fixture();
    const report = createReportSpec(test, result, { rootDirectoryPath: "../my project" });
    expect(report.cases[0].rerun.args).toContain("--rootDirectoryPath=../my project");
  });

  it.each([
    ["feature", "flag", {}, ["expectedToBeEnabled"]],
    ["feature", "variation", {}, ["expectedVariation"]],
    ["segment", "segment", {}, ["expectedToMatch"]],
    ["feature", "variable", { variableKey: "size" }, ["expectedVariables", "size"]],
    ["variable", "variable", {}, ["expectedValue"]],
    ["variable", "evaluation", { evaluationKey: "reason" }, ["expectedEvaluation", "reason"]],
    [
      "feature",
      "evaluation",
      { evaluationType: "flag", evaluationKey: "reason" },
      ["expectedEvaluations", "flag", "reason"],
    ],
    [
      "feature",
      "evaluation",
      { evaluationType: "variable", variableKey: "size", evaluationKey: "reason" },
      ["expectedEvaluations", "variables", "size", "reason"],
    ],
  ])("maps %s %s failures to authoring fields", (type, errorType, details, path) => {
    const { test, result } = fixture(type as TestResult["type"]);
    result.assertions[0].errors = [
      {
        type: errorType as TestResultAssertionError["type"],
        details: { ...(details as object), childIndex: 0 },
        expected: null,
        actual: undefined,
      },
    ];
    const error = createReportSpec(test, result).cases[0].errors[0];
    expect(error.path).toEqual(["assertions", 4, "children", 0, ...(path as string[])]);
    expect(error.expected).toBeNull();
    expect(error.actual).toEqual({ $type: "undefined" });
  });

  it("uses explicit markers for missing and nonfinite values without conflating null", () => {
    const encoded = JSON.parse(
      JSON.stringify(
        reportValue({
          a: undefined,
          b: null,
          c: [undefined, NaN, Infinity, -Infinity],
          error: new Error("failed"),
        }),
      ),
    );
    expect(encoded).toEqual({
      a: { $type: "undefined" },
      b: null,
      c: [{ $type: "undefined" }, { $type: "NaN" }, { $type: "Infinity" }, { $type: "-Infinity" }],
      error: { name: "Error", message: "failed" },
    });
  });

  it("counts cases, not individual checks, separately from entity assertions", () => {
    const report = createTestReport();
    const scenario = fixture();
    appendReportSpec(report, createReportSpec(scenario.test, scenario.result));
    const entity = fixture("feature");
    entity.result.passed = true;
    entity.result.assertions[0].passed = true;
    delete entity.result.assertions[0].errors;
    appendReportSpec(report, createReportSpec(entity.test, entity.result));
    expect(report.passed).toBe(false);
    expect(report.summary).toEqual({
      specs: { passed: 1, failed: 1 },
      assertions: { passed: 1, failed: 1 },
      entitySpecs: { passed: 1, failed: 0 },
      entityAssertions: { passed: 1, failed: 0 },
      scenarioSpecs: { passed: 0, failed: 1 },
      scenarioCases: { passed: 0, failed: 1 },
    });
    expect(report.results[1].cases[0].errors).toEqual([]);
  });

  it("fails the report on infrastructure errors even with zero cases", () => {
    const report = createTestReport();
    appendReportError(report, new Error("No matching case"));
    appendReportError(report, "Could not load datafile");
    expect(report.passed).toBe(false);
    expect(report.errors).toEqual([
      { message: "No matching case" },
      { message: "Could not load datafile" },
    ]);
    expect(report.summary.assertions).toEqual({ passed: 0, failed: 0 });
  });

  it("shell quotes identities containing spaces, apostrophes and command characters", () => {
    const args = [
      "test",
      `--case=${JSON.stringify([null, "scenario", "it's $HOME; echo nope", 1, 0])}`,
    ];
    const command = formatRerun({ command: "printf '%s\\n'", args });
    expect(execFileSync("sh", ["-c", command], { encoding: "utf8" }).trim().split("\n")).toEqual(
      args,
    );
  });

  it("leaves safe rerun arguments readable while quoting only unsafe values", () => {
    const args = [
      "test",
      "--case=plain-id",
      "--set=preview",
      "--target=web",
      "--rootDirectoryPath=../my project",
      "--target=$(echo unsafe)",
    ];
    expect(formatRerun({ command: "npx featurevisor", args })).toBe(
      "npx featurevisor test --case='plain-id' --set=preview --target=web --rootDirectoryPath='../my project' --target='$(echo unsafe)'",
    );
    expect(
      execFileSync("sh", ["-c", formatRerun({ command: "printf '%s\\n'", args })], {
        encoding: "utf8",
      })
        .trim()
        .split("\n"),
    ).toEqual(args);
  });

  it("prints infrastructure errors before a clear not run message", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const report = createTestReport();
    appendReportError(report, new Error("features/broken.yml:2:3: Invalid YAML"));
    printReportSummary(report);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.invocationCallOrder[0]).toBeLessThan(log.mock.invocationCallOrder[0]);
    expect(log).toHaveBeenCalledWith("Tests did not run.");
    expect(log.mock.calls.flat().join("\n")).not.toContain("Total cases:");
    expect(report.summary.assertions).toEqual({ passed: 0, failed: 0 });
  });

  it("retains completed counts on partial failure and omits empty scenario rows", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const report = createTestReport();
    report.summary.entitySpecs.passed = 1;
    report.summary.entityAssertions.passed = 2;
    report.summary.assertions.passed = 2;
    appendReportError(report, "Next set could not be loaded");
    printReportSummary(report);
    expect(error.mock.invocationCallOrder[0]).toBeLessThan(log.mock.invocationCallOrder[0]);
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("Total cases: 2 passed, 0 failed");
    expect(output).not.toContain("Tests did not run");
    expect(output).not.toContain("Scenario specs:");
    expect(output).not.toContain("Scenario cases:");
  });

  it("labels human cases without changing opaque ids or failing on foreign ids", () => {
    const { test, result, id } = fixture();
    const testCase = createReportSpec(test, result).cases[0];
    expect(formatCaseLabel(testCase, 0, test.assertions[0])).toBe(
      'Capacity (case 3; matrix country="nl"; target web)',
    );
    expect(testCase.id).toBe(id);
    expect(formatCaseLabel({ ...testCase, id: "foreign-id" }, 0, test.assertions[0])).toBe(
      'Capacity (case 3; matrix country="nl"; target web)',
    );
  });

  it("renders PowerShell commands with its own literal quoting", () => {
    const args = ["test", "--case=it's $HOME; %PATH% & echo", "--target=web space"];
    expect(formatRerun({ command: "npx featurevisor", args }, "powershell")).toBe(
      "npx featurevisor test --case='it''s $HOME; %PATH% & echo' --target='web space'",
    );
  });

  it("prints readable feature variable selections, variation and unkeyed override numbers", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const report = createTestReport();
    report.coverage = {
      mode: "observed-selections",
      selections: [
        {
          set: "preview",
          environment: "production",
          target: "web",
          featureKey: "checkout",
          variableKey: "limit",
          ruleKey: "everyone",
          variation: "treatment",
          overrideIndex: 0,
        },
      ],
    };
    printReportSummary(report);
    expect(log.mock.calls.flat().join("\n")).toContain(
      'feature checkout variable limit (set preview, environment production, target web): rule everyone, variation "treatment", override 1',
    );
    expect(log.mock.calls.flat().join("\n")).toContain("Total cases: 0 passed, 0 failed");
  });

  it("prints named checks with authored paths and reruns, without false coverage claims", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const { test, result } = fixture();
    const leaf = result.assertions[0].errors![0].details!.evaluated[0];
    leaf.reference.feature = undefined;
    leaf.reference.path = undefined;
    leaf.compareTo = undefined;
    printTestResult(
      result,
      "tests/scenarios/limits.spec.yml",
      "",
      createReportSpec(test, result),
      test,
    );
    const report = createTestReport();
    report.coverage = { mode: "observed-selections", selections: [] };
    report.uncovered = [{ set: null, features: [], variables: [] }];
    printReportSummary(report);
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain('check "bounds" (Stay within capacity)');
    expect(output).toContain("children.1.checks.2.and.1");
    expect(output).toContain("Rerun (POSIX shell): npx featurevisor");
    expect(output).toContain("not branch coverage");
    expect(output).toContain("not evaluation coverage");
    expect(output).toContain("No selections observed");
    expect(output).toContain("global variable minimum = 12");
    expect(output).not.toContain("[object Object]");
    expect(output).not.toContain("$type");
    expect(output).not.toContain("variable undefined");
  });
});
