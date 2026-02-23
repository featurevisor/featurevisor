import { ZodError } from "zod";

import { CLI_FORMAT_RED } from "../tester/cliFormat";

export interface LintIssueFromZod {
  message: string;
  path: (string | number)[];
  code?: string;
  value?: unknown;
}

export function getLintIssuesFromZodError(e: ZodError): LintIssueFromZod[] {
  return e.issues
    .map((issue) => {
      if (
        issue.code === "invalid_union" &&
        issue.path.length === 0 &&
        issue.unionErrors.length > 0
      ) {
        const lastUnionError = issue.unionErrors[issue.unionErrors.length - 1];
        const nestedIssue = lastUnionError.issues[0];

        return {
          message: nestedIssue.message,
          path: nestedIssue.path,
          code: nestedIssue.code,
          value: (nestedIssue as any).received,
        };
      }

      return {
        message: issue.message,
        path: issue.path,
        code: issue.code,
        value: (issue as any).received,
      };
    })
    .filter(Boolean);
}

export function printZodError(e: ZodError) {
  const issues = getLintIssuesFromZodError(e);
  issues.forEach((issue) => {
    console.error(CLI_FORMAT_RED, `  => Error: ${issue.message}`);
    console.error("     Path:", issue.path.join("."));
    if (typeof issue.value !== "undefined" && issue.value !== "undefined") {
      console.error("     Value:", issue.value);
    }
    console.error("");
  });
}
