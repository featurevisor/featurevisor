import { ZodError, ZodIssue } from "zod";

import { CLI_FORMAT_RED } from "../tester/cliFormat";

export interface LintIssueFromZod {
  message: string;
  path: (string | number)[];
  code?: string;
  value?: unknown;
  /** The issue is about a key that names no definition. */
  unknownReference?: boolean;
}

function normalizePath(path: PropertyKey[]): (string | number)[] {
  return path.map((segment) => (typeof segment === "symbol" ? String(segment) : segment));
}

function expandUnionIssue(issue: ZodIssue): ZodIssue[] {
  if (issue.code !== "invalid_union" || issue.message !== "Invalid input") return [issue];

  // Only select a branch when the input shape rules out every alternative.
  // Never choose a branch merely because it contains fewer validation errors.
  const candidates = issue.errors
    .map((branch) => branch.flatMap(expandUnionIssue))
    .filter(
      (branch) =>
        !branch.some((item) => {
          if (
            item.path.length === 0 &&
            ["invalid_type", "invalid_value", "invalid_union"].includes(item.code)
          )
            return true;
          const field = item.path[0];
          const input = (issue as { input?: unknown }).input;
          if (
            item.code !== "invalid_type" ||
            (item as { input?: unknown }).input !== undefined ||
            item.path.length !== 1
          )
            return false;
          const hasField = (key: string) =>
            !!input &&
            typeof input === "object" &&
            Object.prototype.hasOwnProperty.call(input, key);
          if (["and", "or", "not"].includes(String(field))) {
            return (
              !hasField(String(field)) &&
              ["attribute", "operator", "and", "or", "not"].some(hasField)
            );
          }
          return (
            field === "attribute" && !hasField("attribute") && ["and", "or", "not"].some(hasField)
          );
        }),
    );
  return candidates.length === 1
    ? candidates[0].map((item) => ({ ...item, path: [...issue.path, ...item.path] }))
    : [issue];
}

type CodedIssue = { params?: { code?: string; unknownReference?: boolean } };

export function getLintIssuesFromZodError(e: ZodError): LintIssueFromZod[] {
  return e.issues
    .flatMap(expandUnionIssue)
    .map((issue) => {
      return {
        message: issue.message,
        path: normalizePath(issue.path),
        // Custom checks can name a stable code for machine readable output.
        code: (issue as CodedIssue).params?.code ?? issue.code,
        value: (issue as any).received,
        ...((issue as CodedIssue).params?.unknownReference ? { unknownReference: true } : {}),
      };
    })
    .filter(Boolean);
}

export function printZodError(e: ZodError) {
  printLintIssues(getLintIssuesFromZodError(e));
}

export function printLintIssues(issues: LintIssueFromZod[]) {
  issues.forEach((issue) => {
    console.error(CLI_FORMAT_RED, `  => Error: ${issue.message}`);
    console.error("     Path:", issue.path.join(".") || "(root)");
    if (typeof issue.value !== "undefined" && issue.value !== "undefined") {
      console.error("     Value:", issue.value);
    }
    console.error("");
  });
}
