import type { Condition } from "@featurevisor/types";

import type { Person } from "./engine";

/**
 * A Query report, as FQL describes it. Rows are features or global variables, or without FROM,
 * people, with columns read from anywhere.
 */
export type ReportSubject = "features" | "variables" | "people";
export type ReportLayout = "table" | "matrix";

/**
 * An attribute the rows vary by. No values means the values the rows' conditions compare, plus
 * any other. The attribute `*` means every attribute those conditions compare.
 */
export interface ReportVary {
  attribute: string;
  values: string[];
}

/** What a column of a people report reads, written as conditions read features and variables */
export type ColumnRead =
  | { kind: "attribute"; attribute: string }
  | { kind: "flag"; feature: string }
  | { kind: "variation"; feature: string }
  | { kind: "variable"; feature?: string; variable: string; path: Array<string | number> };

export interface ReportColumn {
  read: ColumnRead;
  /** The heading `AS` gives it */
  alias?: string;
}

export interface Report {
  of: ReportSubject;
  /** A people report's columns, in order */
  columns?: ReportColumn[];
  /** A filter over each row's columns, compiled as conditions are */
  where?: Condition | Condition[];
  /** Who outcomes are for. Without one, the report is about definitions. */
  person?: Person;
  vary: ReportVary[];
  environments: string[];
  show: string[];
  as: ReportLayout;
}

/** Outcome columns of a feature report. A feature's own variable is `variable:<key>`. */
export const FEATURE_COLUMNS = ["enabled", "variation", "rule", "reason"];
export const VARIABLE_COLUMNS = ["value", "override", "reason"];
export const DEFINITION_COLUMNS = ["description", "owner", "tags", "status"];

export const COLUMN_LABELS: Record<string, string> = {
  enabled: "Enabled",
  variation: "Variation",
  rule: "Rule",
  reason: "Reason",
  value: "Value",
  override: "Override",
  description: "Description",
  owner: "Owner",
  tags: "Tags",
  status: "Status",
};

export function columnLabel(column: string) {
  return column.startsWith("variable:") ? column.slice("variable:".length) : COLUMN_LABELS[column];
}

/** A path as conditions write it: `.currency`, `[0]`, or `['label.v2']` for keys with dots */
export function formatPath(path: Array<string | number>) {
  return path
    .map((key) =>
      typeof key === "number"
        ? `[${key}]`
        : /^[A-Za-z_][\w-]*$/.test(key)
          ? `.${key}`
          : `['${key.replace(/'/g, "\\'")}']`,
    )
    .join("");
}

/** The entity a read column belongs to, and what it reads from it */
export function columnHeading(column: ReportColumn): {
  text: string;
  entity?: { type: "feature" | "variable"; key: string };
  detail?: string;
} {
  const { read } = column;
  const heading =
    read.kind === "attribute"
      ? { text: read.attribute }
      : read.kind === "flag"
        ? { entity: { type: "feature" as const, key: read.feature }, detail: "enabled" }
        : read.kind === "variation"
          ? { entity: { type: "feature" as const, key: read.feature }, detail: "variation" }
          : read.feature
            ? {
                entity: { type: "feature" as const, key: read.feature },
                detail: `${read.variable}${formatPath(read.path)}`,
              }
            : {
                entity: { type: "variable" as const, key: read.variable },
                detail: read.path.length ? formatPath(read.path).replace(/^\./, "") : "value",
              };
  const text =
    column.alias ?? ("text" in heading ? heading.text : `${heading.entity.key} ${heading.detail}`);
  return { ...heading, text };
}

export interface ReportPerson {
  /** The values this row varies, by attribute */
  values: Record<string, string>;
  label: string;
  person: Person;
}

/** The people a report evaluates for: the person, or one per combination of the values varied */
export function peopleOf(person: Person | undefined, vary: ReportVary[]): ReportPerson[] {
  if (!person) return [];
  let rows: ReportPerson[] = [{ values: {}, label: "Person", person }];
  for (const { attribute, values } of vary) {
    if (values.length === 0) continue;
    rows = rows.flatMap((row) =>
      values.map((value) => {
        const varied = { ...row.values, [attribute]: value };
        return {
          values: varied,
          label: Object.values(varied).join(" · "),
          person: { ...row.person, [attribute]: value },
        };
      }),
    );
  }
  return rows;
}

/** The FQL a feature's or global variable's "Who gets this?" link opens */
export function whoGetsThisQuery(
  type: "feature" | "variable",
  key: string,
  environments: string[],
) {
  return [
    `FROM ${type === "feature" ? "features" : "variables"}`,
    `WHERE key == '${key.replace(/'/g, "\\'")}'`,
    "FOR {}",
    "VARY *",
    ...(environments.length ? [`ENVIRONMENT ${environments.join(", ")}`] : []),
    `SELECT ${type === "feature" ? "enabled" : "value"}`,
    "AS MATRIX",
  ].join("\n");
}
