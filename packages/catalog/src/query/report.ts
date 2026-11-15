import type { Condition } from "@featurevisor/types";

import type { Person } from "./engine";

/** A Query report, as FQL describes it */
export type ReportSubject = "features" | "variables";
export type ReportLayout = "table" | "matrix";

/**
 * An attribute the rows vary by. No values means the values the rows' conditions compare, plus
 * any other. The attribute `*` means every attribute those conditions compare.
 */
export interface ReportVary {
  attribute: string;
  values: string[];
}

export interface Report {
  of: ReportSubject;
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
