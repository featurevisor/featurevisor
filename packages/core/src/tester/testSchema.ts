import type {
  ExpectedSchemaIssue,
  TestResult,
  TestResultAssertion,
  TestSchema,
} from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";
import { createSchemas, type SchemaIssue } from "@featurevisor/schemas";

import { Datasource } from "../datasource";
import type { DatafileContentByKey, TestProjectOptions } from "./testProject";
import { getMissingDatafileMessage, getTestDatafileKey } from "./datafileKey";

/** Whether an issue has every field an expected issue gives. */
function matchesIssue(expected: ExpectedSchemaIssue, actual: SchemaIssue): boolean {
  if (expected.path && JSON.stringify(expected.path) !== JSON.stringify(actual.path)) return false;
  if (expected.code !== undefined && expected.code !== actual.code) return false;
  if (expected.mutation !== undefined && expected.mutation !== actual.mutation) return false;
  if (expected.message !== undefined && expected.message !== actual.message) return false;
  for (const [name, value] of Object.entries(expected.params || {})) {
    if (JSON.stringify(actual.params[name]) !== JSON.stringify(value)) return false;
  }
  return true;
}

/** An issue as a test result shows it, without the schema key every issue repeats. */
function describeIssue(issue: SchemaIssue) {
  return {
    path: issue.path,
    code: issue.code,
    ...(issue.mutation !== undefined ? { mutation: issue.mutation } : {}),
    message: issue.message,
    params: issue.params,
  };
}

function describeExpected(issue: ExpectedSchemaIssue): string {
  return JSON.stringify(issue);
}

/**
 * Runs a schema's spec: each assertion validates its value with
 * `@featurevisor/schemas`, against the datafile its environment, and target
 * when given, build, under its context, so a test proves what applications see.
 */
export async function testSchema(
  datasource: Datasource,
  test: TestSchema,
  options: TestProjectOptions = {},
  datafiles?: DatafileContentByKey,
): Promise<TestResult> {
  void options;
  const testStartTime = Date.now();
  const testResult: TestResult = {
    type: "schema",
    key: test.schema,
    notFound: false,
    duration: 0,
    passed: true,
    assertions: [],
  };

  if (!(await datasource.schemaExists(test.schema))) {
    testResult.notFound = true;
    testResult.passed = false;
    return testResult;
  }

  for (const assertion of test.assertions) {
    const assertionStartTime = Date.now();
    const result: TestResultAssertion = {
      description: assertion.description as string,
      duration: 0,
      passed: true,
      errors: [],
    };
    const fail = (message: string, expected: unknown, actual: unknown) => {
      testResult.passed = result.passed = false;
      result.errors!.push({ type: "schema", expected, actual, message });
    };

    const datafile = datafiles?.get(getTestDatafileKey(assertion.environment, assertion.target));
    if (!datafile) {
      fail(
        getMissingDatafileMessage(assertion.environment, assertion.target),
        "datafile",
        undefined,
      );
    } else if (
      !datafile.schemas ||
      !Object.prototype.hasOwnProperty.call(datafile.schemas, test.schema)
    ) {
      fail(
        `Target "${assertion.target}" does not deliver schema "${test.schema}". Tag the schema for it, or list it in its includeSchemas.`,
        test.schema,
        undefined,
      );
    } else {
      const f = createFeaturevisor({
        datafile,
        context: assertion.context || {},
        logLevel: "fatal",
      });
      const s = createSchemas(f);
      const validation = s.validate(test.schema, assertion.value);
      const issues = (validation as { issues?: ReadonlyArray<SchemaIssue> }).issues || [];
      s.close();
      await f.close();

      const valid = issues.length === 0;
      if (assertion.expectedToBeValid !== undefined && assertion.expectedToBeValid !== valid) {
        fail(
          valid
            ? "Expected the value to be invalid, and it is valid."
            : `Expected the value to be valid, and it has ${issues.length === 1 ? "an issue" : `${issues.length} issues`}:\n${issues
                .map((issue) => `       ${JSON.stringify(describeIssue(issue))}`)
                .join("\n")}`,
          assertion.expectedToBeValid,
          valid,
        );
      }

      if (assertion.expectedIssues) {
        // Each expected issue pairs with one issue found, and every issue found must be expected.
        const left = [...issues];
        const missing: ExpectedSchemaIssue[] = [];
        for (const expected of assertion.expectedIssues) {
          const index = left.findIndex((actual) => matchesIssue(expected, actual));
          if (index === -1) missing.push(expected);
          else left.splice(index, 1);
        }
        if (missing.length > 0 || left.length > 0) {
          const lines = [
            ...missing.map((issue) => `       missing: ${describeExpected(issue)}`),
            ...left.map((issue) => `       unexpected: ${JSON.stringify(describeIssue(issue))}`),
          ];
          fail(
            `The issues differ from expectedIssues:\n${lines.join("\n")}`,
            assertion.expectedIssues,
            issues.map(describeIssue),
          );
        }
      }
    }

    result.duration = Date.now() - assertionStartTime;
    testResult.assertions.push(result);
  }

  testResult.duration = Date.now() - testStartTime;
  return testResult;
}
