import type {
  DatafileContent,
  TestFeature,
  TestResult,
  TestResultAssertion,
  TestResultAssertionError,
} from "@featurevisor/types";
import {
  createInstance,
  FeaturevisorInstance,
  LogLevel,
  MAX_BUCKETED_NUMBER,
  OverrideOptions,
} from "@featurevisor/sdk";

import { Datasource } from "../datasource";
import { ProjectConfig } from "../config";

import { checkIfArraysAreEqual, checkIfObjectsAreEqual } from "./helpers";
import type { DatafileContentByKey } from "./testProject";

export interface TestFeatureOptions {
  verbose?: boolean;
  quiet?: boolean;
  showDatafile?: boolean;
  withScopes?: boolean;
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

    let datafileContent = datafileContentByKey.get(assertion.environment || false);

    // scope
    const scopedDatafileKey = `${assertion.environment}-scope-${assertion.scope}`;
    if (assertion.scope && datafileContentByKey.has(scopedDatafileKey)) {
      datafileContent = datafileContentByKey.get(scopedDatafileKey);
    }

    // tag
    const taggedDatafileKey = `${assertion.environment}-tag-${assertion.tag}`;
    if (assertion.tag && datafileContentByKey.has(taggedDatafileKey)) {
      datafileContent = datafileContentByKey.get(taggedDatafileKey);
    }

    if (options.showDatafile) {
      console.log("");
      console.log(JSON.stringify(datafileContent, null, 2));
      console.log("");
    }

    let logLevel: LogLevel = "warn";
    if (options.verbose) {
      logLevel = "debug";
    } else if (options.quiet) {
      logLevel = "fatal";
    }

    const sdk: FeaturevisorInstance = createInstance({
      datafile: datafileContent as DatafileContent,
      sticky: assertion.sticky ? assertion.sticky : {},
      hooks: [
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

    const parsedFeature = await datasource.readFeature(featureKey);
    if (!parsedFeature) {
      testResult.notFound = true;
      testResult.passed = false;

      return testResult;
    }

    let context = {};

    if (assertion.scope) {
      if (!options.withScopes) {
        // if not testing with scoped datafiles,
        // then we need to add the scope's context to the context
        const scope = projectConfig.scopes?.find((s) => s.name === assertion.scope);

        if (scope) {
          context = {
            ...(scope.context || {}),
            ...context,
          };
        }
      }
    }

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
    function testExpectedToBeEnabled(sdk, assertion, details = {}) {
      const isEnabled = sdk.isEnabled(featureKey, context);

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
    function testExpectedVariation(sdk, assertion, details = {}) {
      const overrideOptions: OverrideOptions = {};
      if (assertion.defaultVariationValue) {
        overrideOptions.defaultVariationValue = assertion.defaultVariationValue;
      }

      const variation = sdk.getVariation(featureKey, context, overrideOptions);

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

    if ("expectedVariation" in assertion) {
      testExpectedVariation(sdk, assertion);
    }

    /**
     * expectedVariables
     */
    function testExpectedVariables(sdk, assertion, details = {}) {
      Object.keys(assertion.expectedVariables).forEach(function (variableKey) {
        const expectedValue =
          assertion.expectedVariables && assertion.expectedVariables[variableKey];

        const overrideOptions: OverrideOptions = {};
        if (assertion.defaultVariableValues && assertion.defaultVariableValues[variableKey]) {
          overrideOptions.defaultVariableValue = assertion.defaultVariableValues[variableKey];
        }

        const actualValue = sdk.getVariable(featureKey, variableKey, context, overrideOptions);

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
            typeof expectedValue === "string" ? JSON.parse(expectedValue as string) : expectedValue;

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
    function testExpectedEvaluations(sdk, assertion, rootDetails = {}) {
      function testEvaluation(type, evaluation, expected, details = {}) {
        for (const [key, value] of Object.entries(expected)) {
          if (evaluation[key] !== value) {
            testResult.passed = false;
            testResultAssertion.passed = false;

            (testResultAssertion.errors as TestResultAssertionError[]).push({
              type: "evaluation",
              expected: value as string | number | boolean | null | undefined,
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
        const evaluation = sdk.evaluateFlag(featureKey, context);
        testEvaluation("flag", evaluation, assertion.expectedEvaluations.flag);
      }

      if (assertion.expectedEvaluations.variation) {
        const evaluation = sdk.evaluateVariation(featureKey, context);
        testEvaluation("variation", evaluation, assertion.expectedEvaluations.variation);
      }

      if (assertion.expectedEvaluations.variables) {
        const variableKeys = Object.keys(assertion.expectedEvaluations.variables);

        for (const variableKey of variableKeys) {
          const evaluation = sdk.evaluateVariable(featureKey, variableKey, context);
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
          sticky: assertion.sticky || {},
        });

        // expectedToBeEnabled
        if (typeof child.expectedToBeEnabled !== "undefined") {
          testExpectedToBeEnabled(childSdk, child, {
            childIndex,
          });
        }

        // expectedVariation
        if (typeof child.expectedVariation !== "undefined") {
          testExpectedVariation(childSdk, child, {
            childIndex,
          });
        }

        // expectedVariables
        if (typeof child.expectedVariables === "object") {
          testExpectedVariables(childSdk, child, {
            childIndex,
          });
        }

        // expectedEvaluations
        if (typeof child.expectedEvaluations === "object") {
          testExpectedEvaluations(childSdk, child, {
            childIndex,
          });
        }

        childIndex++;
      }
    }

    testResultAssertion.duration = Date.now() - assertionStartTime;
    testResult.assertions.push(testResultAssertion);
  }

  testResult.duration = Date.now() - testStartTime;

  return testResult;
}
