import { ZodError, ZodIssue } from "zod";

import { CLI_FORMAT_RED } from "../tester/cliFormat";

export interface LintIssueFromZod {
  message: string;
  path: (string | number)[];
  code?: string;
  value?: unknown;
}

function normalizePath(path: PropertyKey[]): (string | number)[] {
  return path.map((segment) => (typeof segment === "symbol" ? String(segment) : segment));
}

function getInvalidUnionIssue(issue: ZodIssue): ZodIssue | undefined {
  if (issue.code !== "invalid_union" || issue.path.length > 0) {
    return undefined;
  }

  const unionErrors = (issue as any).unionErrors as ZodError[] | undefined;
  if (Array.isArray(unionErrors) && unionErrors.length > 0) {
    return unionErrors[unionErrors.length - 1].issues[0];
  }

  const errors = (issue as any).errors as ZodIssue[][] | undefined;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors[errors.length - 1][0];
  }

  return undefined;
}

export function getLintIssuesFromZodError(e: ZodError): LintIssueFromZod[] {
  return e.issues
    .map((issue) => {
      const nestedIssue = getInvalidUnionIssue(issue);

      if (nestedIssue) {
        return {
          message: nestedIssue.message,
          path: normalizePath(nestedIssue.path),
          code: nestedIssue.code,
          value: (nestedIssue as any).received,
        };
      }

      return {
        message: issue.message,
        path: normalizePath(issue.path),
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
