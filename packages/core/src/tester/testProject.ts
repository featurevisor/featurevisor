import * as fs from "fs";

import { TestSegment, TestFeature, DatafileContent } from "@featurevisor/types";

import { testSegment } from "./testSegment";
import { testFeature } from "./testFeature";
import { CLI_FORMAT_BOLD, CLI_FORMAT_GREEN, CLI_FORMAT_RED } from "./cliFormat";
import { Dependencies } from "../dependencies";
import { prettyDuration } from "./prettyDuration";
import { printTestResult } from "./printTestResult";

import { buildDatafile } from "../builder";
import { SCHEMA_VERSION } from "../config";

export interface TestProjectOptions {
  keyPattern?: string;
  assertionPattern?: string;
  verbose?: boolean;
  showDatafile?: boolean;
  onlyFailures?: boolean;
  fast?: boolean;
}

export interface TestPatterns {
  keyPattern?: RegExp;
  assertionPattern?: RegExp;
}

export interface ExecutionResult {
  passed: boolean;
  assertionsCount: {
    passed: number;
    failed: number;
  };
}

export interface DatafileContentByEnvironment {
  [environment: string]: DatafileContent;
}

export async function executeTest(
  testFile: string,
  deps: Dependencies,
  options: TestProjectOptions,
  patterns: TestPatterns,
  datafileContentByEnvironment: DatafileContentByEnvironment,
): Promise<ExecutionResult | undefined> {
  const { datasource, projectConfig, rootDirectoryPath } = deps;

  const testFilePath = datasource.getTestSpecName(testFile);

  const t = await datasource.readTest(testFile);

  const tAsSegment = t as TestSegment;
  const tAsFeature = t as TestFeature;
  const key = tAsSegment.segment || tAsFeature.feature;
  const type = tAsSegment.segment ? "segment" : "feature";

  const executionResult: ExecutionResult = {
    passed: true,
    assertionsCount: {
      passed: 0,
      failed: 0,
    },
  };

  if (!key) {
    console.error(`  => Invalid test: ${JSON.stringify(t)}`);
    executionResult.passed = false;

    return executionResult;
  }

  if (patterns.keyPattern && !patterns.keyPattern.test(key)) {
    return;
  }

  let testResult;
  if (type === "segment") {
    testResult = await testSegment(datasource, tAsSegment, patterns);
  } else {
    testResult = await testFeature(
      datasource,
      projectConfig,
      tAsFeature,
      options,
      patterns,
      datafileContentByEnvironment,
    );
  }

  if (!options.onlyFailures) {
    // show all
    printTestResult(testResult, testFilePath, rootDirectoryPath);
  } else {
    // show failed only
    if (!testResult.passed) {
      printTestResult(testResult, testFilePath, rootDirectoryPath);
    }
  }

  if (!testResult.passed) {
    executionResult.passed = false;

    executionResult.assertionsCount.failed = testResult.assertions.filter((a) => !a.passed).length;
    executionResult.assertionsCount.passed +=
      testResult.assertions.length - executionResult.assertionsCount.failed;
  } else {
    executionResult.assertionsCount.passed = testResult.assertions.length;
  }

  return executionResult;
}

export async function testProject(
  deps: Dependencies,
  options: TestProjectOptions = {},
): Promise<boolean> {
  const { projectConfig, datasource } = deps;

  let hasError = false;

  if (!fs.existsSync(projectConfig.testsDirectoryPath)) {
    console.error(`Tests directory does not exist: ${projectConfig.testsDirectoryPath}`);
    hasError = true;

    return hasError;
  }

  const testFiles = await datasource.listTests();

  if (testFiles.length === 0) {
    console.error(`No tests found in: ${projectConfig.testsDirectoryPath}`);
    hasError = true;

    return hasError;
  }

  const startTime = Date.now();

  const patterns: TestPatterns = {
    keyPattern: options.keyPattern ? new RegExp(options.keyPattern) : undefined,
    assertionPattern: options.assertionPattern ? new RegExp(options.assertionPattern) : undefined,
  };

  let passedTestsCount = 0;
  let failedTestsCount = 0;

  let passedAssertionsCount = 0;
  let failedAssertionsCount = 0;

  const datafileContentByEnvironment: DatafileContentByEnvironment = {};
  if (options.fast) {
    for (const environment of projectConfig.environments) {
      const existingState = await datasource.readState(environment);
      const datafileContent = await buildDatafile(
        projectConfig,
        datasource,
        {
          schemaVersion: SCHEMA_VERSION,
          revision: "include-all-features",
          environment: environment,
        },
        existingState,
      );

      datafileContentByEnvironment[environment] = datafileContent;
    }
  }

  for (const testFile of testFiles) {
    const executionResult = await executeTest(
      testFile,
      deps,
      options,
      patterns,
      datafileContentByEnvironment,
    );

    if (!executionResult) {
      continue;
    }

    if (executionResult.passed) {
      passedTestsCount += 1;
    } else {
      hasError = true;
      failedTestsCount += 1;
    }

    passedAssertionsCount += executionResult.assertionsCount.passed;
    failedAssertionsCount += executionResult.assertionsCount.failed;
  }

  const diffInMs = Date.now() - startTime;

  if (options.onlyFailures !== true || hasError) {
    console.log("\n---");
  }
  console.log("");

  const testSpecsMessage = `Test specs: ${passedTestsCount} passed, ${failedTestsCount} failed`;
  const testAssertionsMessage = `Assertions: ${passedAssertionsCount} passed, ${failedAssertionsCount} failed`;
  if (hasError) {
    console.log(CLI_FORMAT_RED, testSpecsMessage);
    console.log(CLI_FORMAT_RED, testAssertionsMessage);
  } else {
    console.log(CLI_FORMAT_GREEN, testSpecsMessage);
    console.log(CLI_FORMAT_GREEN, testAssertionsMessage);
  }

  console.log(CLI_FORMAT_BOLD, `Time:       ${prettyDuration(diffInMs)}`);

  return hasError;
}
