import {
  DatafileContent,
  TestFeature,
  TestResult,
  TestResultAssertion,
  TestResultAssertionError,
} from "@featurevisor/types";
import { createInstance, MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";

import { Datasource } from "../datasource";
import { ProjectConfig } from "../config";

import { checkIfArraysAreEqual } from "./checkIfArraysAreEqual";
import { checkIfObjectsAreEqual } from "./checkIfObjectsAreEqual";
import { getFeatureAssertionsFromMatrix } from "./matrix";
import type { DatafileContentByEnvironment } from "./testProject";

export async function testFeature(
  datasource: Datasource,
  projectConfig: ProjectConfig,
  test: TestFeature,
  options: { verbose?: boolean; showDatafile?: boolean } = {},
  patterns,
  datafileContentByEnvironment: DatafileContentByEnvironment,
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
    const assertions = getFeatureAssertionsFromMatrix(aIndex, test.assertions[aIndex]);

    for (let bIndex = 0; bIndex < assertions.length; bIndex++) {
      const assertionStartTime = Date.now();
      const assertion = assertions[bIndex];

      const testResultAssertion: TestResultAssertion = {
        description: assertion.description as string,
        duration: 0,
        passed: true,
        errors: [],
      };

      if (patterns.assertionPattern && !patterns.assertionPattern.test(assertion.description)) {
        continue;
      }

      const datafileContent = datafileContentByEnvironment.get(assertion.environment || false);

      if (options.showDatafile) {
        console.log("");
        console.log(JSON.stringify(datafileContent, null, 2));
        console.log("");
      }

      const sdk = createInstance({
        datafile: datafileContent,
        configureBucketValue: () => {
          return assertion.at * (MAX_BUCKETED_NUMBER / 100);
        },
      });

      if (options.verbose) {
        sdk.setLogLevels(["debug", "info", "warn", "error"]);
      }

      const feature = await datasource.readFeature(featureKey);
      if (!feature) {
        testResult.notFound = true;
        testResult.passed = false;

        return testResult;
      }

      // isEnabled
      if ("expectedToBeEnabled" in assertion) {
        const isEnabled = sdk.isEnabled(featureKey, assertion.context);

        if (isEnabled !== assertion.expectedToBeEnabled) {
          testResult.passed = false;
          testResultAssertion.passed = false;

          (testResultAssertion.errors as TestResultAssertionError[]).push({
            type: "flag",
            expected: assertion.expectedToBeEnabled,
            actual: isEnabled,
          });
        }
      }

      // variation
      if ("expectedVariation" in assertion) {
        const variation = sdk.getVariation(featureKey, assertion.context);

        if (variation !== assertion.expectedVariation) {
          testResult.passed = false;
          testResultAssertion.passed = false;

          (testResultAssertion.errors as TestResultAssertionError[]).push({
            type: "variation",
            expected: assertion.expectedVariation,
            actual: variation,
          });
        }
      }

      // variables
      if (typeof assertion.expectedVariables === "object") {
        Object.keys(assertion.expectedVariables).forEach(function (variableKey) {
          const expectedValue =
            assertion.expectedVariables && assertion.expectedVariables[variableKey];
          const actualValue = sdk.getVariable(featureKey, variableKey, assertion.context);

          let passed;

          const variableSchema = feature.variablesSchema?.find((v) => v.key === variableKey);

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
                  variableKey,
                },
              });
            }
          }
        });
      }

      testResultAssertion.duration = Date.now() - assertionStartTime;
      testResult.assertions.push(testResultAssertion);
    }
  }

  testResult.duration = Date.now() - testStartTime;

  return testResult;
}
