import * as fs from "fs";

import { TestSegment, TestFeature } from "@featurevisor/types";

import { testSegment } from "./testSegment";
import { testFeature } from "./testFeature";
import { CLI_FORMAT_BOLD, CLI_FORMAT_GREEN, CLI_FORMAT_RED } from "./cliFormat";
import { Dependencies } from "../dependencies";
import { prettyDuration } from "./prettyDuration";
import { printTestResult } from "./printTestResult";

export interface TestProjectOptions {
  keyPattern?: string;
  assertionPattern?: string;
  verbose?: boolean;
  showDatafile?: boolean;
}

export async function testProject(
  deps: Dependencies,
  options: TestProjectOptions = {},
): Promise<boolean> {
  const { rootDirectoryPath, projectConfig, datasource } = deps;

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

  const patterns = {
    keyPattern: options.keyPattern ? new RegExp(options.keyPattern) : undefined,
    assertionPattern: options.assertionPattern ? new RegExp(options.assertionPattern) : undefined,
  };

  let passedTestsCount = 0;
  let failedTestsCount = 0;

  let passedAssertionsCount = 0;
  let failedAssertionsCount = 0;

  for (const testFile of testFiles) {
    const testFilePath = datasource.getTestSpecName(testFile);

    const t = await datasource.readTest(testFile);

    if ((t as TestSegment).segment) {
      // segment testing
      const test = t as TestSegment;

      if (patterns.keyPattern && !patterns.keyPattern.test(test.segment)) {
        continue;
      }

      const testResult = await testSegment(datasource, test, patterns);
      printTestResult(testResult, testFilePath, rootDirectoryPath);

      if (!testResult.passed) {
        hasError = true;
        failedTestsCount++;

        failedAssertionsCount += testResult.assertions.filter((a) => !a.passed).length;
        passedAssertionsCount += testResult.assertions.length - failedAssertionsCount;
      } else {
        passedTestsCount++;

        passedAssertionsCount += testResult.assertions.length;
      }
    } else if ((t as TestFeature).feature) {
      // feature testing
      const test = t as TestFeature;

      if (patterns.keyPattern && !patterns.keyPattern.test(test.feature)) {
        continue;
      }

      const testResult = await testFeature(datasource, projectConfig, test, options, patterns);
      printTestResult(testResult, testFilePath, rootDirectoryPath);

      if (!testResult.passed) {
        hasError = true;
        failedTestsCount++;

        failedAssertionsCount += testResult.assertions.filter((a) => !a.passed).length;
        passedAssertionsCount += testResult.assertions.length - failedAssertionsCount;
      } else {
        passedTestsCount++;

        passedAssertionsCount += testResult.assertions.length;
      }
    } else {
      console.error(`  => Invalid test: ${JSON.stringify(test)}`);
      hasError = true;
    }
  }

  const diffInMs = Date.now() - startTime;

  console.log("\n---\n");

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
