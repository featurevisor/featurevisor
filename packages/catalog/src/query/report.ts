import type { Condition } from "@featurevisor/types";

import {
  getDeadlineStatus,
  getMostPressingDeadline,
  getSummaryDeadlines,
  splitMetadataTerm,
  type DeadlineClock,
} from "../metadata";
import type { EntitySummary } from "../types";

import { ANY_OTHER, formatValue, type Person } from "./engine";

/**
 * A Query report, as FQL describes it. Rows are definitions, features, global variables,
 * segments or attributes, or without FROM, people. Columns are the row's own properties, or
 * reads of what someone gets, written as conditions read features and variables.
 */

export type Subject = "feature" | "variable" | "segment" | "attribute";

/** What FROM names, and the subject each name means */
export const SUBJECTS: Record<string, Subject> = {
  features: "feature",
  variables: "variable",
  segments: "segment",
  attributes: "attribute",
};

export type ReportLayout = "table" | "matrix";

/**
 * An attribute the rows vary by. No values means the values the rows' conditions compare, plus
 * any other. The attribute `*` means every attribute those conditions compare.
 */
export interface ReportVary {
  attribute: string;
  /** As written, so numbers and true or false stay what conditions compare */
  values: unknown[];
  /**
   * People written out, each a combination of attributes, such as `{ country: 'nl', city:
   * 'amsterdam' }`, or `OTHER` for everyone else. Only these combinations are evaluated, where
   * varying each attribute would cross every value with every other. Its attribute is "".
   */
  people?: Array<Record<string, unknown> | typeof ANY_OTHER>;
}

/** The attributes a VARY sets: its own, or every key its people name, in the order they appear */
export function varyAttributes(vary: ReportVary): string[] {
  if (!vary.people) return [vary.attribute];
  const keys = new Set<string>();
  for (const person of vary.people) {
    if (person !== ANY_OTHER) Object.keys(person).forEach((key) => keys.add(key));
  }
  return [...keys];
}

/** `key` written bare inside a read, as in `feature(key)`: the row's own key */
export const ROW_KEY = { row: true } as const;
export type ReadKey = string | typeof ROW_KEY;

export type Path = Array<string | number>;

/** What someone gets: a read, in an environment of its own when one is named */
export type Read =
  | { kind: "flag"; feature: ReadKey; environment?: string }
  | { kind: "variation"; feature: ReadKey; environment?: string }
  | { kind: "variable"; feature: ReadKey; variable: string; path: Path; environment?: string }
  | { kind: "global"; variable: ReadKey; path: Path; environment?: string };

/** What an evaluation says beside its answer */
export type Detail = "rollout" | "rule" | "reason" | "override";

export const DETAILS: Record<Detail, string> = {
  rollout: "the share it is on for, from 0 to 100",
  rule: "the rule that matched",
  reason: "why it evaluated as it did",
  override: "the variable override that matched",
};

export type Expr =
  | { kind: "property"; name: string }
  | { kind: "read"; read: Read }
  | { kind: "detail"; detail: Detail; read: Read }
  | { kind: "count" };

export interface ReportColumn {
  expr: Expr;
  /** The heading `AS` gives it */
  alias?: string;
}

export interface ReportSort {
  column: ReportColumn;
  descending: boolean;
}

export interface ReportWhere {
  conditions: Condition | Condition[];
  /** The reads it compares, by the name that stands in for each in `conditions` */
  reads: Record<string, Expr>;
  /** Every name it compares, to tell whether it can filter rows before anyone is evaluated */
  names: string[];
}

export interface Report {
  /** What each row is about. None means a row per person. */
  subjects: Subject[];
  where?: ReportWhere;
  /** Who outcomes are for, set whenever the report reads what someone gets */
  person?: Person;
  vary: ReportVary[];
  environments: string[];
  columns: ReportColumn[];
  group: ReportColumn[];
  sort: ReportSort[];
  limit?: number;
  as: ReportLayout;
  /** What a matrix puts across the top: environments, or with `BY PERSON`, each person */
  across?: "environment" | "person";
}

/** Whether a report reads what someone gets, so it needs datafiles and people */
export function evaluates(report: Report) {
  return report.person !== undefined;
}

/** Every read an expression makes */
export function readOf(expr: Expr): Read | undefined {
  return expr.kind === "read" || expr.kind === "detail" ? expr.read : undefined;
}

/** A path as conditions write it: `.currency`, `[0]`, or `['label.v2']` for keys with dots */
export function formatPath(path: Path) {
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

const quote = (text: string) => `'${text.replace(/'/g, "\\'")}'`;
const keyText = (key: ReadKey) => (typeof key === "string" ? quote(key) : "key");

export function readText(read: Read): string {
  const environment = read.environment ? `, ${quote(read.environment)}` : "";
  if (read.kind === "global")
    return `variable(${keyText(read.variable)}${environment})${formatPath(read.path)}`;
  const call = `feature(${keyText(read.feature)}${environment})`;
  if (read.kind === "flag") return call;
  if (read.kind === "variation") return `${call}.variation`;
  return `${call}${formatPath([read.variable, ...read.path])}`;
}

/** An expression as FQL writes it, the same however it was spaced, for matching SORT and GROUP */
export function exprText(expr: Expr): string {
  if (expr.kind === "property") return expr.name;
  if (expr.kind === "count") return "count()";
  if (expr.kind === "read") return readText(expr.read);
  return `${expr.detail}(${readText(expr.read)})`;
}

/** What a column's heading shows: a name, or a linked key and what is read from it */
export interface Heading {
  text: string;
  entity?: { type: "feature" | "variable"; key: string };
  detail?: string;
}

function readHeading(read: Read): Omit<Heading, "text"> & { words: string } {
  const where = read.environment ? ` in ${read.environment}` : "";
  const detail =
    read.kind === "flag"
      ? "enabled"
      : read.kind === "variation"
        ? "variation"
        : read.kind === "variable"
          ? `${read.variable}${formatPath(read.path)}`
          : read.path.length
            ? formatPath(read.path).replace(/^\./, "")
            : "value";
  const key = read.kind === "global" ? read.variable : read.feature;
  if (typeof key !== "string") return { words: `${detail}${where}` };
  return {
    entity: { type: read.kind === "global" ? "variable" : "feature", key },
    detail: `${detail}${where}`,
    words: `${key} ${detail}${where}`,
  };
}

export function columnHeading(column: ReportColumn): Heading {
  const { expr } = column;
  if (expr.kind === "property") return { text: column.alias ?? expr.name };
  if (expr.kind === "count") return { text: column.alias ?? "count" };
  const { words, ...heading } = readHeading(expr.read);
  if (expr.kind === "read") return { ...heading, text: column.alias ?? words };
  // A flag's rule or a whole global variable's override is the read's own, so it needs no "of"
  const { read } = expr;
  const plain = read.kind === "flag" || (read.kind === "global" && read.path.length === 0);
  const where = read.environment ? ` in ${read.environment}` : "";
  const what = plain ? `${expr.detail}${where}` : `${expr.detail} of ${heading.detail ?? words}`;
  return {
    ...heading,
    detail: heading.entity && what,
    text: column.alias ?? (heading.entity ? `${heading.entity.key} ${what}` : what),
  };
}

export interface ReportPerson {
  /** The values this row varies, by attribute */
  values: Record<string, unknown>;
  label: string;
  person: Person;
}

/** The people a report evaluates for: the person, or one per combination of the values varied */
export function peopleOf(person: Person | undefined, vary: ReportVary[]): ReportPerson[] {
  if (!person) return [];
  let rows: ReportPerson[] = [{ values: {}, label: "Person", person }];
  for (const item of vary) {
    const { attribute, values } = item;
    if (item.people) {
      // Each person written out, and OTHER as everyone the others do not name
      const keys = varyAttributes(item);
      rows = rows.flatMap((row) =>
        item.people!.map((entry) => {
          const own =
            entry === ANY_OTHER ? Object.fromEntries(keys.map((key) => [key, ANY_OTHER])) : entry;
          const varied = { ...row.values, ...own };
          // OTHER reads once, rather than once for every key the others name
          const part =
            entry === ANY_OTHER ? ANY_OTHER : Object.values(own).map(formatValue).join(" · ");
          return {
            values: varied,
            label: row.label === "Person" ? part : `${row.label} · ${part}`,
            person: { ...row.person, ...own },
          };
        }),
      );
      continue;
    }
    if (values.length === 0) continue;
    rows = rows.flatMap((row) =>
      values.map((value) => {
        const varied = { ...row.values, [attribute]: value };
        return {
          values: varied,
          label: Object.values(varied).map(formatValue).join(" · "),
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
    `WHERE key == ${quote(key)}`,
    "VARY *",
    ...(environments.length ? [`ENVIRONMENT ${environments.join(", ")}`] : []),
    `SELECT ${type === "feature" ? "feature(key)" : "variable(key)"}`,
    "AS MATRIX",
  ].join("\n");
}

export type PropertyType = "text" | "list" | "boolean" | "number" | "date";

export interface Property {
  type: PropertyType;
  about: string;
  subjects: Subject[];
  get: (entity: EntitySummary, row: { subject: Subject; clock: DeadlineClock }) => unknown;
  /** The order SORT puts its words in, when they have one */
  order?: string[];
}

const ALL: Subject[] = ["feature", "variable", "segment", "attribute"];
const DEFINED: Subject[] = ["feature", "variable", "segment"];

/** The keys an entity refers to of one type, from its `type:key` references */
const references = (entity: EntitySummary, type: string) =>
  (entity.references || [])
    .filter((reference) => reference.startsWith(`${type}:`))
    .map((reference) => reference.slice(type.length + 1));

const pressing = (entity: EntitySummary, clock: DeadlineClock) =>
  getMostPressingDeadline(getSummaryDeadlines(entity), clock);

/** Every property a row has, by subject, for SELECT, WHERE, GROUP BY and SORT */
export const PROPERTIES: Record<string, Property> = {
  key: { type: "text", about: "its key", subjects: ALL, get: (entity) => entity.key },
  kind: {
    type: "text",
    about: "feature, variable, segment or attribute",
    subjects: ALL,
    get: (_, row) => row.subject,
    order: ["feature", "variable", "segment", "attribute"],
  },
  description: {
    type: "text",
    about: "its description",
    subjects: ALL,
    get: (entity) => entity.description,
  },
  tags: { type: "list", about: "its tags", subjects: ALL, get: (entity) => entity.tags || [] },
  owner: {
    type: "text",
    about: "its first owner",
    subjects: ALL,
    get: (entity) => entity.owners?.[0],
  },
  owners: {
    type: "list",
    about: "its owners",
    subjects: ALL,
    get: (entity) => entity.owners || [],
  },
  archived: {
    type: "boolean",
    about: "whether it is archived",
    subjects: ALL,
    get: (entity) => entity.archived === true,
  },
  deprecated: {
    type: "boolean",
    about: "whether it is deprecated",
    subjects: ALL,
    get: (entity) => entity.deprecated === true,
  },
  status: {
    type: "text",
    about: "production, other or disabled, as the list shows",
    subjects: ["feature"],
    get: (entity) => entity.environmentStatus,
    order: ["production", "enabled", "other", "disabled"],
  },
  environments: {
    type: "list",
    about: "environments it has rules or overrides in",
    subjects: ["feature", "variable"],
    get: (entity) => entity.environments || [],
  },
  bucketBy: {
    type: "text",
    about: "what its rollouts bucket by",
    subjects: ["feature"],
    get: (entity) => entity.bucketBy,
  },
  variations: {
    type: "list",
    about: "its variations",
    subjects: ["feature"],
    get: (entity) => entity.variationValues || [],
  },
  variables: {
    type: "list",
    about: "its own variables",
    subjects: ["feature"],
    get: (entity) => entity.variableKeys || [],
  },
  type: {
    type: "text",
    about: "a variable's or attribute's type",
    subjects: ["variable", "attribute"],
    get: (entity) => entity.variableType ?? entity.attributeType,
  },
  format: {
    type: "text",
    about: "an attribute's format, such as date-time",
    subjects: ["attribute"],
    get: (entity) => entity.attributeFormat,
  },
  composed: {
    type: "boolean",
    about: "whether a variable is composed of others",
    subjects: ["variable"],
    get: (entity) => entity.isComposed === true,
  },
  segments: {
    type: "list",
    about: "segments it uses directly",
    subjects: DEFINED,
    get: (entity) => references(entity, "segment"),
  },
  attributes: {
    type: "list",
    about: "attributes it compares, and buckets by",
    subjects: DEFINED,
    get: (entity) => references(entity, "attribute"),
  },
  requires: {
    type: "list",
    about: "features its conditions read",
    subjects: DEFINED,
    get: (entity) => references(entity, "feature"),
  },
  usedBy: {
    type: "number",
    about: "how many features and variables depend on it",
    subjects: ALL,
    get: (entity, row) =>
      row.subject === "feature" || row.subject === "variable"
        ? (entity.usedInFeatureCount || 0) + (entity.usedInVariableCount || 0)
        : entity.usedByCount || 0,
  },
  usesDeprecated: {
    type: "boolean",
    about: "whether it depends on a deprecated feature",
    subjects: DEFINED,
    get: (entity) => entity.dependsOnDeprecated === true,
  },
  differs: {
    type: "boolean",
    about: "whether its rules differ between environments",
    subjects: ["feature"],
    get: (entity) => entity.environmentsDiffer === true,
  },
  promotable: {
    type: "boolean",
    about: "whether it can be promoted between environments",
    subjects: ["feature"],
    get: (entity) => entity.promotable === true,
  },
  targets: {
    type: "list",
    about: "Targets it is in",
    subjects: ALL,
    get: (entity) => entity.targets || [],
  },
  tested: {
    type: "boolean",
    about: "whether tests cover it",
    subjects: DEFINED,
    get: (entity) => entity.hasTests === true,
  },
  testsPass: {
    type: "boolean",
    about: "whether its tests passed in the last report",
    subjects: DEFINED,
    get: (entity) => entity.testPassed,
  },
  deadline: {
    type: "date",
    about: "when its most pressing open deadline is due",
    subjects: ALL,
    get: (entity, row) => pressing(entity, row.clock)?.deadline.by,
  },
  deadlineType: {
    type: "text",
    about: "what its most pressing deadline is for",
    subjects: ALL,
    get: (entity, row) => pressing(entity, row.clock)?.deadline.type,
  },
  deadlineStatus: {
    type: "text",
    about: "overdue, today, upcoming, later or done",
    subjects: ALL,
    get: (entity, row) => {
      const found = pressing(entity, row.clock);
      if (found) return found.status;
      const deadlines = getSummaryDeadlines(entity);
      return deadlines.length &&
        deadlines.every((deadline) => getDeadlineStatus(deadline, row.clock) === "done")
        ? "done"
        : undefined;
    },
    order: ["overdue", "today", "upcoming", "later", "done"],
  },
  updated: {
    type: "date",
    about: "when it last changed",
    subjects: ALL,
    get: (entity) => entity.lastModified?.timestamp,
  },
  updatedBy: {
    type: "text",
    about: "who last changed it",
    subjects: ALL,
    get: (entity) => entity.lastModified?.author,
  },
};

/** Its metadata as an object, so `metadata.jira` and `metadata.links.design` read it */
export function metadataOf(entity: EntitySummary): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const term of entity.metadataTerms || []) {
    const { path, value } = splitMetadataTerm(term);
    const keys = path.split(".");
    let target = metadata;
    keys.slice(0, -1).forEach((key) => {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key]))
        target[key] = {};
      target = target[key] as Record<string, unknown>;
    });
    const last = keys[keys.length - 1];
    const existing = target[last];
    // A key that appears more than once holds a list
    target[last] =
      existing === undefined
        ? value
        : Array.isArray(existing)
          ? [...existing, value]
          : [existing, value];
  }
  return metadata;
}

/** A property by name, including `metadata.<path>` */
export function propertyOf(name: string): Property | undefined {
  if (Object.prototype.hasOwnProperty.call(PROPERTIES, name)) return PROPERTIES[name];
  if (!name.startsWith("metadata.") || name.length <= "metadata.".length) return undefined;
  const path = name.slice("metadata.".length).split(".");
  return {
    type: "text",
    about: "a value from its metadata",
    subjects: ALL,
    get: (entity) =>
      path.reduce<unknown>(
        (value, key) =>
          value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)[key]
            : undefined,
        metadataOf(entity),
      ),
  };
}

/** A row's properties as a context, for WHERE to match as conditions match */
export function rowContext(entity: EntitySummary, subject: Subject, clock: DeadlineClock) {
  const context: Record<string, unknown> = { metadata: metadataOf(entity) };
  for (const [name, property] of Object.entries(PROPERTIES)) {
    if (property.subjects.includes(subject))
      context[name] = property.get(entity, { subject, clock });
  }
  return context;
}
