import type {
  DatafileContent,
  TestFeature,
  TestResult,
  TestResultAssertion,
  TestResultAssertionError,
} from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";
import type { Featurevisor, FeaturevisorLogLevel, OverrideOptions } from "@featurevisor/sdk";
import { MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";

import { Datasource } from "../datasource";
import { ProjectConfig } from "../config";

import { checkIfArraysAreEqual, checkIfObjectsAreEqual } from "./helpers";
import type { DatafileContentByKey } from "./testProject";

function evaluationValuesAreEqual(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return checkIfArraysAreEqual(expected, actual);
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    return checkIfObjectsAreEqual(expected, actual);
  }
  return expected === actual;
}

export interface TestFeatureOptions {
  verbose?: boolean;
  quiet?: boolean;
  showDatafile?: boolean;
  [key: string]: any;
}

export async function testFeature(
  datasource: Datasource,
  projectConfig: ProjectConfig,
  test: TestFeature,
  options: TestFeatureOptions = {},
  datafileContentByKey: DatafileContentByKey,
): Promise<TestResult> {
  const testStartTime = Date.now();
  const featureKey = test.feature;

  const testResult: TestResult = {
    type: "feature",
    key: featureKey,

    // to be updated later
    notFound: false,
    duration: 0,
    passed: true,
    assertions: [],
  };

  for (let aIndex = 0; aIndex < test.assertions.length; aIndex++) {
    const assertionStartTime = Date.now();
    const assertion = test.assertions[aIndex];

    const testResultAssertion: TestResultAssertion = {
      description: assertion.description as string,
      duration: 0,
      passed: true,
      errors: [],
    };

    const targetDatafileKey = `${assertion.environment || false}-target-${assertion.target}`;
    const datafileContent = assertion.target
      ? datafileContentByKey.get(targetDatafileKey)
      : datafileContentByKey.get(assertion.environment || false);

    let logLevel: FeaturevisorLogLevel = "warn";
    if (options.verbose) {
      logLevel = "debug";
    } else if (options.quiet) {
      logLevel = "fatal";
    }

    const parsedFeature = await datasource.readFeature(featureKey);
    if (!parsedFeature) {
      testResult.notFound = true;
      testResult.passed = false;

      return testResult;
    }

    if (!datafileContent) {
      testResultAssertion.passed = false;
      testResult.passed = false;
      testResultAssertion.errors!.push({
        type: "flag",
        expected: "datafile",
        actual: undefined,
        message: `datafile not found for environment "${assertion.environment || "none"}"${
          assertion.target ? ` and target "${assertion.target}"` : ""
        }`,
      });
      testResultAssertion.duration = Date.now() - assertionStartTime;
      testResult.assertions.push(testResultAssertion);
      continue;
    }

    if (options.showDatafile) {
      console.log("");
      console.log(JSON.stringify(datafileContent, null, 2));
      console.log("");
    }

    const sdk: Featurevisor = createFeaturevisor({
      datafile: datafileContent as DatafileContent,
      stickyFeatures: assertion.sticky ? assertion.sticky : {},
      modules: [
        {
          name: "tester",
          bucketValue: ({ bucketValue }) => {
            if (typeof assertion.at !== "undefined") {
              return assertion.at * (MAX_BUCKETED_NUMBER / 100);
            }

            return bucketValue;
          },
        },
      ],
      logLevel,
    });

    try {
      let context = {};

      if (assertion.context) {
        context = {
          ...context,
          ...assertion.context,
        };
      }

      if (context) {
        sdk.setContext(context);
      }

      /**
       * expectedToBeEnabled
       */
      function testExpectedToBeEnabled(sdk, assertion, details = {}, evaluationContext = context) {
        const isEnabled = sdk.isEnabled(featureKey, evaluationContext);

        if (isEnabled !== assertion.expectedToBeEnabled) {
          testResult.passed = false;
          testResultAssertion.passed = false;

          (testResultAssertion.errors as TestResultAssertionError[]).push({
            type: "flag",
            expected: assertion.expectedToBeEnabled,
            actual: isEnabled,
            details,
          });
        }
      }

      if ("expectedToBeEnabled" in assertion) {
        testExpectedToBeEnabled(sdk, assertion);
      }

      /**
       * expectedVariation
       */
      function testExpectedVariation(sdk, assertion, details = {}, evaluationContext = context) {
        const overrideOptions: OverrideOptions = {};
        if (Object.prototype.hasOwnProperty.call(assertion, "defaultVariationValue")) {
          overrideOptions.defaultVariationValue = assertion.defaultVariationValue;
        }

        const variation = sdk.getVariation(featureKey, evaluationContext, overrideOptions);

        if (variation !== assertion.expectedVariation) {
          testResult.passed = false;
          testResultAssertion.passed = false;

          (testResultAssertion.errors as TestResultAssertionError[]).push({
            type: "variation",
            expected: assertion.expectedVariation,
            actual: variation,
            details,
          });
        }
      }

      if (typeof assertion.expectedVariation !== "undefined") {
        testExpectedVariation(sdk, assertion);
      }

      /**
       * expectedVariables
       */
      function testExpectedVariables(sdk, assertion, details = {}, evaluationContext = context) {
        Object.keys(assertion.expectedVariables).forEach(function (variableKey) {
          const expectedValue =
            assertion.expectedVariables && assertion.expectedVariables[variableKey];

          const overrideOptions: OverrideOptions = {};
          if (
            assertion.defaultVariableValues &&
            Object.prototype.hasOwnProperty.call(assertion.defaultVariableValues, variableKey)
          ) {
            overrideOptions.defaultVariableValue = assertion.defaultVariableValues[variableKey];
          }

          const actualValue = sdk.getVariable(
            featureKey,
            variableKey,
            evaluationContext,
            overrideOptions,
          );

          let passed;

          // Use feature from datafile so variable schema is always resolved (ResolvedVariableSchema)
          const featureFromDatafile = datafileContent?.features?.[featureKey];
          const variableSchema = featureFromDatafile?.variablesSchema?.[variableKey];

          if (!variableSchema) {
            testResult.passed = false;
            testResultAssertion.passed = false;

            (testResultAssertion.errors as TestResultAssertionError[]).push({
              type: "variable",
              expected: assertion.expectedVariation,
              actual: undefined,
              message: `schema for variable "${variableKey}" not found in feature`,
            });

            return;
          }

          if (variableSchema.type === "json") {
            // JSON type
            const parsedExpectedValue =
              typeof expectedValue === "string"
                ? JSON.parse(expectedValue as string)
                : expectedValue;

            if (Array.isArray(actualValue)) {
              passed = checkIfArraysAreEqual(parsedExpectedValue, actualValue);
            } else if (typeof actualValue === "object") {
              passed = checkIfObjectsAreEqual(parsedExpectedValue, actualValue);
            } else {
              passed = JSON.stringify(parsedExpectedValue) === JSON.stringify(actualValue);
            }

            if (!passed) {
              testResult.passed = false;
              testResultAssertion.passed = false;

              (testResultAssertion.errors as TestResultAssertionError[]).push({
                type: "variable",
                expected:
                  typeof expectedValue !== "string" ? JSON.stringify(expectedValue) : expectedValue,
                actual: typeof actualValue !== "string" ? JSON.stringify(actualValue) : actualValue,
                details: {
                  ...details,
                  variableKey,
                },
              });
            }
          } else {
            // other types
            if (typeof expectedValue === "object") {
              passed = checkIfObjectsAreEqual(expectedValue, actualValue);
            } else if (Array.isArray(expectedValue)) {
              passed = checkIfArraysAreEqual(expectedValue, actualValue);
            } else {
              passed = expectedValue === actualValue;
            }

            if (!passed) {
              testResult.passed = false;
              testResultAssertion.passed = false;

              (testResultAssertion.errors as TestResultAssertionError[]).push({
                type: "variable",
                expected: expectedValue as string,
                actual: actualValue as string,
                details: {
                  ...details,
                  variableKey,
                },
              });
            }
          }
        });
      }

      if (typeof assertion.expectedVariables === "object") {
        testExpectedVariables(sdk, assertion);
      }

      /**
       * expectedEvaluations
       */
      function testExpectedEvaluations(
        sdk,
        assertion,
        rootDetails = {},
        evaluationContext = context,
      ) {
        function testEvaluation(type, evaluation, expected, details = {}) {
          for (const [key, value] of Object.entries(expected)) {
            if (!evaluationValuesAreEqual(value, evaluation[key])) {
              testResult.passed = false;
              testResultAssertion.passed = false;

              (testResultAssertion.errors as TestResultAssertionError[]).push({
                type: "evaluation",
                expected: value,
                actual: evaluation[key],
                details: {
                  ...rootDetails,
                  ...details,
                  evaluationType: type,
                  evaluationKey: key,
                },
              });
            }
          }
        }

        if (assertion.expectedEvaluations.flag) {
          const evaluation = sdk.evaluateFlag(featureKey, evaluationContext);
          testEvaluation("flag", evaluation, assertion.expectedEvaluations.flag);
        }

        if (assertion.expectedEvaluations.variation) {
          const evaluation = sdk.evaluateVariation(featureKey, evaluationContext);
          testEvaluation("variation", evaluation, assertion.expectedEvaluations.variation);
        }

        if (assertion.expectedEvaluations.variables) {
          const variableKeys = Object.keys(assertion.expectedEvaluations.variables);

          for (const variableKey of variableKeys) {
            const evaluation = sdk.evaluateVariable(featureKey, variableKey, evaluationContext);
            testEvaluation(
              "variable",
              evaluation,
              assertion.expectedEvaluations.variables[variableKey],
              { variableKey },
            );
          }
        }
      }

      if (assertion.expectedEvaluations) {
        testExpectedEvaluations(sdk, assertion);
      }

      /**
       * children
       */
      if (Array.isArray(assertion.children)) {
        let childIndex = 0;

        for (const child of assertion.children) {
          const childSdk = sdk.spawn(child.context || {}, {
            stickyFeatures: assertion.sticky || {},
          });
          try {
            // expectedToBeEnabled
            if (typeof child.expectedToBeEnabled !== "undefined") {
              testExpectedToBeEnabled(
                childSdk,
                child,
                {
                  childIndex,
                },
                {},
              );
            }

            // expectedVariation
            if (typeof child.expectedVariation !== "undefined") {
              testExpectedVariation(
                childSdk,
                child,
                {
                  childIndex,
                },
                {},
              );
            }

            // expectedVariables
            if (typeof child.expectedVariables === "object") {
              testExpectedVariables(
                childSdk,
                child,
                {
                  childIndex,
                },
                {},
              );
            }

            // expectedEvaluations
            if (typeof child.expectedEvaluations === "object") {
              testExpectedEvaluations(
                childSdk,
                child,
                {
                  childIndex,
                },
                {},
              );
            }
          } finally {
            childSdk.close();
          }
          childIndex++;
        }
      }
    } finally {
      await sdk.close();
    }

    testResultAssertion.duration = Date.now() - assertionStartTime;
    testResult.assertions.push(testResultAssertion);
  }

  testResult.duration = Date.now() - testStartTime;

  return testResult;
}
