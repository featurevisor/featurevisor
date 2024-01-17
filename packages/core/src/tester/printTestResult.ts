import { TestResult } from "@featurevisor/types";

import { CLI_FORMAT_BOLD, CLI_FORMAT_RED } from "./cliFormat";

export function printTestResult(testResult: TestResult, testFilePath, rootDirectoryPath) {
  console.log(CLI_FORMAT_BOLD, `\nTesting: ${testFilePath.replace(rootDirectoryPath, "")}`);

  if (testResult.notFound) {
    console.log(CLI_FORMAT_RED, `  => ${testResult.type} ${testResult.key} not found`);

    return;
  }

  console.log(CLI_FORMAT_BOLD, `  ${testResult.type} "${testResult.key}":`);

  testResult.assertions.forEach(function (assertion) {
    if (assertion.passed) {
      console.log(`  ✔ ${assertion.description}`);
    } else {
      console.log(CLI_FORMAT_RED, `  ✘ ${assertion.description}`);

      assertion.errors?.forEach(function (error) {
        console.log(
          CLI_FORMAT_RED,
          `    => ${error.type}: expected "${error.expected}" but got "${error.actual}"`,
        );
      });
    }
  });
}
