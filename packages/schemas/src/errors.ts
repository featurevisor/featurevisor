import { flattenIssues, type FlattenedIssues } from "./flatten.js";
import type { SchemaIssue, SchemaResult, SchemaSuccess } from "./types.js";

/**
 * Thrown by `parse` when a value fails, with the issues found. Like the
 * `SchemaError` of `@standard-schema/utils`, it carries `issues`.
 */
export class SchemaError extends Error {
  /** The key of the schema validated, such as `signUp`. */
  readonly schema: string;
  readonly issues: ReadonlyArray<SchemaIssue>;

  constructor(schema: string, issues: ReadonlyArray<SchemaIssue>) {
    const count = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
    super(`${schema}: ${count}. ${issues[0] ? issues[0].message : ""}`.trim());
    this.name = "SchemaError";
    this.schema = schema;
    this.issues = issues;
  }

  /** The issues by field, as `flattenIssues` groups them, for an error response. */
  get flattened(): FlattenedIssues {
    return flattenIssues(this.issues);
  }
}

/** A result's value, or a thrown `SchemaError`. */
export function valueOf<T>(schema: string, result: SchemaResult<T>): T {
  if (result.issues) throw new SchemaError(schema, result.issues);
  return (result as SchemaSuccess<T>).value;
}
