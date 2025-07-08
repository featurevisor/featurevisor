import { TestResult } from "@featurevisor/types";

import { CLI_FORMAT_BOLD, CLI_FORMAT_RED } from "./cliFormat";
import { prettyDuration } from "./prettyDuration";

export function printTestResult(testResult: TestResult, relativeTestFilePath, rootDirectoryPath) {
  console.log("");

  const title = `Testing: ${relativeTestFilePath.replace(rootDirectoryPath, "")} (${prettyDuration(
    testResult.duration,
  )})`;
  console.log(title);

  if (testResult.notFound) {
    console.log(CLI_FORMAT_RED, `  => ${testResult.type} ${testResult.key} not found`);

    return;
  }

  console.log(CLI_FORMAT_BOLD, `  ${testResult.type} "${testResult.key}":`);

  testResult.assertions.forEach(function (assertion) {
    if (assertion.passed) {
      console.log(`  ✔ ${assertion.description} (${prettyDuration(assertion.duration)})`);
    } else {
      console.log(
        CLI_FORMAT_RED,
        `  ✘ ${assertion.description} (${prettyDuration(assertion.duration)})`,
      );

      assertion.errors?.forEach(function (error) {
        if (error.message) {
          console.log(CLI_FORMAT_RED, `    => ${error.message}`);

          return;
        }

        let section: string = error.type;

        if (error.type === "flag") {
          section = "expectedToBeEnabled";
        } else if (error.type === "variation") {
          section = "expectedVariation";
        } else if (error.type === "variable") {
          section = "expectedVariables";
        }

        if (error.details && error.details.childIndex !== undefined) {
          section = `children[${error.details.childIndex}].${section}`;
        }

        if (error.type === "variable") {
          const variableKey = (error.details as any).variableKey;

          console.log(CLI_FORMAT_RED, `    => ${section}.${variableKey}:`);
          console.log(CLI_FORMAT_RED, `       => expected: ${error.expected}`);
          console.log(CLI_FORMAT_RED, `       => received: ${error.actual}`);
        } else {
          if (error.type === "evaluation") {
            if (error.details && error.details.variableKey) {
              section = `${section}.variables.${error.details.variableKey}.${error.details.evaluationKey}`;
            } else if (error.details && error.details.evaluationType) {
              section = `${section}.${error.details.evaluationType}.${error.details.evaluationKey}`;
            }
          }

          console.log(
            CLI_FORMAT_RED,
            `    => ${section}: expected "${error.expected}", received "${error.actual}"`,
          );
        }
      });
    }
  });
}
