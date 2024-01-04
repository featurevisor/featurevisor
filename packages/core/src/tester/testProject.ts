import * as fs from "fs";

import { TestSegment, TestFeature } from "@featurevisor/types";

import { testSegment } from "./testSegment";
import { testFeature } from "./testFeature";
import { CLI_FORMAT_BOLD, CLI_FORMAT_GREEN, CLI_FORMAT_RED } from "./cliFormat";
import { Dependencies } from "../dependencies";

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

  const patterns = {
    keyPattern: options.keyPattern ? new RegExp(options.keyPattern) : undefined,
    assertionPattern: options.assertionPattern ? new RegExp(options.assertionPattern) : undefined,
  };

  for (const testFile of testFiles) {
    const testFilePath = datasource.getTestSpecName(testFile);

    const t = await datasource.readTest(testFile);

    if ((t as TestSegment).segment) {
      // segment testing
      const test = t as TestSegment;

      if (patterns.keyPattern && !patterns.keyPattern.test(test.segment)) {
        continue;
      }

      console.log(CLI_FORMAT_BOLD, `\nTesting: ${testFilePath.replace(rootDirectoryPath, "")}`);

      const segmentHasError = await testSegment(datasource, test, patterns);

      if (segmentHasError) {
        hasError = true;
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
      }
    } else {
      console.error(`  => Invalid test: ${JSON.stringify(test)}`);
      hasError = true;
    }
  }

  console.log("");
  if (hasError) {
    console.log(CLI_FORMAT_RED, `Some tests failed`);
  } else {
    console.log(CLI_FORMAT_GREEN, `All tests passed`);
  }
  console.log("");

  return hasError;
}
