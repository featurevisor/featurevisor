import * as fs from "fs";

import { TestFeature, ExistingState } from "@featurevisor/types";
import { createInstance, MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";

import { Datasource } from "../datasource";
import { ProjectConfig } from "../config";
import { buildDatafile, getExistingStateFilePath } from "../builder";
import { SCHEMA_VERSION } from "../config";

import { checkIfArraysAreEqual } from "./checkIfArraysAreEqual";
import { checkIfObjectsAreEqual } from "./checkIfObjectsAreEqual";
import { CLI_FORMAT_BOLD, CLI_FORMAT_RED } from "./cliFormat";

export async function testFeature(
  datasource: Datasource,
  projectConfig: ProjectConfig,
  test: TestFeature,
): Promise<boolean> {
  let hasError = false;
  const featureKey = test.feature;

  console.log(CLI_FORMAT_BOLD, `  Feature "${featureKey}":`);

  for (let aIndex = 0; aIndex < test.assertions.length; aIndex++) {
    const assertion = test.assertions[aIndex];
    const description = assertion.description || `at ${assertion.at}%`;

    console.log(`  Assertion #${aIndex + 1}: (${assertion.environment}) ${description}`);

    const requiredChain = await datasource.getRequiredFeaturesChain(test.feature);
    const featuresToInclude = Array.from(requiredChain);

    const datafileContent = await buildDatafile(
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
          CLI_FORMAT_RED,
          `    isEnabled failed: expected "${assertion.expectedToBeEnabled}", got "${isEnabled}"`,
        );
      }
    }

    // variation
    if ("expectedVariation" in assertion) {
      const variation = sdk.getVariation(featureKey, assertion.context);

      if (variation !== assertion.expectedVariation) {
        hasError = true;

        console.error(
          CLI_FORMAT_RED,
          `    Variation failed: expected "${assertion.expectedVariation}", got "${variation}"`,
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
            CLI_FORMAT_RED,
            `    Variable "${variableKey}" failed: expected ${JSON.stringify(
              expectedValue,
            )}, got "${JSON.stringify(actualValue)}"`,
          );
        }
      });
    }
  }

  return hasError;
}
