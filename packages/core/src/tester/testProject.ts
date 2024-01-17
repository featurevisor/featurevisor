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

  let passedCount = 0;
  let failedCount = 0;

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
        failedCount++;
      } else {
        passedCount++;
      }
    } else if ((t as TestFeature).feature) {
      // feature testing
      const test = t as TestFeature;

      if (patterns.keyPattern && !patterns.keyPattern.test(test.feature)) {
        continue;
      }

      console.log(CLI_FORMAT_BOLD, `\nTesting: ${testFilePath.replace(rootDirectoryPath, "")}`);

      const featureHasError = await testFeature(datasource, projectConfig, test, options, patterns);

      if (featureHasError) {
        hasError = true;
        failedCount++;
      } else {
        passedCount++;
      }
    } else {
      console.error(`  => Invalid test: ${JSON.stringify(test)}`);
      hasError = true;
    }
  }

  const diffInMs = Date.now() - startTime;

  console.log("\n---\n");

  const testsMessage = `Tests:\t${passedCount} passed, ${failedCount} failed`;
  if (hasError) {
    console.log(CLI_FORMAT_RED, testsMessage);
  } else {
    console.log(CLI_FORMAT_GREEN, testsMessage);
  }

  console.log(`Time:\t${prettyDuration(diffInMs)}`);

  return hasError;
}
