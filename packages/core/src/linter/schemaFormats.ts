import type { Schema, SchemaFormat } from "@featurevisor/types";
import { z } from "zod";
import { getPortableTimestamp, isValidVersion } from "@featurevisor/sdk";

/** Types shared by attributes, reusable schemas and variables, in authoring order. */
export const SCHEMA_TYPES = ["boolean", "string", "integer", "number", "object", "array"] as const;

/** Semantic string formats. Each one drives operator rules, so unknown formats are errors. */
export const SCHEMA_FORMATS: readonly SchemaFormat[] = ["date-time", "semver"];

/** Earlier types, accepted only to report how to migrate them. */
export const REMOVED_SCHEMA_TYPES: Record<string, string> = {
  double: "Replace `type: double` with `type: number`.",
  date: "Replace `type: date` with `type: string` and `format: date-time`.",
  semver: "Replace `type: semver` with `type: string` and `format: semver`.",
};

export function isRemovedSchemaType(type: unknown): type is keyof typeof REMOVED_SCHEMA_TYPES {
  return (
    typeof type === "string" && Object.prototype.hasOwnProperty.call(REMOVED_SCHEMA_TYPES, type)
  );
}

/** Type enum that still recognizes removed types so they can report a precise migration. */
export function schemaTypeZodSchema<T extends string = (typeof SCHEMA_TYPES)[number]>(
  extra: readonly string[] = [],
): z.ZodType<T> {
  // Removed types parse here only so refineRemovedSchemaType can explain the migration.
  return z.enum([...SCHEMA_TYPES, ...extra, ...Object.keys(REMOVED_SCHEMA_TYPES)] as [
    string,
    ...string[],
  ]) as unknown as z.ZodType<T>;
}

export const schemaFormatZodSchema = z.enum(SCHEMA_FORMATS as [SchemaFormat, ...SchemaFormat[]], {
  error: (issue) =>
    issue.input === "date"
      ? 'Unsupported format "date". Use `format: date-time`, a timestamp with a timezone.'
      : `Unsupported format "${String(issue.input)}". Featurevisor supports format: ${SCHEMA_FORMATS.join(" and ")}.`,
});

/** Report a removed type at this node only. Nested schemas run their own refinement. */
export function refineRemovedSchemaType(
  schema: { type?: unknown } | undefined,
  ctx: z.RefinementCtx,
): void {
  if (!schema || typeof schema !== "object" || !isRemovedSchemaType(schema.type)) return;
  ctx.addIssue({
    code: "custom",
    path: ["type"],
    message: REMOVED_SCHEMA_TYPES[schema.type],
    params: { code: "removed_schema_type" },
  });
}

/** Whether a literal satisfies a format. Callers check the string type separately. */
export function valueMatchesFormat(format: unknown, value: unknown): boolean {
  if (format === "date-time")
    return typeof value === "string" && getPortableTimestamp(value) !== null;
  if (format === "semver") return isValidVersion(value);
  return true;
}

export function formatValueMessage(format: unknown): string {
  return format === "semver"
    ? "Value is not a version the version operators can compare, such as 5.5.0, 5.5 or v5.5.0."
    : "Value is not a valid portable timestamp for format: date-time. Use YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm.";
}

/**
 * What a schema node means for condition operators: its type, refined by format.
 * A date-time string is "date-time" and a version string is "semver".
 */
export type SchemaKind =
  | "boolean"
  | "string"
  | "integer"
  | "number"
  | "object"
  | "array"
  | "date-time"
  | "semver"
  | "json";

export function getSchemaKind(schema: {
  type?: unknown;
  format?: unknown;
}): SchemaKind | undefined {
  if (schema.type === "string" && schema.format === "date-time") return "date-time";
  if (schema.type === "string" && schema.format === "semver") return "semver";
  return typeof schema.type === "string" ? (schema.type as SchemaKind) : undefined;
}

export type SchemaNodeLike = Partial<Schema> & { type?: unknown; format?: unknown };
