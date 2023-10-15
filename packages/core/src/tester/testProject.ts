import * as fs from "fs";

import { TestSegment, TestFeature } from "@featurevisor/types";

import { ProjectConfig } from "../config";
import { Datasource } from "../datasource";

import { testSegment } from "./testSegment";
import { testFeature } from "./testFeature";

export function testProject(rootDirectoryPath: string, projectConfig: ProjectConfig): boolean {
  let hasError = false;
  const datasource = new Datasource(projectConfig);

  if (!fs.existsSync(projectConfig.testsDirectoryPath)) {
    console.error(`Tests directory does not exist: ${projectConfig.testsDirectoryPath}`);
    hasError = true;

    return hasError;
  }

  const testFiles = datasource.listTests();

  if (testFiles.length === 0) {
    console.error(`No tests found in: ${projectConfig.testsDirectoryPath}`);
    hasError = true;

    return hasError;
  }

  for (const testFile of testFiles) {
    const testFilePath = datasource.getEntityPath("test", testFile);

    console.log(`  => Testing: ${testFilePath.replace(rootDirectoryPath, "")}`);

    const t = datasource.readTest(testFile);

    if ((t as TestSegment).segment) {
      // segment testing
      const test = t as TestSegment;

      const segmentHasError = testSegment(datasource, test);

      if (segmentHasError) {
        hasError = true;
      }
    } else if ((t as TestFeature).feature) {
      // feature testing
      const test = t as TestFeature;

      const featureHasError = testFeature(datasource, projectConfig, test);

      if (featureHasError) {
        hasError = true;
      }
    } else {
      console.error(`     => Invalid test: ${JSON.stringify(test)}`);
      hasError = true;
    }
  }

  return hasError;
}
