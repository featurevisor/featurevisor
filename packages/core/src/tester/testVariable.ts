import type {
  Context,
  DatafileContent,
  VariableKey,
  TestResult,
  TestResultAssertion,
  TestResultAssertionError,
  TestVariable,
  VariableAssertion,
  VariableChildAssertion,
  TestScenario,
  ScenarioAssertion,
  ScenarioChildAssertion,
  Segment,
} from "@featurevisor/types";
import { createFeaturevisor, MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";
import type { Evaluation, OverrideOptions } from "@featurevisor/sdk";

import type { DatafileContentByKey, TestProjectOptions } from "./testProject";
import { getMissingDatafileMessage, getTestDatafileKey } from "./datafileKey";
import { createTestDiagnosticHandler } from "./diagnostics";
import { checkIfArraysAreEqual, checkIfObjectsAreEqual } from "./helpers";
import { getCheckReferences, runVariableChecks } from "./checks";
import { assertSegmentReferencesInDatafile, prepareSegmentEvaluations } from "./segments";

function valuesAreEqual(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return checkIfArraysAreEqual(expected, actual);
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    return checkIfObjectsAreEqual(expected, actual);
  }
  return expected === actual;
}

type VariableEvaluator = {
  isEnabled: (feature: string) => boolean;
  getVariation: (feature: string) => string | null;
  getVariable: (...args: any[]) => unknown;
  evaluateVariable: (
    variableKey: VariableKey,
    context?: Context,
    options?: OverrideOptions,
  ) => Evaluation;
};

function testVariableExpectation(
  evaluator: VariableEvaluator,
  variableKey: VariableKey | undefined,
  assertion:
    | VariableAssertion
    | VariableChildAssertion
    | ScenarioAssertion
    | ScenarioChildAssertion,
  assertionResult: TestResultAssertion,
  result: TestResult,
  datafile: DatafileContent,
  sdkErrors: string[],
  segments: Record<string, Segment>,
  segmentFeatures: Map<string, string>,
  childIndex?: number,
) {
  const expectation = assertion as VariableAssertion;
  if (
    variableKey === undefined &&
    assertion.checks === undefined &&
    !("children" in assertion && assertion.children?.length)
  ) {
    assertionResult.errors!.push({
      type: "check",
      expected: "checks or children",
      actual: undefined,
      message: "Scenario assertions require checks or children",
      details: { childIndex },
    });
    assertionResult.passed = result.passed = false;
    return;
  }
  const evaluation =
    variableKey && (expectation.expectedValue !== undefined || expectation.expectedEvaluation)
      ? evaluator.evaluateVariable(
          variableKey,
          {},
          {
            defaultVariableValue: expectation.defaultVariableValue,
          },
        )
      : undefined;
  const details = { variableKey, ...(typeof childIndex === "number" ? { childIndex } : {}) };

  if (
    typeof expectation.expectedValue !== "undefined" &&
    !valuesAreEqual(expectation.expectedValue, evaluation?.variableValue)
  ) {
    assertionResult.passed = false;
    result.passed = false;
    assertionResult.errors!.push({
      type: "variable",
      expected: expectation.expectedValue as TestResultAssertionError["expected"],
      actual: evaluation?.variableValue as TestResultAssertionError["actual"],
      details,
    });
  }

  for (const [key, expected] of Object.entries(expectation.expectedEvaluation || {})) {
    if (!valuesAreEqual(expected, evaluation?.[key])) {
      assertionResult.passed = false;
      result.passed = false;
      assertionResult.errors!.push({
        type: "evaluation",
        expected: expected as TestResultAssertionError["expected"],
        actual: evaluation?.[key] as TestResultAssertionError["actual"],
        details: {
          evaluationType: "variable",
          evaluationKey: key,
          ...(typeof childIndex === "number" ? { childIndex } : {}),
        },
      });
    }
  }
  if (assertion.checks !== undefined) {
    const errors = runVariableChecks(
      assertion.checks,
      (reference) => {
        const has = (v: object | undefined, k: string) =>
          !!v && Object.prototype.hasOwnProperty.call(v, k);
        if (reference.feature !== undefined) {
          if (
            !has(datafile.features, reference.feature) ||
            !has(datafile.features[reference.feature]?.variablesSchema, reference.variable)
          )
            throw new Error(
              `Feature variable "${reference.feature}.${reference.variable}" is absent from the selected datafile`,
            );
        } else if (!has(datafile.variables, reference.variable))
          throw new Error(
            `Global variable "${reference.variable}" is absent from the selected datafile`,
          );
        const before = sdkErrors.length;
        const value =
          reference.feature !== undefined
            ? evaluator.getVariable(reference.feature, reference.variable)
            : evaluator.getVariable(reference.variable);
        if (sdkErrors.length !== before) throw new Error(sdkErrors.slice(before).join("; "));
        return value;
      },
      variableKey,
      childIndex,
      (feature, property) => {
        if (!Object.prototype.hasOwnProperty.call(datafile.features, feature))
          throw new Error(`Feature "${feature}" is absent from the selected datafile`);
        const before = sdkErrors.length;
        const value =
          property === "enabled" ? evaluator.isEnabled(feature) : evaluator.getVariation(feature);
        if (sdkErrors.length !== before) throw new Error(sdkErrors.slice(before).join("; "));
        return value;
      },
      (segmentKey) => {
        if (!Object.prototype.hasOwnProperty.call(segments, segmentKey))
          throw new Error(`Segment "${segmentKey}" is absent from the test definitions`);
        const before = sdkErrors.length;
        const matched = evaluator.isEnabled(segmentFeatures.get(segmentKey)!);
        if (sdkErrors.length !== before) throw new Error(sdkErrors.slice(before).join("; "));
        return matched;
      },
    );
    if (errors.length) {
      assertionResult.errors!.push(...errors);
      assertionResult.passed = false;
      result.passed = false;
    }
  }
}

export async function testVariable(
  test: TestVariable | TestScenario,
  options: TestProjectOptions,
  datafileContentByKey: DatafileContentByKey,
): Promise<TestResult> {
  const startedAt = Date.now();
  const hasFeature = Object.prototype.hasOwnProperty.call(test, "feature");
  const hasSegment = Object.prototype.hasOwnProperty.call(test, "segment");
  const hasVariable = Object.prototype.hasOwnProperty.call(test, "variable");
  const hasScenario = Object.prototype.hasOwnProperty.call(test, "scenario");
  const variableKey = hasVariable ? (test as TestVariable).variable : undefined;
  const scenarioKey = hasScenario ? (test as TestScenario).scenario : undefined;
  const isScenario = hasScenario && !hasVariable;
  const result: TestResult = {
    type: hasScenario ? "scenario" : "variable",
    key: (hasScenario ? scenarioKey : variableKey) || "",
    passed: true,
    duration: 0,
    assertions: [],
  };

  if (Number(hasFeature) + Number(hasSegment) + Number(hasVariable) + Number(hasScenario) !== 1) {
    result.passed = false;
    result.assertions.push({
      description: "Test spec",
      passed: false,
      duration: 0,
      errors: [
        {
          type: "check",
          expected: "exactly one discriminator",
          actual: {
            feature: hasFeature,
            segment: hasSegment,
            variable: hasVariable,
            scenario: hasScenario,
          },
          message:
            'Test specs require exactly one of "feature", "segment", "variable", or "scenario"',
        },
      ],
    });
    return result;
  }

  if (isScenario && (!Array.isArray(test.assertions) || !test.assertions.length)) {
    result.passed = false;
    result.assertions.push({
      description: "Scenario spec",
      passed: false,
      duration: 0,
      errors: [
        {
          type: "check",
          expected: "at least one assertion",
          actual: test.assertions,
          message: "Scenario specs require at least one assertion",
        },
      ],
    });
    return result;
  }

  for (const assertion of test.assertions) {
    const assertionStartedAt = Date.now();
    const assertionResult: TestResultAssertion = {
      description:
        assertion.description || (isScenario ? "Scenario assertion" : "Variable assertion"),
      passed: true,
      duration: 0,
      errors: [],
    };
    const datafile = datafileContentByKey.get(
      getTestDatafileKey(assertion.environment, assertion.target),
    );

    if (!datafile) {
      assertionResult.passed = false;
      result.passed = false;
      assertionResult.errors!.push({
        type: "variable",
        expected: "datafile",
        actual: undefined,
        message: getMissingDatafileMessage(assertion.environment, assertion.target),
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

    // Validate every declared reference, including skipped branches and children,
    // without invoking a getter or changing evaluation observation counts.
    let preflightDetails: Record<string, unknown> = {};
    try {
      for (const [expectationIndex, expectation] of [
        assertion,
        ...(assertion.children || []),
      ].entries()) {
        if (expectation.checks === undefined) continue;
        preflightDetails = expectationIndex ? { childIndex: expectationIndex - 1 } : {};
        getCheckReferences(expectation.checks, variableKey);
        for (const [checkIndex, check] of expectation.checks.entries()) {
          preflightDetails = {
            ...(expectationIndex ? { childIndex: expectationIndex - 1 } : {}),
            checkIndex,
            checkKey: check.key,
            checkDescription: check.description,
          };
          for (const reference of getCheckReferences([check], variableKey)) {
            const has = (value: object | undefined, key: string) =>
              !!value && Object.prototype.hasOwnProperty.call(value, key);
            if (reference.segment !== undefined) {
              if (!has(test._segments, reference.segment))
                throw new Error(
                  `Segment "${reference.segment}" is absent from the test definitions`,
                );
              assertSegmentReferencesInDatafile(reference.segment, datafile, test._segments || {});
            } else if (reference.feature !== undefined) {
              if (!has(datafile.features, reference.feature))
                throw new Error(
                  `Feature "${reference.feature}" is absent from the selected datafile`,
                );
              if (
                reference.variable !== undefined &&
                !has(datafile.features[reference.feature].variablesSchema, reference.variable)
              )
                throw new Error(
                  `Feature variable "${reference.feature}.${reference.variable}" is absent from the selected datafile`,
                );
            } else if (
              reference.variable !== undefined &&
              !has(datafile.variables, reference.variable)
            ) {
              throw new Error(
                `Global variable "${reference.variable}" is absent from the selected datafile`,
              );
            }
          }
        }
      }
    } catch (error) {
      assertionResult.passed = result.passed = false;
      assertionResult.errors!.push({
        type: "check",
        expected: "valid check references",
        actual: error instanceof Error ? error.message : String(error),
        message: error instanceof Error ? error.message : String(error),
        details: preflightDetails,
      });
      assertionResult.duration = Date.now() - assertionStartedAt;
      result.assertions.push(assertionResult);
      continue;
    }

    const at = assertion.at;
    const onEvaluation = options.onEvaluation;
    const sdkErrors: string[] = [];
    const segmentEvaluations = prepareSegmentEvaluations(datafile, test._segments);
    const f = createFeaturevisor({
      datafile: segmentEvaluations.datafile,
      context: assertion.context || {},
      stickyFeatures: assertion.stickyFeatures,
      stickyVariables: assertion.stickyVariables,
      modules:
        typeof at !== "undefined" || onEvaluation
          ? [
              {
                name: "tester",
                bucketValue:
                  typeof at !== "undefined" ? () => at * (MAX_BUCKETED_NUMBER / 100) : undefined,
                afterEvaluation: onEvaluation
                  ? (evaluation) => {
                      if (!segmentEvaluations.isSynthetic(evaluation))
                        onEvaluation(evaluation, assertion);
                      return evaluation;
                    }
                  : undefined,
              },
            ]
          : [],
      logLevel: options.quiet ? "fatal" : options.verbose ? "debug" : "warn",
      onDiagnostic: createTestDiagnosticHandler(options),
    });
    f.on("error", (event) => {
      sdkErrors.push(event.diagnostic?.message || "SDK evaluation error");
    });

    try {
      testVariableExpectation(
        f,
        variableKey,
        assertion,
        assertionResult,
        result,
        datafile,
        sdkErrors,
        test._segments || {},
        segmentEvaluations.featureKeys,
      );

      for (let childIndex = 0; childIndex < (assertion.children || []).length; childIndex++) {
        const childAssertion = assertion.children![childIndex];
        const child = f.spawn(childAssertion.context || {}, {
          stickyFeatures: childAssertion.stickyFeatures,
          stickyVariables: childAssertion.stickyVariables,
        });
        try {
          testVariableExpectation(
            child,
            variableKey,
            childAssertion,
            assertionResult,
            result,
            datafile,
            sdkErrors,
            test._segments || {},
            segmentEvaluations.featureKeys,
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
