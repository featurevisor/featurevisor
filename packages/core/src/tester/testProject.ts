import * as fs from "fs";

import type { TestSegment, TestFeature, Test, DatafileContent } from "@featurevisor/types";

import { testSegment } from "./testSegment";
import { testFeature } from "./testFeature";
import { CLI_FORMAT_BOLD, CLI_FORMAT_GREEN, CLI_FORMAT_RED } from "./cliFormat";
import { Dependencies } from "../dependencies";
import { prettyDuration } from "./prettyDuration";
import { printTestResult } from "./printTestResult";

import { buildDatafile, buildTargetDatafile } from "../builder";
import { Plugin } from "../cli";
import { listEntities } from "../list";
import { getProjectSetExecutions, printSetHeader } from "../sets";
import { resolveTargets } from "../targeting";

export interface TestProjectOptions {
  keyPattern?: string;
  assertionPattern?: string;
  verbose?: boolean;
  showDatafile?: boolean;
  onlyFailures?: boolean;
  inflate?: number;
  target?: string | string[];
}

export interface ExecutionResult {
  passed: boolean;
  assertionsCount: {
    passed: number;
    failed: number;
  };
}

// the key can be either "<EnvironmentKey>" or "<EnvironmentKey>-target-<Target>"
export type DatafileContentByKey = Map<string | false, DatafileContent>;

export function filterTestForTargets(test: Test, selectedTargetKeys?: string[]): Test | undefined {
  if (!selectedTargetKeys || !(test as TestFeature).feature) return test;

  const featureTest = test as TestFeature;
  const assertions = featureTest.assertions.filter(
    (assertion) => !assertion.target || selectedTargetKeys.includes(assertion.target),
  );

  return assertions.length > 0 ? { ...featureTest, assertions } : undefined;
}

async function buildTestDatafilesForEnvironment(
  deps: Dependencies,
  datafileContentByKey: DatafileContentByKey,
  environment: string | false,
  selectedTargetKeys?: string[],
) {
  const { projectConfig, datasource, options } = deps;
  const existingState = await datasource.readState(environment);
  const datafileContent = await buildDatafile(
    projectConfig,
    datasource,
    {
      revision: "include-all-features",
      environment,
      inflate: options.inflate,
    },
    existingState,
  );

  datafileContentByKey.set(environment, datafileContent as DatafileContent);

  const targetKeys = selectedTargetKeys || (await datasource.listTargets());
  for (const targetKey of targetKeys) {
    const target = await datasource.readTarget(targetKey);
    const targetDatafileContent = await buildTargetDatafile({
      projectConfig,
      datasource,
      target,
      environment,
      existingState,
      revision: "include-target-features",
      inflate: options.inflate,
    });

    datafileContentByKey.set(`${environment}-target-${targetKey}`, targetDatafileContent);
  }
}

export async function executeTest(
  test: Test,
  deps: Dependencies,
  options: TestProjectOptions,
  datafileContentByKey: DatafileContentByKey,
): Promise<ExecutionResult | undefined> {
  const { datasource, projectConfig, rootDirectoryPath } = deps;

  const extension = datasource.getExtension();
  const relativeTestFilePath = test.key + (extension ? `.${extension}` : "");

  const tAsSegment = test as TestSegment;
  const tAsFeature = test as TestFeature;
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
    console.error(`  => Invalid test: ${JSON.stringify(test)}`);
    executionResult.passed = false;

    return executionResult;
  }

  let testResult;
  if (type === "segment") {
    testResult = await testSegment(datasource, tAsSegment, options);
  } else {
    testResult = await testFeature(
      datasource,
      projectConfig,
      tAsFeature,
      options,
      datafileContentByKey,
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
  testOptions: TestProjectOptions = {},
): Promise<boolean> {
  const { rootDirectoryPath, projectConfig, datasource, options } = deps;

  let hasError = false;

  if (!fs.existsSync(projectConfig.testsDirectoryPath)) {
    console.error(`Tests directory does not exist: ${projectConfig.testsDirectoryPath}`);
    hasError = true;

    return hasError;
  }

  const startTime = Date.now();

  let passedTestsCount = 0;
  let failedTestsCount = 0;

  let passedAssertionsCount = 0;
  let failedAssertionsCount = 0;

  const datafileContentByKey: DatafileContentByKey = new Map();
  const selectedTargets = testOptions.target
    ? await resolveTargets(datasource, testOptions.target, { defaultToAll: false })
    : undefined;
  const selectedTargetKeys = selectedTargets?.map((target) => target.key);

  // with environments
  if (Array.isArray(projectConfig.environments)) {
    for (const environment of projectConfig.environments) {
      await buildTestDatafilesForEnvironment(
        deps,
        datafileContentByKey,
        environment,
        selectedTargetKeys,
      );
    }
  }

  // no environments
  if (!Array.isArray(projectConfig.environments)) {
    await buildTestDatafilesForEnvironment(deps, datafileContentByKey, false, selectedTargetKeys);
  }

  const tests = await listEntities<Test>(
    {
      rootDirectoryPath,
      projectConfig,
      datasource,
      options: {
        ...testOptions,
        applyMatrix: true,
      },
    },
    "test",
  );

  for (const originalTest of tests) {
    const test = filterTestForTargets(originalTest, selectedTargetKeys);
    if (!test) continue;

    const executionResult = await executeTest(test, deps, options, datafileContentByKey);

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
    const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);
    let hasError = false;

    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set);

      const executionHasError = await testProject(
        {
          rootDirectoryPath,
          projectConfig: execution.projectConfig,
          datasource: execution.datasource,
          options: parsed,
        },
        parsed as TestProjectOptions,
      );

      if (executionHasError) {
        hasError = true;
      }
    }

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
