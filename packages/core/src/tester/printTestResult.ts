import { TestResult } from "@featurevisor/types";

import { CLI_FORMAT_BOLD, CLI_FORMAT_RED } from "./cliFormat";
import { prettyDuration } from "./prettyDuration";

export function printTestResult(testResult: TestResult, testFilePath, rootDirectoryPath) {
  console.log("");

  const title = `Testing: ${testFilePath.replace(rootDirectoryPath, "")} (${prettyDuration(
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

        if (error.type === "variable") {
          const variableKey = (error.details as any).variableKey;

          console.log(CLI_FORMAT_RED, `    => variable key: ${variableKey}`);
          console.log(CLI_FORMAT_RED, `       => expected: ${error.expected}`);
          console.log(CLI_FORMAT_RED, `       => received: ${error.actual}`);
        } else {
          console.log(
            CLI_FORMAT_RED,
            `    => ${error.type}: expected "${error.expected}", received "${error.actual}"`,
          );
        }
      });
    }
  });
}
