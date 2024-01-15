import { TestFeature } from "@featurevisor/types";
import { createInstance, MAX_BUCKETED_NUMBER } from "@featurevisor/sdk";

import { Datasource } from "../datasource";
import { ProjectConfig } from "../config";
import { buildDatafile } from "../builder";
import { SCHEMA_VERSION } from "../config";

import { checkIfArraysAreEqual } from "./checkIfArraysAreEqual";
import { checkIfObjectsAreEqual } from "./checkIfObjectsAreEqual";
import { CLI_FORMAT_BOLD, CLI_FORMAT_RED } from "./cliFormat";
import { getFeatureAssertionsFromMatrix } from "./matrix";

export async function testFeature(
  datasource: Datasource,
  projectConfig: ProjectConfig,
  test: TestFeature,
  options: { verbose?: boolean; showDatafile?: boolean } = {},
  patterns,
): Promise<boolean> {
  let hasError = false;
  const featureKey = test.feature;

  console.log(CLI_FORMAT_BOLD, `  Feature "${featureKey}":`);

  for (let aIndex = 0; aIndex < test.assertions.length; aIndex++) {
    const assertions = getFeatureAssertionsFromMatrix(aIndex, test.assertions[aIndex]);

    for (let bIndex = 0; bIndex < assertions.length; bIndex++) {
      const assertion = assertions[bIndex];

      if (patterns.assertionPattern && !patterns.assertionPattern.test(assertion.description)) {
        continue;
      }

      console.log(assertion.description);

      const requiredChain = await datasource.getRequiredFeaturesChain(test.feature);
      const featuresToInclude = Array.from(requiredChain);

      const existingState = await datasource.readState(assertion.environment);
      const datafileContent = await buildDatafile(
        projectConfig,
        datasource,
        {
          schemaVersion: SCHEMA_VERSION,
          revision: "testing",
          environment: assertion.environment,
          features: featuresToInclude,
        },
        existingState,
      );

      if (options.showDatafile) {
        console.log("");
        console.log(JSON.stringify(datafileContent, null, 2));
        console.log("");
      }

      const sdk = createInstance({
        datafile: datafileContent,
        configureBucketValue: () => {
          return assertion.at * (MAX_BUCKETED_NUMBER / 100);
        },
      });

      if (options.verbose) {
        sdk.setLogLevels(["debug", "info", "warn", "error"]);
      }

      // isEnabled
      if ("expectedToBeEnabled" in assertion) {
        const isEnabled = sdk.isEnabled(featureKey, assertion.context);

        if (isEnabled !== assertion.expectedToBeEnabled) {
          hasError = true;

          console.error(
            CLI_FORMAT_RED,
            `    isEnabled failed: expected "${assertion.expectedToBeEnabled}", received "${isEnabled}"`,
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
            `    Variation failed: expected "${assertion.expectedVariation}", received "${variation}"`,
          );
        }
      }

      // variables
      const feature = await datasource.readFeature(featureKey);

      if (!feature) {
        hasError = true;

        console.error(CLI_FORMAT_RED, `    Feature "${featureKey}" failed: feature not found`);

        continue;
      }

      if (typeof assertion.expectedVariables === "object") {
        Object.keys(assertion.expectedVariables).forEach(function (variableKey) {
          const expectedValue =
            assertion.expectedVariables && assertion.expectedVariables[variableKey];
          const actualValue = sdk.getVariable(featureKey, variableKey, assertion.context);

          let passed;

          const variableSchema = feature.variablesSchema?.find((v) => v.key === variableKey);

          if (!variableSchema) {
            hasError = true;

            console.error(
              CLI_FORMAT_RED,
              `    Variable "${variableKey}" failed: variable schema not found in feature`,
            );

            return;
          }

          if (variableSchema.type === "json") {
            // JSON type
            const parsedExpectedValue =
              typeof expectedValue === "string"
                ? JSON.parse(expectedValue as string)
                : expectedValue;

            if (Array.isArray(actualValue)) {
              passed = checkIfArraysAreEqual(parsedExpectedValue, actualValue);
            } else if (typeof actualValue === "object") {
              passed = checkIfObjectsAreEqual(parsedExpectedValue, actualValue);
            } else {
              passed = JSON.stringify(parsedExpectedValue) === JSON.stringify(actualValue);
            }

            if (!passed) {
              console.error(CLI_FORMAT_RED, `    Variable "${variableKey}" failed:`);
              console.error(
                CLI_FORMAT_RED,
                `      expected: ${JSON.stringify(parsedExpectedValue)}`,
              );
              console.error(CLI_FORMAT_RED, `      received: ${JSON.stringify(actualValue)}`);
            }
          } else {
            // other types
            if (typeof expectedValue === "object") {
              passed = checkIfObjectsAreEqual(expectedValue, actualValue);
            } else if (Array.isArray(expectedValue)) {
              passed = checkIfArraysAreEqual(expectedValue, actualValue);
            } else {
              passed = expectedValue === actualValue;
            }

            if (!passed) {
              console.error(CLI_FORMAT_RED, `    Variable "${variableKey}" failed:`);
              console.error(CLI_FORMAT_RED, `      expected: ${JSON.stringify(expectedValue)}`);
              console.error(CLI_FORMAT_RED, `      received: ${JSON.stringify(actualValue)}`);
            }
          }

          if (!passed) {
            hasError = true;
          }
        });
      }
    }
  }

  return hasError;
}
