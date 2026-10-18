import type { Test, TestResult } from "@featurevisor/types";

import {
  CLI_COLOR_CYAN,
  CLI_FORMAT_BOLD,
  CLI_FORMAT_GREEN,
  CLI_FORMAT_RED,
  colorize,
} from "./cliFormat";
import { prettyDuration } from "./prettyDuration";
import { formatCaseLabel, formatRerun, type ReportSpec } from "./report";

function formatValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "undefined") return "undefined";
  return JSON.stringify(value);
}

function formatHumanPath(path: Array<string | number>): string {
  return path.map((part) => (typeof part === "number" ? part + 1 : part)).join(".");
}

export function printTestResult(
  testResult: TestResult,
  relativeTestFilePath,
  rootDirectoryPath,
  report?: ReportSpec,
  test?: Test,
) {
  console.log("");

  const title = `Testing: ${(report?.source || relativeTestFilePath).replace(rootDirectoryPath, "")} (${prettyDuration(
    testResult.duration,
  )})`;
  console.log(colorize(title, CLI_COLOR_CYAN));

  if (testResult.notFound) {
    console.log(CLI_FORMAT_RED, `  => ${testResult.type} ${testResult.key} not found`);

    return;
  }

  console.log(CLI_FORMAT_BOLD, `  ${testResult.type} "${testResult.key}":`);

  testResult.assertions.forEach(function (assertion, assertionIndex) {
    const caseLabel = report?.cases[assertionIndex]
      ? formatCaseLabel(
          report.cases[assertionIndex],
          assertionIndex,
          test?.assertions[assertionIndex],
        )
      : assertion.description;
    if (assertion.passed) {
      console.log(CLI_FORMAT_GREEN, `  ✔ ${caseLabel} (${prettyDuration(assertion.duration)})`);
    } else {
      console.log(CLI_FORMAT_RED, `  ✘ ${caseLabel} (${prettyDuration(assertion.duration)})`);

      assertion.errors?.forEach(function (error, errorIndex) {
        if (error.type === "check") {
          const child = error.details?.childIndex;
          const index = error.details?.checkIndex;
          const name = "check";
          const named = error.details?.checkKey
            ? ` "${error.details.checkKey}"`
            : index !== undefined
              ? ` ${Number(index) + 1}`
              : "";
          const label = `${child !== undefined ? `Child ${Number(child) + 1}, ` : ""}${name}${named}${error.details?.checkDescription ? ` (${error.details.checkDescription})` : ""}`;
          console.log(
            CLI_FORMAT_RED,
            `    => ${label}: ${error.message || (error.actual === false ? "did not match" : formatValue(error.actual))}`,
          );
          const reportError = report?.cases[assertionIndex]?.errors[errorIndex];
          if (reportError?.path) console.log(`       at ${formatHumanPath(reportError.path)}`);
          for (const [leafIndex, originalLeaf] of (error.details?.evaluated || []).entries()) {
            const leaf = {
              ...originalLeaf,
              path:
                (reportError?.details?.evaluated as any)?.[leafIndex]?.path || originalLeaf.path,
            };
            if (leaf.reference?.segment) {
              console.log(
                CLI_FORMAT_RED,
                `       segment ${leaf.reference.segment}: expected ${leaf.expected ? "matches" : "does not match"}, received ${typeof leaf.actual === "boolean" ? (leaf.actual ? "matches" : "does not match") : formatValue(leaf.actual)} (${formatHumanPath(leaf.path)})`,
              );
              continue;
            }
            if (leaf.property) {
              console.log(
                CLI_FORMAT_RED,
                `       feature ${leaf.reference.feature}, ${leaf.property}: expected ${formatValue(leaf.expected)}, received ${formatValue(leaf.actual)} (${formatHumanPath(leaf.path)})`,
              );
              continue;
            }
            const describe = (reference) =>
              `${reference.feature ? `feature ${reference.feature}, ` : "global "}variable ${reference.variable}${reference.path !== undefined ? ` at ${JSON.stringify(reference.path)}` : ""}`;
            console.log(
              CLI_FORMAT_RED,
              `       ${describe(leaf.reference)} = ${formatValue(leaf.actual)}`,
            );
            console.log(
              CLI_FORMAT_RED,
              `       ${leaf.operator}${leaf.compareTo ? ` ${describe(leaf.compareTo)}` : ""}${leaf.expected !== undefined ? `: ${formatValue(leaf.expected)}` : ""} (${formatHumanPath(leaf.path)})`,
            );
          }
          return;
        }
        if (error.message) {
          console.log(CLI_FORMAT_RED, `    => ${error.message}`);

          return;
        }

        let section: string = error.type;

        if (testResult.type === "variable" && error.type === "variable") {
          section = "expectedValue";
        } else if (error.type === "flag") {
          section = "expectedToBeEnabled";
        } else if (error.type === "variation") {
          section = "expectedVariation";
        } else if (error.type === "variable") {
          section = "expectedVariables";
        }

        if (error.details && error.details.childIndex !== undefined) {
          section = `Child ${error.details.childIndex + 1}, ${section}`;
        }

        if (testResult.type === "variable" && error.type === "variable") {
          console.log(CLI_FORMAT_RED, `    => ${section}:`);
          console.log(CLI_FORMAT_RED, `       => expected: ${formatValue(error.expected)}`);
          console.log(CLI_FORMAT_RED, `       => received: ${formatValue(error.actual)}`);
        } else if (error.type === "variable") {
          const variableKey = (error.details as any).variableKey;

          console.log(CLI_FORMAT_RED, `    => ${section}.${variableKey}:`);
          console.log(CLI_FORMAT_RED, `       => expected: ${formatValue(error.expected)}`);
          console.log(CLI_FORMAT_RED, `       => received: ${formatValue(error.actual)}`);
        } else {
          if (error.type === "evaluation") {
            if (testResult.type === "variable") {
              section = `expectedEvaluation.${error.details?.evaluationKey}`;
              if (error.details?.childIndex !== undefined) {
                section = `Child ${error.details.childIndex + 1}, ${section}`;
              }
            } else if (error.details && error.details.variableKey) {
              section = `${section}.variables.${error.details.variableKey}.${error.details.evaluationKey}`;
            } else if (error.details && error.details.evaluationType) {
              section = `${section}.${error.details.evaluationType}.${error.details.evaluationKey}`;
            }
          }

          console.log(
            CLI_FORMAT_RED,
            `    => ${section}: expected ${formatValue(error.expected)}, received ${formatValue(
              error.actual,
            )}`,
          );
        }
      });
      const rerun = report?.cases[assertionIndex]?.rerun;
      if (rerun) {
        const shell = process.platform === "win32" ? "powershell" : "posix";
        console.log(
          `    Rerun (${shell === "posix" ? "POSIX shell" : "PowerShell"}): ${formatRerun(rerun, shell)}`,
        );
      }
    }
  });
}
