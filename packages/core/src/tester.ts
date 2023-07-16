import * as fs from "fs";
import * as path from "path";

import { DatafileContent, Spec, Segment, Condition } from "@featurevisor/types";
import {
  createInstance,
  createLogger,
  allConditionsAreMatched,
  MAX_BUCKETED_NUMBER,
} from "@featurevisor/sdk";

import { ProjectConfig } from "./config";
import { parseYaml } from "./utils";
import { getDatafilePath } from "./builder";

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

  if (!fs.existsSync(projectConfig.testsDirectoryPath)) {
    console.error(`Tests directory does not exist: ${projectConfig.testsDirectoryPath}`);
    hasError = true;

    return hasError;
  }

  const testFiles = fs
    .readdirSync(projectConfig.testsDirectoryPath)
    .filter((f) => f.endsWith(".yml"));

  if (testFiles.length === 0) {
    console.error(`No tests found in: ${projectConfig.testsDirectoryPath}`);
    hasError = true;

    return hasError;
  }

  for (const testFile of testFiles) {
    const testFilePath = path.join(projectConfig.testsDirectoryPath, testFile);

    console.log(`  => Testing: ${testFilePath.replace(rootDirectoryPath, "")}`);

    const parsed = parseYaml(fs.readFileSync(testFilePath, "utf8")) as Spec;

    parsed.tests.forEach(function (test, tIndex) {
      if (test.segments) {
        // segment testing
        test.segments.forEach(function (segment, sIndex) {
          const segmentKey = segment.key;

          console.log(`     => Segment "${segmentKey}":`);

          const segmentPath = path.join(projectConfig.segmentsDirectoryPath, `${segmentKey}.yml`);

          if (!fs.existsSync(segmentPath)) {
            console.error(`        => Segment does not exist: ${segmentPath}`);
            hasError = true;

            return;
          }

          const parsedSegment = parseYaml(fs.readFileSync(segmentPath, "utf8")) as Segment;
          const conditions = parsedSegment.conditions as Condition | Condition[];

          segment.assertions.forEach(function (assertion, aIndex) {
            const description = assertion.description || `#${aIndex + 1}`;

            console.log(`        => Assertion #${aIndex + 1}: ${description}`);

            let assertionHasError = false;

            const expected = assertion.expected;
            const actual = allConditionsAreMatched(conditions, assertion.context);

            if (actual !== expected) {
              hasError = true;
              assertionHasError = true;

              console.error(`           Segment failed: expected "${expected}", got "${actual}"`);
            }
          });
        });
      } else if (test.environment && test.tag && test.features) {
        // feature testing
        const datafilePath = getDatafilePath(projectConfig, test.environment, test.tag);

        if (!fs.existsSync(datafilePath)) {
          console.error(`     => Datafile does not exist: ${datafilePath}`);
          hasError = true;

          return;
        }

        const datafileContent = JSON.parse(
          fs.readFileSync(datafilePath, "utf8"),
        ) as DatafileContent;

        let currentAt = 0;

        let sdk = createInstance({
          datafile: datafileContent,
          configureBucketValue: (feature, attributes, bucketValue) => {
            return currentAt;
          },
          // logger: createLogger({
          //   levels: ["debug", "info", "warn", "error"],
          // }),
        });

        test.features.forEach(function (feature, fIndex) {
          const featureKey = feature.key;

          console.log(`     => Feature "${featureKey}" in environment "${test.environment}":`);

          feature.assertions.forEach(function (assertion, aIndex) {
            const description = assertion.description || `at ${assertion.at}%`;

            console.log(`        => Assertion #${aIndex + 1}: ${description}`);

            let assertionHasError = false;
            currentAt = assertion.at * (MAX_BUCKETED_NUMBER / 100);

            // isEnabled
            if ("expectedToBeEnabled" in assertion) {
              const isEnabled = sdk.isEnabled(featureKey, assertion.context);

              if (isEnabled !== assertion.expectedToBeEnabled) {
                hasError = true;
                assertionHasError = true;

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
                assertionHasError = true;

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
                  assertionHasError = true;

                  console.error(
                    `           Variable "${variableKey}" failed: expected ${JSON.stringify(
                      expectedValue,
                    )}, got "${JSON.stringify(actualValue)}"`,
                  );
                }
              });
            }
          });
        });
      } else {
        console.error(`     => Invalid test: ${JSON.stringify(test)}`);
        hasError = true;
      }
    });
  }

  return hasError;
}
