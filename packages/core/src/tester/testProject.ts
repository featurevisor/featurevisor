import * as fs from "fs";

import type { TestSegment, TestFeature, Test, DatafileContent } from "@featurevisor/types";

import { testSegment } from "./testSegment";
import { testFeature } from "./testFeature";
import { CLI_FORMAT_BOLD, CLI_FORMAT_GREEN, CLI_FORMAT_RED } from "./cliFormat";
import { Dependencies } from "../dependencies";
import { prettyDuration } from "./prettyDuration";
import { printTestResult } from "./printTestResult";

import { buildDatafile, buildScopedDatafile } from "../builder";
import { SCHEMA_VERSION } from "../config";
import { Plugin } from "../cli";
import { listEntities } from "../list";

export interface TestProjectOptions {
  keyPattern?: string;
  assertionPattern?: string;
  verbose?: boolean;
  showDatafile?: boolean;
  onlyFailures?: boolean;
  schemaVersion?: string;
  inflate?: number;
}

export interface ExecutionResult {
  passed: boolean;
  assertionsCount: {
    passed: number;
    failed: number;
  };
}

// the key can be either "<EnvironmentKey>" or "<EnvironmentKey>scope-<Scope>"
export type DatafileContentByEnvironment = Map<string | false, DatafileContent>;

export async function executeTest(
  test: Test,
  deps: Dependencies,
  options: TestProjectOptions,
  datafileContentByEnvironment: DatafileContentByEnvironment,
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

      datafileContentByEnvironment.set(environment, datafileContent as DatafileContent);

      // by scope
      if (projectConfig.scopes) {
        for (const scope of projectConfig.scopes) {
          const existingState = await datasource.readState(environment);
          const datafileContent = await buildDatafile(
            projectConfig,
            datasource,
            {
              schemaVersion: options.schemaVersion || SCHEMA_VERSION,
              revision: "include-scoped-features",
              environment: environment,
              inflate: options.inflate,
              tag: scope.tag,
              tags: scope.tags,
            },
            existingState,
          );

          const scopedDatafileContent = buildScopedDatafile(
            datafileContent as DatafileContent,
            scope.context,
          );

          datafileContentByEnvironment.set(
            `${environment}-scope-${scope.name}`,
            scopedDatafileContent,
          );
        }
      }

      // @TODO: by tag
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

    datafileContentByEnvironment.set(false, datafileContent as DatafileContent);

    // by scope
    if (projectConfig.scopes) {
      for (const scope of projectConfig.scopes) {
        const existingState = await datasource.readState(false);
        const datafileContent = await buildDatafile(
          projectConfig,
          datasource,
          {
            schemaVersion: options.schemaVersion || SCHEMA_VERSION,
            revision: "include-scoped-features",
            environment: false,
            inflate: options.inflate,
            tag: scope.tag,
            tags: scope.tags,
          },
          existingState,
        );

        const scopedDatafileContent = buildScopedDatafile(
          datafileContent as DatafileContent,
          scope.context,
        );

        datafileContentByEnvironment.set(`scope-${scope.name}`, scopedDatafileContent);
      }
    }

    // @TODO: by tag
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

  for (const test of tests) {
    const executionResult = await executeTest(test, deps, options, datafileContentByEnvironment);

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
