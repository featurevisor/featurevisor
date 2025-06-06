import * as fs from "fs";
import * as path from "path";

import { TestSegment, TestFeature, DatafileContent } from "@featurevisor/types";

import { testSegment } from "./testSegment";
import { testFeature } from "./testFeature";
import { CLI_FORMAT_BOLD, CLI_FORMAT_GREEN, CLI_FORMAT_RED } from "./cliFormat";
import { Dependencies } from "../dependencies";
import { prettyDuration } from "./prettyDuration";
import { printTestResult } from "./printTestResult";

import { buildDatafile } from "../builder";
import { SCHEMA_VERSION } from "../config";
import { Plugin } from "../cli";

export interface TestProjectOptions {
  keyPattern?: string;
  assertionPattern?: string;
  verbose?: boolean;
  showDatafile?: boolean;
  onlyFailures?: boolean;
  schemaVersion?: string;
  inflate?: number;
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

export type DatafileContentByEnvironment = Map<string | false, DatafileContent>;

export async function executeTest(
  testFile: string,
  deps: Dependencies,
  options: TestProjectOptions,
  patterns: TestPatterns,
  datafileContentByEnvironment: DatafileContentByEnvironment,
): Promise<ExecutionResult | undefined> {
  const { datasource, projectConfig, rootDirectoryPath } = deps;

  const relativeTestFilePath = path
    .join(projectConfig.testsDirectoryPath, datasource.getTestSpecName(testFile))
    .replace(rootDirectoryPath + path.sep, "");

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
    printTestResult(testResult, relativeTestFilePath, rootDirectoryPath);
  } else {
    // show failed only
    if (!testResult.passed) {
      printTestResult(testResult, relativeTestFilePath, rootDirectoryPath);
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

  const datafileContentByEnvironment: DatafileContentByEnvironment = new Map();

  // with environments
  if (Array.isArray(projectConfig.environments)) {
    for (const environment of projectConfig.environments) {
      const existingState = await datasource.readState(environment);
      const datafileContent = await buildDatafile(
        projectConfig,
        datasource,
        {
          schemaVersion: options.schemaVersion || SCHEMA_VERSION,
          revision: "include-all-features",
          environment: environment,
          inflate: options.inflate,
        },
        existingState,
      );

      datafileContentByEnvironment.set(environment, datafileContent);
    }
  }

  // no environments
  if (projectConfig.environments === false) {
    const existingState = await datasource.readState(false);
    const datafileContent = await buildDatafile(
      projectConfig,
      datasource,
      {
        schemaVersion: options.schemaVersion || SCHEMA_VERSION,
        revision: "include-all-features",
        environment: false,
        inflate: options.inflate,
      },
      existingState,
    );

    datafileContentByEnvironment.set(false, datafileContent);
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

export const testPlugin: Plugin = {
  command: "test",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    const hasError = await testProject(
      {
        rootDirectoryPath,
        projectConfig,
        datasource,
        options: parsed,
      },
      parsed as TestProjectOptions,
    );

    if (hasError) {
      return false;
    }
  },
  examples: [
    {
      command: "test",
      description: "run all tests",
    },
    {
      command: "test --keyPattern=pattern",
      description: "run tests matching key pattern",
    },
    {
      command: "test --assertionPattern=pattern",
      description: "run tests matching assertion pattern",
    },
    {
      command: "test --onlyFailures",
      description: "run only failed tests",
    },
    {
      command: "test --showDatafile",
      description: "show datafile content for each test",
    },
    {
      command: "test --verbose",
      description: "show all test results",
    },
  ],
};
