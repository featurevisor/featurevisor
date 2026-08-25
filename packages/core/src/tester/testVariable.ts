import type {
  DatafileContent,
  TestResult,
  TestResultAssertion,
  TestResultAssertionError,
  TestVariable,
} from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";

import type { DatafileContentByKey, TestProjectOptions } from "./testProject";
import { checkIfArraysAreEqual, checkIfObjectsAreEqual } from "./helpers";

function valuesAreEqual(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return checkIfArraysAreEqual(expected, actual);
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    return checkIfObjectsAreEqual(expected, actual);
  }
  return expected === actual;
}

export async function testVariable(
  test: TestVariable,
  options: TestProjectOptions,
  datafileContentByKey: DatafileContentByKey,
): Promise<TestResult> {
  const startedAt = Date.now();
  const result: TestResult = {
    type: "variable",
    key: test.variable,
    passed: true,
    duration: 0,
    assertions: [],
  };

  for (const assertion of test.assertions) {
    const assertionStartedAt = Date.now();
    const assertionResult: TestResultAssertion = {
      description: assertion.description || "Variable assertion",
      passed: true,
      duration: 0,
      errors: [],
    };
    const targetKey = `${assertion.environment || false}-target-${assertion.target}`;
    const datafile =
      (assertion.target && datafileContentByKey.get(targetKey)) ||
      datafileContentByKey.get(assertion.environment || false);
    const f = createFeaturevisor({
      datafile: datafile as DatafileContent,
      stickyVariables: assertion.stickyVariables,
      logLevel: options.quiet ? "fatal" : options.verbose ? "debug" : "warn",
    });
    const evaluation = f.evaluateVariable(test.variable, assertion.context || {}, {
      defaultVariableValue: assertion.defaultVariableValue,
    });

    if (
      typeof assertion.expectedValue !== "undefined" &&
      !valuesAreEqual(assertion.expectedValue, evaluation.variableValue)
    ) {
      assertionResult.passed = false;
      result.passed = false;
      assertionResult.errors!.push({
        type: "variable",
        expected: assertion.expectedValue as TestResultAssertionError["expected"],
        actual: evaluation.variableValue as TestResultAssertionError["actual"],
        details: { variableKey: test.variable },
      });
    }

    for (const [key, expected] of Object.entries(assertion.expectedEvaluation || {})) {
      if (evaluation[key] !== expected) {
        assertionResult.passed = false;
        result.passed = false;
        assertionResult.errors!.push({
          type: "evaluation",
          expected: expected as TestResultAssertionError["expected"],
          actual: evaluation[key] as TestResultAssertionError["actual"],
          details: { evaluationType: "variable", evaluationKey: key },
        });
      }
    }

    assertionResult.duration = Date.now() - assertionStartedAt;
    result.assertions.push(assertionResult);
  }

  result.duration = Date.now() - startedAt;
  return result;
}
