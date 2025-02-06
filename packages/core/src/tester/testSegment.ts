import {
  TestSegment,
  Condition,
  TestResult,
  TestResultAssertion,
  TestResultAssertionError,
} from "@featurevisor/types";
import { allConditionsAreMatched, createLogger } from "@featurevisor/sdk";

import { Datasource } from "../datasource";

import { getSegmentAssertionsFromMatrix } from "./matrix";

export async function testSegment(
  datasource: Datasource,
  test: TestSegment,
  patterns,
): Promise<TestResult> {
  const testStartTime = Date.now();
  const segmentKey = test.segment;

  const testResult: TestResult = {
    type: "segment",
    key: segmentKey,

    // to be updated later
    notFound: false,
    duration: 0,
    passed: true,
    assertions: [],
  };

  const segmentExists = await datasource.segmentExists(segmentKey);

  if (!segmentExists) {
    testResult.notFound = true;
    testResult.passed = false;

    return testResult;
  }

  const parsedSegment = await datasource.readSegment(segmentKey);
  const conditions = parsedSegment.conditions as Condition | Condition[];
  const logger = createLogger();

  test.assertions.forEach(function (assertion, aIndex) {
    const assertions = getSegmentAssertionsFromMatrix(aIndex, assertion);

    assertions.forEach(function (assertion) {
      const assertionStartTime = Date.now();
      const testResultAssertion: TestResultAssertion = {
        description: assertion.description as string,
        duration: 0,
        passed: true,
        errors: [],
      };

      if (patterns.assertionPattern && !patterns.assertionPattern.test(assertion.description)) {
        return;
      }

      const expected = assertion.expectedToMatch;
      const actual = allConditionsAreMatched(conditions, assertion.context, logger);
      const passed = actual === expected;

      if (!passed) {
        const testResultAssertionError: TestResultAssertionError = {
          type: "segment",
          expected,
          actual,
        };

        (testResultAssertion.errors as TestResultAssertionError[]).push(testResultAssertionError);
        testResult.passed = false;
        testResultAssertion.passed = passed;
      }

      testResult.assertions.push(testResultAssertion);
      testResultAssertion.duration = Date.now() - assertionStartTime;
    });
  });

  testResult.duration = Date.now() - testStartTime;

  return testResult;
}
