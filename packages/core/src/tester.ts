import * as fs from "fs";

import { Condition, ExistingState, TestSegment, TestFeature } from "@featurevisor/types";
import { createInstance, allConditionsAreMatched, MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";

import { ProjectConfig, SCHEMA_VERSION } from "./config";
import { getExistingStateFilePath, buildDatafile } from "./builder";
import { Datasource } from "./datasource/datasource";

// @TODO: make it better
export function checkIfArraysAreEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }

  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

export function checkIfObjectsAreEqual(a, b) {
  if (typeof a !== "object" || typeof b !== "object") {
    return false;
  }

  if (a === null || b === null) {
    return false;
  }

  if (Object.keys(a).length !== Object.keys(b).length) {
    return false;
  }

  for (const key in a) {
    if (a[key] !== b[key]) {
      return false;
    }
  }

  return true;
}

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

    const test = datasource.readTest(testFile);

    if ((test as TestSegment).segment) {
      // segment testing
      const testSegment = test as TestSegment;
      const segmentKey = testSegment.segment;

      console.log(`     => Segment "${segmentKey}":`);

      const segmentExists = datasource.entityExists("segment", segmentKey);

      if (!segmentExists) {
        console.error(`        => Segment does not exist: ${segmentKey}`);
        hasError = true;

        continue;
      }

      const parsedSegment = datasource.readSegment(segmentKey);
      const conditions = parsedSegment.conditions as Condition | Condition[];

      testSegment.assertions.forEach(function (assertion, aIndex) {
        const description = assertion.description || `#${aIndex + 1}`;

        console.log(`        => Assertion #${aIndex + 1}: ${description}`);

        const expected = assertion.expectedToMatch;
        const actual = allConditionsAreMatched(conditions, assertion.context);

        if (actual !== expected) {
          hasError = true;

          console.error(`           Segment failed: expected "${expected}", got "${actual}"`);
        }
      });
    } else if ((test as TestFeature).feature) {
      // feature testing
      const testFeature = test as TestFeature;
      const featureKey = testFeature.feature;

      console.log(`     => Feature "${featureKey}":`);

      testFeature.assertions.forEach(function (assertion, aIndex) {
        const description = assertion.description || `at ${assertion.at}%`;

        console.log(
          `        => Assertion #${aIndex + 1}: (${assertion.environment}) ${description}`,
        );

        const datafileContent = buildDatafile(
          projectConfig,
          datasource,
          {
            schemaVersion: SCHEMA_VERSION,
            revision: "testing",
            environment: assertion.environment,
            features: Array.from(datasource.getRequiredFeaturesChain(testFeature.feature)),
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
