import type {
  TestSegment,
  DatafileContent,
  Segment,
  TestResult,
  TestResultAssertion,
  TestResultAssertionError,
} from "@featurevisor/types";
import { createFeaturevisor, MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";

import { Datasource } from "../datasource";
import { getConditionReferences } from "../datasource/conditions";
import type { DatafileContentByKey, TestProjectOptions } from "./testProject";
import { getMissingDatafileMessage, getTestDatafileKey } from "./datafileKey";
import { assertSegmentReferencesInDatafile, prepareSegmentEvaluations } from "./segments";
import { createTestDiagnosticHandler } from "./diagnostics";

export async function testSegment(
  datasource: Datasource,
  test: TestSegment,
  options: TestProjectOptions = {},
  datafiles?: DatafileContentByKey,
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

  const segments: Record<string, Segment> = {};
  for (const key of await datasource.listSegments())
    segments[key] = await datasource.readSegment(key);

  // Attribute only segment tests do not need an environment's feature datafile.
  const pendingSegments = new Set([segmentKey]);
  let needsDatafile = false;
  for (const key of pendingSegments) {
    const references = getConditionReferences(segments[key]?.conditions);
    if (references.features.size || references.variables.size) needsDatafile = true;
    for (const dependency of references.segments) pendingSegments.add(dependency);
  }

  test.assertions.forEach(function (assertion) {
    const assertionStartTime = Date.now();
    const testResultAssertion: TestResultAssertion = {
      description: assertion.description as string,
      duration: 0,
      passed: true,
      errors: [],
    };

    const expected = assertion.expectedToMatch;
    const selected = datafiles?.get(getTestDatafileKey(assertion.environment, assertion.target));
    if (!selected && (needsDatafile || assertion.environment || assertion.target)) {
      testResult.passed = testResultAssertion.passed = false;
      testResultAssertion.errors!.push({
        type: "segment",
        expected: "datafile",
        actual: undefined,
        message: getMissingDatafileMessage(assertion.environment, assertion.target),
      });
      testResultAssertion.duration = Date.now() - assertionStartTime;
      testResult.assertions.push(testResultAssertion);
      return;
    }
    const base: DatafileContent = selected || {
      schemaVersion: "4",
      revision: "segment-test",
      features: {},
      segments: {},
    };
    try {
      assertSegmentReferencesInDatafile(segmentKey, base, segments);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      testResult.passed = testResultAssertion.passed = false;
      testResultAssertion.errors!.push({
        type: "segment",
        expected: "valid segment references",
        actual: message,
        message,
      });
      testResultAssertion.duration = Date.now() - assertionStartTime;
      testResult.assertions.push(testResultAssertion);
      return;
    }
    const prepared = prepareSegmentEvaluations(base, segments);
    const errors: string[] = [];
    const sdk = createFeaturevisor({
      datafile: prepared.datafile,
      context: assertion.context || {},
      stickyFeatures: assertion.stickyFeatures,
      stickyVariables: assertion.stickyVariables,
      modules: [
        {
          name: "segment-tester",
          bucketValue:
            typeof assertion.at === "number"
              ? () => assertion.at! * (MAX_BUCKETED_NUMBER / 100)
              : undefined,
          afterEvaluation: options.onEvaluation
            ? (evaluation) => {
                if (!prepared.isSynthetic(evaluation)) options.onEvaluation!(evaluation, assertion);
                return evaluation;
              }
            : undefined,
        },
      ],
      onDiagnostic: createTestDiagnosticHandler(options),
      logLevel: options.quiet ? "fatal" : options.verbose ? "debug" : "warn",
    });
    sdk.on("error", (event) => errors.push(event.diagnostic?.message || "SDK evaluation error"));
    let actual: boolean;
    try {
      actual = sdk.isEnabled(prepared.featureKeys.get(segmentKey)!);
    } finally {
      sdk.close();
    }
    const passed = actual === expected;

    if (!passed || errors.length) {
      const testResultAssertionError: TestResultAssertionError = {
        type: "segment",
        expected,
        actual,
        ...(errors.length ? { message: errors.join("; ") } : {}),
      };

      (testResultAssertion.errors as TestResultAssertionError[]).push(testResultAssertionError);
      testResult.passed = false;
      testResultAssertion.passed = false;
    }

    testResult.assertions.push(testResultAssertion);
    testResultAssertion.duration = Date.now() - assertionStartTime;
  });

  testResult.duration = Date.now() - testStartTime;

  return testResult;
}
