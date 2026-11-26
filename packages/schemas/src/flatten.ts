import { formatPath } from "./paths.js";
import type { SchemaIssue } from "./types.js";

export interface FlattenedIssues {
  /** Messages about the value as a whole. */
  formErrors: string[];
  /** Messages by field name with dots, such as `displayName` or `items.0.name`. */
  fieldErrors: Record<string, string[]>;
}

/**
 * Groups issues' messages by field, for showing them next to inputs without a
 * form library. The shape is Zod's `flattenError`'s.
 */
export function flattenIssues(issues: ReadonlyArray<SchemaIssue>): FlattenedIssues {
  const flattened: FlattenedIssues = { formErrors: [], fieldErrors: {} };
  for (const issue of issues) {
    if (issue.path.length === 0) {
      flattened.formErrors.push(issue.message);
      continue;
    }
    const field = formatPath(issue.path);
    (flattened.fieldErrors[field] ||= []).push(issue.message);
  }
  return flattened;
}
