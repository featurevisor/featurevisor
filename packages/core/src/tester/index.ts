import * as fs from "fs";

import { ExistingState, TestSegment, TestFeature } from "@featurevisor/types";
import { createInstance, MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";

import { ProjectConfig, SCHEMA_VERSION } from "../config";
import { getExistingStateFilePath, buildDatafile } from "../builder";
import { Datasource } from "../datasource";

import { checkIfArraysAreEqual } from "./checkIfArraysAreEqual";
import { checkIfObjectsAreEqual } from "./checkIfObjectsAreEqual";
import { testSegment } from "./testSegment";

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
      const testFeature = t as TestFeature;
      const featureKey = testFeature.feature;

      console.log(`     => Feature "${featureKey}":`);

      testFeature.assertions.forEach(function (assertion, aIndex) {
        const description = assertion.description || `at ${assertion.at}%`;

        console.log(
          `        => Assertion #${aIndex + 1}: (${assertion.environment}) ${description}`,
        );

        const featuresToInclude = Array.from(
          datasource.getRequiredFeaturesChain(testFeature.feature),
        );

        const datafileContent = buildDatafile(
          projectConfig,
          datasource,
          {
            schemaVersion: SCHEMA_VERSION,
            revision: "testing",
            environment: assertion.environment,
            features: featuresToInclude,
          },
          JSON.parse(
            fs.readFileSync(getExistingStateFilePath(projectConfig, assertion.environment), "utf8"),
          ) as ExistingState,
        );

        const sdk = createInstance({
          datafile: datafileContent,
          configureBucketValue: () => {
            return assertion.at * (MAX_BUCKETED_NUMBER / 100);
          },
          // logger: createLogger({
          //   levels: ["debug", "info", "warn", "error"],
          // }),
        });

        // isEnabled
        if ("expectedToBeEnabled" in assertion) {
          const isEnabled = sdk.isEnabled(featureKey, assertion.context);

          if (isEnabled !== assertion.expectedToBeEnabled) {
            hasError = true;

            console.error(
              `           isEnabled failed: expected "${assertion.expectedToBeEnabled}", got "${isEnabled}"`,
            );
          }
        }

        // variation
        if ("expectedVariation" in assertion) {
          const variation = sdk.getVariation(featureKey, assertion.context);

          if (variation !== assertion.expectedVariation) {
            hasError = true;

            console.error(
              `           Variation failed: expected "${assertion.expectedVariation}", got "${variation}"`,
            );
          }
        }

        // variables
        if (typeof assertion.expectedVariables === "object") {
          Object.keys(assertion.expectedVariables).forEach(function (variableKey) {
            const expectedValue =
              assertion.expectedVariables && assertion.expectedVariables[variableKey];
            const actualValue = sdk.getVariable(featureKey, variableKey, assertion.context);

            let passed;

            if (typeof expectedValue === "object") {
              passed = checkIfObjectsAreEqual(expectedValue, actualValue);
            } else if (Array.isArray(expectedValue)) {
              passed = checkIfArraysAreEqual(expectedValue, actualValue);
            } else {
              passed = expectedValue === actualValue;
            }

            if (!passed) {
              hasError = true;

              console.error(
                `           Variable "${variableKey}" failed: expected ${JSON.stringify(
                  expectedValue,
                )}, got "${JSON.stringify(actualValue)}"`,
              );
            }
          });
        }
      });
    } else {
      console.error(`     => Invalid test: ${JSON.stringify(test)}`);
      hasError = true;
    }
  }

  return hasError;
}
