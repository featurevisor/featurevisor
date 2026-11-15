import { allConditionsAreMatched } from "@featurevisor/sdk";
import type { BucketBy, DatafileContent } from "@featurevisor/types";

import { getDeadlineTimestamp, type DeadlineClock } from "../metadata";
import type { CatalogIndex, EntitySummary } from "../types";

import {
  ANY_OTHER,
  featureVariableCell,
  flagCell,
  formatValue,
  getComparedValues,
  globalVariableCell,
  lensOf,
  rolloutOf,
  variationCell,
  type Cell,
  type Lens,
} from "./engine";
import {
  columnHeading,
  exprText,
  peopleOf,
  propertyOf,
  readOf,
  rowContext,
  type Detail,
  type Expr,
  type Heading,
  type PropertyType,
  type Read,
  type Report,
  type ReportColumn,
  type ReportPerson,
  type ReportVary,
  type Subject,
} from "./report";

/**
 * Runs a Query report: picks its rows, evaluates what they read with the SDK against the
 * export's datafiles, filters, groups, sorts and limits them. Pure, so the page only draws.
 */

/** Evaluations a report may run before it asks for a narrower one */
export const EVALUATION_LIMIT = 20000;

/** Rows `VARY *` grows into at most, so a matrix stays readable */
const AUTOMATIC_ROWS = 48;

export interface ResultValue {
  text: string;
  /** The value itself, for comparing and sorting */
  raw: unknown;
  /** A read's evaluation, for its badge and the Why panel */
  cell?: Cell;
  /** A list property's items */
  list?: string[];
  /** The key column links to its entity */
  link?: { type: Subject; key: string };
  type?: PropertyType;
  /** How a grouped answer shows, without the evaluation behind it */
  tone?: Cell["tone"];
  /** What an evaluation says beside its answer, shown as itself rather than as the answer */
  detail?: Detail;
}

export interface ResultColumn {
  column: ReportColumn;
  heading: Heading;
  /** In a matrix, a value per environment */
  byEnvironment: boolean;
  /** The report added it, so every row says what it is about */
  automatic?: boolean;
}

export interface ResultRow {
  id: string;
  entity?: { subject: Subject; summary: EntitySummary };
  person?: ReportPerson;
  environment?: string | null;
  /** One per column, or one per environment for a matrix column */
  values: Array<ResultValue | ResultValue[]>;
  /** What the row is, for the Why panel's title */
  title: string;
}

export interface Result {
  columns: ResultColumn[];
  rows: ResultRow[];
  /** A matrix's environments, across the top */
  environments: Array<string | null>;
  matrix: boolean;
  /** Rows before LIMIT */
  total: number;
  evaluations: number;
  /** More evaluations than the page runs at once, so no rows */
  tooMany?: number;
  lenses: Set<Lens | "exact">;
  people: number;
}

export interface RunInput {
  report: Report;
  index: CatalogIndex;
  /** By environment, or by null in a project without environments */
  datafiles?: Map<string | null, DatafileContent>;
  hasEnvironments: boolean;
  clock: DeadlineClock;
}

/** The environments a report evaluates in: its own, and any a read names */
export function datafileEnvironments(
  report: Report,
  hasEnvironments: boolean,
): Array<string | null> {
  if (!hasEnvironments) return [null];
  const named = [
    ...report.columns,
    ...report.group,
    ...report.sort.map((sort) => sort.column),
    ...Object.values(report.where?.reads || {}).map((expr) => ({ expr })),
  ]
    .map((column) => readOf(column.expr)?.environment)
    .filter((environment): environment is string => environment !== undefined);
  return [...new Set([...report.environments, ...named])];
}

/** Attributes the selected features bucket by, which split rollouts rather than audiences */
function bucketAttributes(datafiles: DatafileContent[], features: string[]) {
  const attributes = new Set<string>();
  const add = (bucketBy: BucketBy) =>
    typeof bucketBy === "string"
      ? attributes.add(bucketBy)
      : (Array.isArray(bucketBy) ? bucketBy : bucketBy.or).forEach((item) => attributes.add(item));
  for (const datafile of datafiles) {
    for (const key of features) {
      const feature = datafile.features?.[key];
      if (feature) add(feature.bucketBy);
    }
  }
  return attributes;
}

/**
 * The attributes and values rows vary by: written ones as written, an attribute alone with the
 * values its conditions compare plus any other, and `*` with every attribute they compare,
 * leaving out what rollouts bucket by and stopping before the rows grow past a screenful.
 */
function resolveVary(vary: ReportVary[], compared: Map<string, unknown[]>, bucketBy: Set<string>) {
  const resolved: ReportVary[] = [];
  const named = new Set(vary.map((item) => item.attribute));
  for (const item of vary) {
    if (item.attribute !== "*") {
      resolved.push({
        attribute: item.attribute,
        values: item.values.length
          ? item.values
          : [...(compared.get(item.attribute) || []), ANY_OTHER],
      });
      continue;
    }
    let rows = resolved.reduce((total, entry) => total * entry.values.length, 1);
    const automatic = [...compared.entries()]
      .filter(([attribute]) => !bucketBy.has(attribute) && !named.has(attribute))
      .sort(([left, a], [right, b]) => b.length - a.length || left.localeCompare(right));
    for (const [attribute, values] of automatic) {
      if (rows * (values.length + 1) > AUTOMATIC_ROWS) continue;
      rows *= values.length + 1;
      resolved.push({ attribute, values: [...values, ANY_OTHER] });
    }
  }
  return resolved;
}

const EMPTY: ResultValue = { text: "", raw: undefined };

function propertyValue(raw: unknown, type: PropertyType): ResultValue {
  if (type === "list") {
    const list = Array.isArray(raw) ? raw.map(String) : [];
    return { text: list.join(", "), raw: list, list, type };
  }
  if (raw === undefined || raw === null || raw === "") return { ...EMPTY, type };
  if (type === "boolean") return { text: raw ? "Yes" : "No", raw: Boolean(raw), type };
  if (type === "text" && Array.isArray(raw))
    return { text: raw.join(", "), raw, list: raw.map(String), type };
  return { text: String(raw), raw, type };
}

const percentText = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

interface RowPlace {
  entity?: { subject: Subject; summary: EntitySummary };
  person?: ReportPerson;
  environment: string | null;
}

/** Every distinct expression a report needs per row */
function neededExprs(report: Report, columns: ReportColumn[]) {
  const exprs = new Map<string, Expr>();
  const add = (expr: Expr) => {
    if (expr.kind !== "count") exprs.set(exprText(expr), expr);
  };
  columns.forEach((column) => add(column.expr));
  report.group.forEach((column) => add(column.expr));
  report.sort.forEach((sort) => add(sort.column.expr));
  Object.values(report.where?.reads || {}).forEach(add);
  return exprs;
}

export function runReport(input: RunInput): Result {
  const { report, index, datafiles, clock } = input;
  const evaluating = report.person !== undefined;
  const perPerson = report.subjects.length === 0;

  // Rows' entities, filtered first when WHERE compares their properties alone
  let entities: Array<RowPlace["entity"]> = perPerson
    ? [undefined]
    : report.subjects.flatMap((subject) =>
        (index.entities[subject] || []).map((summary) => ({ subject, summary })),
      );
  const where = report.where;
  const whereEarly =
    where &&
    !perPerson &&
    Object.keys(where.reads).length === 0 &&
    where.names.every((name) => propertyOf(name) !== undefined);
  if (where && whereEarly) {
    entities = entities.filter((entity) =>
      allConditionsAreMatched(
        where.conditions as never,
        rowContext(entity!.summary, entity!.subject, clock) as never,
      ),
    );
  }

  // Who the rows are for, and in which environments
  const loaded = datafiles ? [...datafiles.values()] : [];
  let vary = report.vary;
  if (evaluating && loaded.length) {
    const reads = [...neededExprs(report, report.columns).values()]
      .map(readOf)
      .filter(Boolean) as Read[];
    const literal = (kind: "feature" | "variable") =>
      reads.flatMap((read) => {
        const key = read.kind === "global" ? read.variable : read.feature;
        return (read.kind === "global") === (kind === "variable") && typeof key === "string"
          ? [key]
          : [];
      });
    const own = (subject: Subject) =>
      entities.flatMap((entity) => (entity?.subject === subject ? [entity.summary.key] : []));
    const features = [...new Set([...literal("feature"), ...own("feature")])];
    const variables = [...new Set([...literal("variable"), ...own("variable")])];
    vary = resolveVary(
      report.vary,
      getComparedValues(loaded, { features, variables }),
      bucketAttributes(loaded, features),
    );
  }
  const people: Array<ReportPerson | undefined> = evaluating
    ? peopleOf(report.person, vary)
    : [undefined];
  const environments: Array<string | null> = evaluating
    ? input.hasEnvironments
      ? report.environments
      : [null]
    : [null];
  const matrix = report.as === "matrix" && evaluating;
  const grouped =
    report.group.length > 0 || report.columns.some((column) => column.expr.kind === "count");

  // Columns: as written, after whatever says what each row is about
  const columns: ReportColumn[] = [];
  const automatic = new Set<ReportColumn>();
  const named = (name: string) =>
    report.columns.some((column) => column.expr.kind === "property" && column.expr.name === name);
  const addAutomatic = (column: ReportColumn) => {
    automatic.add(column);
    columns.push(column);
  };
  if (grouped) {
    if (evaluating && environments.length > 1 && !named("environment"))
      addAutomatic({ expr: { kind: "property", name: "environment" } });
  } else {
    if (!perPerson && !named("key")) addAutomatic({ expr: { kind: "property", name: "key" } });
    for (const item of vary) {
      if (!named(item.attribute))
        addAutomatic({ expr: { kind: "property", name: item.attribute } });
    }
    if (
      perPerson &&
      columns.length === 0 &&
      !report.columns.some((column) => column.expr.kind === "property")
    )
      addAutomatic({ expr: { kind: "property", name: "person" } });
    if (evaluating && !matrix && environments.length > 1 && !named("environment"))
      addAutomatic({ expr: { kind: "property", name: "environment" } });
  }
  columns.push(...report.columns);
  const groupColumns = grouped
    ? [...columns.filter((column) => automatic.has(column)), ...report.group]
    : [];

  const exprs = neededExprs(report, [...columns, ...groupColumns]);
  const readCount = [...exprs.values()].filter((expr) => readOf(expr)).length;
  const evaluations = entities.length * people.length * environments.length * readCount;
  const result = (rows: ResultRow[], total = rows.length, extra: Partial<Result> = {}): Result => ({
    columns: columns.map((column) => ({
      column,
      heading:
        automatic.has(column) && column.expr.kind === "property" && column.expr.name === "person"
          ? { text: "Person" }
          : columnHeading(column),
      byEnvironment:
        matrix &&
        readOf(column.expr) !== undefined &&
        readOf(column.expr)!.environment === undefined,
      automatic: automatic.has(column) || undefined,
    })),
    rows,
    environments: matrix ? environments : [],
    matrix,
    total,
    evaluations,
    lenses: new Set(),
    people: people.length,
    ...extra,
  });
  if (evaluations > EVALUATION_LIMIT) return result([], 0, { tooMany: evaluations });

  const lenses = new Set<Lens | "exact">();
  const valueOf = (expr: Expr, place: RowPlace): ResultValue => {
    const { entity, person } = place;
    if (expr.kind === "count") return EMPTY;
    if (expr.kind === "property") {
      const { name } = expr;
      if (name === "person" && person && !entity) return { text: person.label, raw: person.label };
      if (name === "environment" && evaluating)
        return { text: place.environment ?? "", raw: place.environment };
      if (entity) {
        const property = propertyOf(name);
        if (property && property.subjects.includes(entity.subject)) {
          const value = propertyValue(
            property.get(entity.summary, { subject: entity.subject, clock }),
            property.type,
          );
          return name === "key"
            ? { ...value, link: { type: entity.subject, key: entity.summary.key } }
            : value;
        }
        if (property) return EMPTY;
      }
      const attribute = person?.person[name];
      return attribute === undefined ? EMPTY : { text: formatValue(attribute), raw: attribute };
    }
    const read = expr.read;
    const environment = read.environment ?? place.environment;
    const datafile = datafiles?.get(input.hasEnvironments ? environment : null);
    if (!datafile || !person) return EMPTY;
    const global = read.kind === "global";
    const written = global ? read.variable : read.feature;
    const key =
      typeof written === "string"
        ? written
        : entity && entity.subject === (global ? "variable" : "feature")
          ? entity.summary.key
          : undefined;
    if (key === undefined) return EMPTY;
    if (global ? !datafile.variables?.[key] : !datafile.features?.[key]) return EMPTY;
    const who = person.person;
    const cell =
      read.kind === "flag"
        ? flagCell(datafile, key, who)
        : read.kind === "variation"
          ? variationCell(datafile, key, who)
          : read.kind === "variable"
            ? featureVariableCell(datafile, key, read.variable, who, read.path)
            : globalVariableCell(datafile, key, who, read.path);
    lenses.add(global ? "exact" : lensOf(datafile, key, who));
    if (expr.kind === "read") return { text: cell.text, raw: cell.value, cell };
    if (expr.detail === "rollout") {
      const share = rolloutOf(cell);
      return { text: percentText(share), raw: share, cell, detail: "rollout" };
    }
    const detail =
      expr.detail === "rule"
        ? (cell.why.ruleKey ?? (cell.why.forced ? "forced" : undefined))
        : expr.detail === "reason"
          ? cell.why.reason
          : cell.why.overrideKey;
    return { text: detail ?? "", raw: detail, cell, detail: expr.detail };
  };

  // A row per entity, person and environment, every needed expression evaluated once
  interface Evaluated extends RowPlace {
    values: Map<string, ResultValue>;
    kept: boolean;
  }
  const evaluated: Evaluated[] = [];
  for (const entity of entities) {
    for (const person of people) {
      for (const environment of environments) {
        const place: RowPlace = { entity, person, environment };
        const values = new Map<string, ResultValue>();
        for (const [text, expr] of exprs) values.set(text, valueOf(expr, place));
        let kept = true;
        if (where && !whereEarly) {
          const context: Record<string, unknown> = {
            ...(person?.person || {}),
            ...(entity ? rowContext(entity.summary, entity.subject, clock) : {}),
            environment,
          };
          for (const [name, expr] of Object.entries(where.reads))
            context[name] = values.get(exprText(expr))?.raw;
          kept = allConditionsAreMatched(where.conditions as never, context as never);
        }
        evaluated.push({ ...place, values, kept });
      }
    }
  }

  const describe = (place: RowPlace) =>
    [
      place.entity?.summary.key,
      place.person && place.person.label !== "Person" ? place.person.label : undefined,
      place.environment,
    ]
      .filter(Boolean)
      .join(" · ");
  const idOf = (place: RowPlace) =>
    [place.entity?.subject, place.entity?.summary.key, place.person?.label, place.environment].join(
      "\u0000",
    );

  let rows: Array<ResultRow & { sortValues: ResultValue[] }>;
  const sortValue = (values: Map<string, ResultValue>) =>
    report.sort.map((sort) => values.get(exprText(sort.column.expr)) ?? EMPTY);

  if (grouped) {
    // Rows gather by their group columns' text, a list once per item, and count
    const groups = new Map<string, { values: ResultValue[]; count: number }>();
    for (const row of evaluated.filter((item) => item.kept)) {
      let keys: ResultValue[][] = [[]];
      for (const column of groupColumns) {
        const value = row.values.get(exprText(column.expr)) ?? EMPTY;
        // A group shows an answer's tone, not one evaluation behind it, and a flag sorts by share
        const flag =
          value.cell && readOf(column.expr)?.kind === "flag" && column.expr.kind === "read";
        const items: ResultValue[] = value.list
          ? value.list.length
            ? value.list.map((item) => ({ text: item, raw: item }))
            : [EMPTY]
          : value.cell
            ? [
                {
                  text: value.text,
                  raw: flag ? rolloutOf(value.cell) : (value.raw ?? value.text),
                  // A detail is a name or a share, not the answer's on or off
                  tone: value.detail ? undefined : value.cell.tone,
                },
              ]
            : [value];
        keys = keys.flatMap((key) => items.map((item) => [...key, item]));
      }
      for (const key of keys) {
        const id = key.map((value) => value.text).join("\u0000");
        const group = groups.get(id) || { values: key, count: 0 };
        group.count++;
        groups.set(id, group);
      }
    }
    rows = [...groups.entries()].map(([id, group]) => {
      const byText = new Map(
        groupColumns.map((column, at) => [exprText(column.expr), group.values[at]]),
      );
      const valueOfColumn = (column: ReportColumn) =>
        column.expr.kind === "count"
          ? { text: String(group.count), raw: group.count, type: "number" as const }
          : (byText.get(exprText(column.expr)) ?? EMPTY);
      return {
        id,
        values: columns.map(valueOfColumn),
        title: group.values.map((value) => value.text || "none").join(" · "),
        sortValues: report.sort.map((sort) => valueOfColumn(sort.column)),
      };
    });
    if (!report.sort.length) {
      // Most first, a group without a value after those with one, then by name
      const count = columns.findIndex((column) => column.expr.kind === "count");
      const blank = (row: (typeof rows)[number]) =>
        row.values.some((value, at) => at !== count && isMissing(value as ResultValue)) ? 1 : 0;
      rows.sort(
        (a, b) =>
          (count >= 0
            ? ((b.values[count] as ResultValue).raw as number) -
              ((a.values[count] as ResultValue).raw as number)
            : 0) ||
          blank(a) - blank(b) ||
          a.title.localeCompare(b.title, undefined, { numeric: true }),
      );
    }
  } else if (matrix) {
    // Each entity and person a row, each read's environments across the top
    const byRow = new Map<string, Evaluated[]>();
    for (const row of evaluated) {
      const id = idOf({ ...row, environment: null });
      byRow.set(id, [...(byRow.get(id) || []), row]);
    }
    rows = [...byRow.entries()]
      .filter(([, group]) => group.some((row) => row.kept))
      .map(([id, group]) => {
        const first = group[0];
        return {
          id,
          entity: first.entity,
          person: first.person,
          values: columns.map((column) => {
            const text = exprText(column.expr);
            const byEnvironment =
              readOf(column.expr) && readOf(column.expr)!.environment === undefined;
            return byEnvironment
              ? group.map((row) => row.values.get(text) ?? EMPTY)
              : (first.values.get(text) ?? EMPTY);
          }),
          title: describe({ ...first, environment: null }),
          sortValues: sortValue(first.values),
        };
      });
  } else {
    rows = evaluated
      .filter((row) => row.kept)
      .map((row) => ({
        id: idOf(row),
        entity: row.entity,
        person: row.person,
        environment: evaluating ? row.environment : undefined,
        values: columns.map((column) => row.values.get(exprText(column.expr)) ?? EMPTY),
        title: describe(row),
        sortValues: sortValue(row.values),
      }));
  }

  if (report.sort.length) {
    const orders = report.sort.map((sort) =>
      sort.column.expr.kind === "property" ? propertyOf(sort.column.expr.name)?.order : undefined,
    );
    rows.sort((a, b) => {
      for (const [at, sort] of report.sort.entries()) {
        const order = compareValues(
          a.sortValues[at],
          b.sortValues[at],
          orders[at],
          sort.descending,
        );
        if (order !== 0) return order;
      }
      return 0;
    });
  }

  const total = rows.length;
  const limited = report.limit === undefined ? rows : rows.slice(0, report.limit);
  return result(
    limited.map(({ id, entity, person, environment, values, title }) => ({
      id,
      entity,
      person,
      environment,
      values,
      title,
    })),
    total,
    { lenses },
  );
}

/** Missing values sort last whichever way, so a sort never opens on blanks */
function isMissing(value: ResultValue) {
  // An audience's answer has no one value, but it is an answer
  if (value.cell && value.text !== "") return false;
  return (
    value.raw === undefined ||
    value.raw === null ||
    value.raw === "" ||
    (value.list !== undefined && value.list.length === 0)
  );
}

/**
 * Compares two values as their kind reads best: a flag by how much of its audience it is on
 * for, words with an order by it, numbers and dates by size, and text naturally, so `item-2`
 * comes before `item-10`.
 */
export function compareValues(
  a: ResultValue,
  b: ResultValue,
  order: string[] | undefined,
  descending: boolean,
): number {
  const missingA = isMissing(a);
  const missingB = isMissing(b);
  if (missingA || missingB) return missingA === missingB ? 0 : missingA ? 1 : -1;
  const sign = descending ? -1 : 1;
  const comparable = (value: ResultValue): number | string => {
    if (
      value.cell &&
      (value.cell.tone === "on" || value.cell.tone === "off" || value.cell.tone === "partial") &&
      typeof value.raw !== "number" &&
      typeof value.raw !== "string"
    )
      return rolloutOf(value.cell);
    if (order && typeof value.raw === "string" && order.includes(value.raw))
      return order.indexOf(value.raw);
    if (typeof value.raw === "number") return value.raw;
    if (typeof value.raw === "boolean") return value.raw ? 1 : 0;
    if (value.type === "date") return getDeadlineTimestamp(value.raw) ?? value.text;
    if (value.list) return value.list[0] ?? "";
    return value.text;
  };
  const left = comparable(a);
  const right = comparable(b);
  if (typeof left === "number" && typeof right === "number") return (left - right) * sign;
  return (
    String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) *
    sign
  );
}
