import type {
  Context,
  DatafileContent,
  GlobalVariableKey,
  TestResult,
  TestResultAssertion,
  TestResultAssertionError,
  TestVariable,
  VariableAssertion,
  VariableChildAssertion,
} from "@featurevisor/types";
import { createFeaturevisor, MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";
import type { Evaluation, OverrideOptions } from "@featurevisor/sdk";

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

type GlobalVariableEvaluator = {
  evaluateVariable: (
    variableKey: GlobalVariableKey,
    context?: Context,
    options?: OverrideOptions,
  ) => Evaluation;
};

function testVariableExpectation(
  evaluator: GlobalVariableEvaluator,
  variableKey: GlobalVariableKey,
  assertion: VariableAssertion | VariableChildAssertion,
  assertionResult: TestResultAssertion,
  result: TestResult,
  childIndex?: number,
) {
  const evaluation = evaluator.evaluateVariable(
    variableKey,
    {},
    {
      defaultVariableValue: assertion.defaultVariableValue,
    },
  );
  const details = { variableKey, ...(typeof childIndex === "number" ? { childIndex } : {}) };

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
      details,
    });
  }

  for (const [key, expected] of Object.entries(assertion.expectedEvaluation || {})) {
    if (!valuesAreEqual(expected, evaluation[key])) {
      assertionResult.passed = false;
      result.passed = false;
      assertionResult.errors!.push({
        type: "evaluation",
        expected: expected as TestResultAssertionError["expected"],
        actual: evaluation[key] as TestResultAssertionError["actual"],
        details: {
          evaluationType: "variable",
          evaluationKey: key,
          ...(typeof childIndex === "number" ? { childIndex } : {}),
        },
      });
    }
  }
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
    const datafile = assertion.target
      ? datafileContentByKey.get(targetKey)
      : datafileContentByKey.get(assertion.environment || false);

    if (!datafile) {
      assertionResult.passed = false;
      result.passed = false;
      assertionResult.errors!.push({
        type: "variable",
        expected: "datafile",
        actual: undefined,
        message: `datafile not found for environment "${assertion.environment || "none"}"${
          assertion.target ? ` and target "${assertion.target}"` : ""
        }`,
      });
      assertionResult.duration = Date.now() - assertionStartedAt;
      result.assertions.push(assertionResult);
      continue;
    }

    if (options.showDatafile) {
      console.log("");
      console.log(JSON.stringify(datafile, null, 2));
      console.log("");
    }

    const at = assertion.at;
    const f = createFeaturevisor({
      datafile: datafile as DatafileContent,
      context: assertion.context || {},
      stickyFeatures: assertion.stickyFeatures,
      stickyVariables: assertion.stickyVariables,
      modules:
        typeof at !== "undefined"
          ? [
              {
                name: "tester",
                bucketValue: () => at * (MAX_BUCKETED_NUMBER / 100),
              },
            ]
          : [],
      logLevel: options.quiet ? "fatal" : options.verbose ? "debug" : "warn",
    });

    try {
      testVariableExpectation(f, test.variable, assertion, assertionResult, result);

      for (let childIndex = 0; childIndex < (assertion.children || []).length; childIndex++) {
        const childAssertion = assertion.children![childIndex];
        const child = f.spawn(childAssertion.context || {}, {
          stickyFeatures: childAssertion.stickyFeatures,
          stickyVariables: childAssertion.stickyVariables,
        });
        try {
          testVariableExpectation(
            child,
            test.variable,
            childAssertion,
            assertionResult,
            result,
            childIndex,
          );
        } finally {
          child.close();
        }
      }
    } finally {
      await f.close();
    }

    assertionResult.duration = Date.now() - assertionStartedAt;
    result.assertions.push(assertionResult);
  }

  result.duration = Date.now() - startedAt;
  return result;
}
