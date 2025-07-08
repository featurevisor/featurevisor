import type {
  TestSegment,
  Condition,
  TestResult,
  TestResultAssertion,
  TestResultAssertionError,
} from "@featurevisor/types";
import { createLogger, DatafileReader, LogLevel } from "@featurevisor/sdk";

import { Datasource } from "../datasource";

export async function testSegment(
  datasource: Datasource,
  test: TestSegment,
  options: { verbose?: boolean; quiet?: boolean } = {},
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

  let logLevels: LogLevel[] = ["error", "warn"];
  if (options.verbose) {
    logLevels = ["error", "warn", "info", "debug"];
  } else if (options.quiet) {
    logLevels = [];
  }

  const parsedSegment = await datasource.readSegment(segmentKey);
  const conditions = parsedSegment.conditions as Condition | Condition[];
  const logger = createLogger({
    levels: logLevels,
  });
  const datafileReader = new DatafileReader({
    datafile: {
      schemaVersion: "2",
      revision: "tester",
      segments: {},
      features: {},
    },
    logger,
  });

  test.assertions.forEach(function (assertion) {
    const assertionStartTime = Date.now();
    const testResultAssertion: TestResultAssertion = {
      description: assertion.description as string,
      duration: 0,
      passed: true,
      errors: [],
    };

    const expected = assertion.expectedToMatch;
    const actual = datafileReader.allConditionsAreMatched(conditions, assertion.context);
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

  testResult.duration = Date.now() - testStartTime;

  return testResult;
}
