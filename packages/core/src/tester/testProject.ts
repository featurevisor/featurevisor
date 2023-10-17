import * as fs from "fs";

import { TestSegment, TestFeature } from "@featurevisor/types";

import { testSegment } from "./testSegment";
import { testFeature } from "./testFeature";
import { CLI_FORMAT_BOLD, CLI_FORMAT_GREEN, CLI_FORMAT_RED } from "./cliFormat";
import { Dependencies } from "../dependencies";

export async function testProject(deps: Dependencies): Promise<boolean> {
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

  for (const testFile of testFiles) {
    const testFilePath = datasource.getEntityPath("test", testFile);

    console.log("");
    console.log(CLI_FORMAT_BOLD, `Testing: ${testFilePath.replace(rootDirectoryPath, "")}`);

    const t = await datasource.readTest(testFile);

    if ((t as TestSegment).segment) {
      // segment testing
      const test = t as TestSegment;

      const segmentHasError = await testSegment(datasource, test);

      if (segmentHasError) {
        hasError = true;
      }
    } else if ((t as TestFeature).feature) {
      // feature testing
      const test = t as TestFeature;

      const featureHasError = await testFeature(datasource, projectConfig, test);

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
