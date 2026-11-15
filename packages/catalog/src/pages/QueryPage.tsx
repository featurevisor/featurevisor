import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { allConditionsAreMatched } from "@featurevisor/sdk";
import type { BucketBy, DatafileContent } from "@featurevisor/types";

import { fetchDatafile } from "../api";
import { useCatalog } from "../context/CatalogContext";
import { decodeRouteSegment, getEntityRoute } from "../entityTypes";
import { colourExpression } from "../components/expressionTokens";
import { TOKEN_CLASSES } from "../components/trees";
import { Badge, EmptyState, EntityKey, PageHeader } from "../components/ui";
import { useCatalogIndex } from "../useCatalogIndex";
import { useDocumentTitle } from "../useDocumentTitle";
import type { CatalogIndex, EntitySummary } from "../types";
import {
  ANY_OTHER,
  featureVariableCell,
  flagCell,
  getComparedValues,
  globalVariableCell,
  lensOf,
  variationCell,
  type Cell,
  type Person,
  type Why,
} from "../query/engine";
import { CLAUSES, lexFql, parseFql, type FqlError } from "../query/fql";
import {
  columnLabel,
  DEFINITION_COLUMNS,
  peopleOf,
  type Report,
  type ReportPerson,
  type ReportVary,
} from "../query/report";

/** Evaluations a report may run before it asks */
const EVALUATION_LIMIT = 20000;

/** Rows `VARY *` grows into at most, so a matrix stays readable */
const AUTOMATIC_ROWS = 48;

const STARTERS: Array<{ title: string; query: string }> = [
  {
    title: "What one person gets",
    query: "FROM features\nFOR { userId: 'user-1', country: 'nl' }\nSELECT enabled, variation",
  },
  {
    title: "Experiments by country",
    query:
      "FROM features\nWHERE variations notEmpty\nFOR {}\nVARY country\nSELECT variation\nAS MATRIX",
  },
  {
    title: "Global variables by country",
    query: "FROM variables\nFOR {}\nVARY country\nSELECT value\nAS MATRIX",
  },
  {
    title: "Features without an owner",
    query: "FROM features\nWHERE owner notExists\nSELECT description, tags",
  },
];

export function QueryPage() {
  const { setKey: encodedSetKey } = useParams();
  const setKey = encodedSetKey && decodeRouteSegment(encodedSetKey);
  const { manifest } = useCatalog();
  const { index, error } = useCatalogIndex(setKey);
  const [searchParams, setSearchParams] = useSearchParams();
  const environments = React.useMemo(
    () => manifest.projectConfig.environments || [],
    [manifest.projectConfig.environments],
  );
  const written = searchParams.get("q") ?? STARTERS[0].query;
  const [draft, setDraft] = React.useState(written);
  const [ran, setRan] = React.useState(written);
  useDocumentTitle("Query", setKey);

  // A link or Back changes the URL, which the editor then shows
  React.useEffect(() => {
    setDraft(written);
    setRan(written);
  }, [written]);

  const run = React.useCallback(
    (query: string) => {
      setRan(query);
      setSearchParams({ q: query }, { replace: true });
    },
    [setSearchParams],
  );
  // Runs as you type, once you pause
  React.useEffect(() => {
    if (draft === ran) return;
    const timer = setTimeout(() => run(draft), 400);
    return () => clearTimeout(timer);
  }, [draft, ran, run]);

  const parsed = React.useMemo(() => parseFql(ran, { environments }), [ran, environments]);
  const [lastGood, setLastGood] = React.useState<Report | undefined>(parsed.report);
  React.useEffect(() => {
    if (parsed.report) setLastGood(parsed.report);
  }, [parsed.report]);

  if (error) return <EmptyState title="Unable to load catalog index" description={error} />;
  if (!index) return null;
  const report = parsed.report || lastGood;

  return (
    <div className="pb-8">
      <PageHeader
        title="Query"
        description="Ask the project a question in FQL: what is configured, or what people get."
      />
      <div className="space-y-4 px-6">
        <div className="flex flex-wrap gap-2">
          {STARTERS.map((starter) => (
            <button
              key={starter.title}
              type="button"
              onClick={() => run(starter.query)}
              className="cursor-pointer rounded-full border border-slate-300 bg-surface px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50"
            >
              {starter.title}
            </button>
          ))}
        </div>
        <FqlEditor value={draft} onChange={setDraft} onRun={() => run(draft)} />
        <Errors errors={parsed.errors} />
        {report && <Results report={report} index={index} setKey={setKey} />}
      </div>
    </div>
  );
}

const KEYWORD_CLASS = "font-bold text-text";

/** FQL coloured as the Catalog colours conditions, with clause keywords in bold */
function highlight(source: string): Array<{ text: string; className?: string }> {
  const segments: Array<{ text: string; className?: string }> = [];
  const tokens = lexFql(source);
  let expression: { start: number } | undefined;
  const flushExpression = (end: number) => {
    if (!expression) return;
    const lines = colourExpression(source.slice(expression.start, end));
    lines.forEach((line, index) => {
      if (index > 0) segments.push({ text: "\n" });
      for (const token of line) {
        segments.push({ text: token.text, className: TOKEN_CLASSES[token.type] || undefined });
      }
    });
    expression = undefined;
  };
  let depth = 0;
  for (const token of tokens) {
    if (token.type === "punctuation" && "([{".includes(token.text)) depth++;
    if (token.type === "punctuation" && ")]}".includes(token.text)) depth--;
    const clause =
      depth === 0 &&
      token.type === "keyword" &&
      (CLAUSES as readonly string[]).includes(token.text);
    if (expression && !clause) continue;
    if (clause) flushExpression(token.start);
    const className =
      token.type === "keyword"
        ? KEYWORD_CLASS
        : token.type === "comment"
          ? TOKEN_CLASSES.comment
          : token.type === "string"
            ? TOKEN_CLASSES.string
            : token.type === "number" || ["true", "false", "null"].includes(token.text)
              ? TOKEN_CLASSES.constant
              : token.type === "operator"
                ? TOKEN_CLASSES.operator
                : token.type === "punctuation"
                  ? TOKEN_CLASSES.punctuation
                  : undefined;
    segments.push({ text: token.text, className });
    // A WHERE clause is a condition expression, coloured as conditions are
    if (clause && token.text === "WHERE") expression = { start: token.start + token.text.length };
  }
  flushExpression(source.length);
  return segments;
}

const EDITOR_TEXT =
  "m-0 p-4 font-mono text-sm leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]";

/**
 * A plain text area over its own highlighted copy, so typing, selecting and the caret are the
 * browser's own while the text shows in colour.
 */
function FqlEditor(props: { value: string; onChange: (value: string) => void; onRun: () => void }) {
  const segments = React.useMemo(() => highlight(props.value), [props.value]);
  return (
    <div className="relative rounded-xl border border-border bg-surface focus-within:border-primary">
      <pre aria-hidden="true" className={`${EDITOR_TEXT} pointer-events-none text-text`}>
        {segments.map((segment, index) =>
          segment.className ? (
            <span key={index} className={segment.className}>
              {segment.text}
            </span>
          ) : (
            segment.text
          ),
        )}
        {/* keeps a last empty line as tall as the text area's */}
        {"\n"}
      </pre>
      <textarea
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            props.onRun();
          }
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="FQL query"
        className={`${EDITOR_TEXT} absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-transparent caret-text outline-none selection:bg-sky-200/60`}
      />
    </div>
  );
}

function Errors(props: { errors: FqlError[] }) {
  if (!props.errors.length) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800">
      {props.errors.map((error, index) => (
        <li key={index}>
          <span className="font-semibold">
            Line {error.line}, column {error.column}:
          </span>{" "}
          {error.message}
        </li>
      ))}
    </ul>
  );
}

/** The datafiles a report evaluates with, one per chosen environment, or the project's own */
function useDatafiles(report: Report, setKey?: string) {
  const { manifest } = useCatalog();
  const hasEnvironments = Boolean(manifest.projectConfig.environments?.length);
  const wanted = hasEnvironments ? report.environments : [null];
  const key = JSON.stringify([setKey, wanted]);
  const [state, setState] = React.useState<{
    key: string;
    datafiles?: Map<string | null, DatafileContent>;
    error?: string;
  }>({ key: "" });

  React.useEffect(() => {
    if (!report.person) return;
    let active = true;
    Promise.all(wanted.map((environment) => fetchDatafile(environment, setKey)))
      .then((loaded) => {
        if (active)
          setState({
            key,
            datafiles: new Map(wanted.map((environment, index) => [environment, loaded[index]])),
          });
      })
      .catch(() => {
        if (active)
          setState({
            key,
            error:
              "This Catalog was exported without datafiles. Export it again with this version to evaluate.",
          });
      });
    return () => {
      active = false;
    };
  }, [key, Boolean(report.person)]);

  return state.key === key ? state : { key, datafiles: undefined, error: undefined };
}

/** A row's columns as a context, for WHERE to match as conditions match */
function rowContext(entity: EntitySummary) {
  return {
    key: entity.key,
    description: entity.description,
    tags: entity.tags || [],
    owner: entity.owners?.[0],
    owners: entity.owners || [],
    status: entity.environmentStatus,
    environments: entity.environments || [],
    variations: entity.variationValues || [],
    variables: entity.variableKeys || [],
    type: entity.variableType,
    archived: entity.archived === true,
    deprecated: entity.deprecated === true,
    tested: entity.hasTests !== false,
  };
}

function selectEntities(report: Report, index: CatalogIndex) {
  const rows = index.entities[report.of === "features" ? "feature" : "variable"] || [];
  const where = report.where;
  return where === undefined
    ? rows
    : rows.filter((row) => allConditionsAreMatched(where as never, rowContext(row)));
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
function resolveVary(
  vary: ReportVary[],
  compared: Map<string, Set<string>>,
  bucketBy: Set<string>,
): ReportVary[] {
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
      .sort(([left, a], [right, b]) => b.size - a.size || left.localeCompare(right));
    for (const [attribute, values] of automatic) {
      if (rows * (values.size + 1) > AUTOMATIC_ROWS) continue;
      rows *= values.size + 1;
      resolved.push({ attribute, values: [...values, ANY_OTHER] });
    }
  }
  return resolved;
}

interface OutcomeRow {
  entity: EntitySummary;
  person: ReportPerson;
  environment: string | null;
  cells: Record<string, Cell>;
}

function Results(props: { report: Report; index: CatalogIndex; setKey?: string }) {
  const { index, setKey } = props;
  const entities = React.useMemo(() => selectEntities(props.report, index), [props.report, index]);
  const { datafiles, error } = useDatafiles(props.report, setKey);
  const [why, setWhy] = React.useState<{ title: string; cell: Cell } | null>(null);

  // Vary by what the selected rows' conditions compare, or every condition's when none narrow
  const report = React.useMemo(() => {
    if (!datafiles) return props.report;
    const loaded = [...datafiles.values()];
    const all = index.entities[props.report.of === "features" ? "feature" : "variable"] || [];
    const keys = entities.map((entity) => entity.key);
    const only =
      entities.length === all.length
        ? undefined
        : props.report.of === "features"
          ? { features: keys }
          : { variables: keys };
    const vary = resolveVary(
      props.report.vary,
      getComparedValues(loaded, only),
      bucketAttributes(loaded, props.report.of === "features" ? keys : []),
    );
    return { ...props.report, vary };
  }, [props.report, datafiles, entities, index]);

  if (!report.person) return <DefinitionsTable report={report} rows={entities} setKey={setKey} />;
  if (error) return <EmptyState title="No datafiles to evaluate with" description={error} />;
  if (!datafiles) return <p className="text-sm text-muted">Loading datafiles…</p>;
  if (entities.length === 0) return <EmptyState title="Nothing matches" />;

  const people = peopleOf(report.person, report.vary);
  const environments = [...datafiles.keys()];
  const columns = report.show.length
    ? report.show
    : report.of === "features"
      ? ["enabled"]
      : ["value"];
  const evaluations = entities.length * people.length * environments.length * columns.length;
  if (evaluations > EVALUATION_LIMIT) {
    return (
      <EmptyState
        title={`${evaluations.toLocaleString()} evaluations is more than this prototype runs at once`}
        description="Narrow the report with WHERE, fewer values or fewer environments."
      />
    );
  }

  const rows: OutcomeRow[] = [];
  for (const entity of entities) {
    for (const person of people) {
      for (const environment of environments) {
        const datafile = datafiles.get(environment)!;
        const cells: Record<string, Cell> = {};
        for (const column of columns) {
          cells[column] = evaluateCell(report, datafile, entity.key, column, person.person);
        }
        rows.push({ entity, person, environment, cells });
      }
    }
  }

  const lenses = new Set(
    report.of === "features"
      ? rows.map((row) =>
          lensOf(datafiles.get(row.environment)!, row.entity.key, row.person.person),
        )
      : [],
  );
  const open = (title: string, cell: Cell) => setWhy({ title, cell });

  return (
    <div className="space-y-3">
      <Summary
        noun={report.of === "features" ? "feature" : "global variable"}
        count={evaluations}
        entities={entities.length}
        people={people.length}
        environments={environments.length}
        lenses={lenses}
        markdown={() => toMarkdown(report, rows, columns, environments)}
      />
      {report.as === "matrix" ? (
        <MatrixTable
          report={report}
          rows={rows}
          entities={entities}
          people={people}
          environments={environments}
          column={columns[0]}
          setKey={setKey}
          onWhy={open}
        />
      ) : (
        <OutcomeTable
          report={report}
          rows={rows}
          columns={columns}
          people={people}
          environments={environments}
          setKey={setKey}
          onWhy={open}
        />
      )}
      {why && (
        <WhyPanel
          title={why.title}
          why={why.cell.why}
          cell={why.cell}
          onClose={() => setWhy(null)}
        />
      )}
    </div>
  );
}

function evaluateCell(
  report: Report,
  datafile: DatafileContent,
  key: string,
  column: string,
  person: Person,
): Cell {
  if (report.of === "variables") {
    const cell = globalVariableCell(datafile, key, person);
    if (column === "override")
      return {
        ...cell,
        text: cell.why.overrideKey || "Default",
        tone: cell.why.overrideKey ? "value" : "none",
      };
    if (column === "reason") return { ...cell, text: cell.why.reason, tone: "none" };
    return cell;
  }
  if (column.startsWith("variable:"))
    return featureVariableCell(datafile, key, column.slice(9), person);
  if (column === "variation") return variationCell(datafile, key, person);
  const flag = flagCell(datafile, key, person);
  if (column === "rule")
    return {
      ...flag,
      text: flag.why.ruleKey || (flag.why.forced ? "forced" : "None"),
      tone: "none",
    };
  if (column === "reason") return { ...flag, text: flag.why.reason, tone: "none" };
  return flag;
}

function Summary(props: {
  noun: string;
  count: number;
  entities: number;
  people: number;
  environments: number;
  lenses: Set<string>;
  markdown: () => string;
}) {
  const [copied, setCopied] = React.useState("");
  const copy = (what: string, text: string) =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(""), 1500);
    });
  const lens = props.lenses.has("audience")
    ? props.lenses.has("person")
      ? "Mixed: some rows describe audiences, others one person"
      : "Audience: a share of everyone matching each row, as rollouts give it"
    : props.lenses.has("person")
      ? "One person: the exact answer for each row's person"
      : "Exact: global variables have no rollouts";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
      <span>
        {props.entities} {props.noun}
        {props.entities === 1 ? "" : "s"} × {props.people}{" "}
        {props.people === 1 ? "person" : "people"} × {props.environments}{" "}
        {props.environments === 1 ? "environment" : "environments"}, {props.count.toLocaleString()}{" "}
        evaluations · <span className="font-medium text-text">{lens}</span>
      </span>
      <span className="flex gap-3">
        <button
          type="button"
          className="cursor-pointer font-medium text-muted hover:text-text"
          onClick={() => copy("link", window.location.href)}
        >
          {copied === "link" ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          className="cursor-pointer font-medium text-muted hover:text-text"
          onClick={() => copy("markdown", props.markdown())}
        >
          {copied === "markdown" ? "Copied" : "Copy as Markdown"}
        </button>
      </span>
    </div>
  );
}

const VARIATION_TONES = ["info", "accent", "success", "warning", "danger"] as const;

function CellView(props: { cell: Cell; onClick: () => void; variations: string[] }) {
  const { cell } = props;
  const body =
    cell.tone === "on" ? (
      <Badge tone="success">{cell.text}</Badge>
    ) : cell.tone === "off" ? (
      <Badge>{cell.text}</Badge>
    ) : cell.tone === "partial" ? (
      <Badge tone="warning">{cell.text}</Badge>
    ) : cell.variation ? (
      <Badge
        tone={VARIATION_TONES[props.variations.indexOf(cell.variation) % VARIATION_TONES.length]}
      >
        {cell.text}
      </Badge>
    ) : (
      <span className={`font-mono text-xs ${cell.tone === "none" ? "text-muted" : "text-text"}`}>
        {cell.text || "—"}
      </span>
    );
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="cursor-pointer rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
      title="Why?"
    >
      {body}
    </button>
  );
}

function variationsOf(rows: OutcomeRow[]) {
  return [
    ...new Set(
      rows.flatMap(
        (row) =>
          Object.values(row.cells)
            .map((cell) => cell.variation)
            .filter(Boolean) as string[],
      ),
    ),
  ];
}

const thClass =
  "border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-faint";
const tdClass = "border-b border-border px-3 py-2 align-top";
/** The first column holds keys, kept wide enough that they break only at dots */
const keyClass = "min-w-[12rem]";

function EntityLink(props: { report: Report; entity: EntitySummary; setKey?: string }) {
  return (
    <Link
      to={getEntityRoute(
        props.report.of === "features" ? "feature" : "variable",
        props.entity.key,
        props.setKey,
      )}
      className="font-medium text-text hover:underline"
    >
      <EntityKey value={props.entity.key} />
    </Link>
  );
}

function OutcomeTable(props: {
  report: Report;
  rows: OutcomeRow[];
  columns: string[];
  people: ReportPerson[];
  environments: Array<string | null>;
  setKey?: string;
  onWhy: (title: string, cell: Cell) => void;
}) {
  const variations = variationsOf(props.rows);
  const varied = props.report.vary.map((vary) => vary.attribute);
  const showEnvironment = props.environments.length > 1;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={`${thClass} ${keyClass}`}>
              {props.report.of === "features" ? "Feature" : "Variable"}
            </th>
            {varied.map((attribute) => (
              <th key={attribute} className={thClass}>
                {attribute}
              </th>
            ))}
            {showEnvironment && <th className={thClass}>Environment</th>}
            {props.columns.map((column) => (
              <th key={column} className={thClass}>
                {columnLabel(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, index) => (
            <tr key={index} className="hover:bg-elevated/60">
              <td className={tdClass}>
                <EntityLink report={props.report} entity={row.entity} setKey={props.setKey} />
              </td>
              {varied.map((attribute) => (
                <td key={attribute} className={`${tdClass} font-mono text-xs`}>
                  {row.person.values[attribute]}
                </td>
              ))}
              {showEnvironment && <td className={`${tdClass} text-xs`}>{row.environment}</td>}
              {props.columns.map((column) => (
                <td key={column} className={tdClass}>
                  <CellView
                    cell={row.cells[column]}
                    variations={variations}
                    onClick={() =>
                      props.onWhy(
                        `${row.entity.key} · ${row.person.label}${row.environment ? ` · ${row.environment}` : ""}`,
                        row.cells[column],
                      )
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** People down the side, each entity and environment across the top, one outcome per cell */
function MatrixTable(props: {
  report: Report;
  rows: OutcomeRow[];
  entities: EntitySummary[];
  people: ReportPerson[];
  environments: Array<string | null>;
  column: string;
  setKey?: string;
  onWhy: (title: string, cell: Cell) => void;
}) {
  const variations = variationsOf(props.rows);
  const varied = props.report.vary.map((vary) => vary.attribute);
  const cellOf = (entity: string, person: string, environment: string | null) =>
    props.rows.find(
      (row) =>
        row.entity.key === entity && row.person.label === person && row.environment === environment,
    );
  const many = props.environments.length > 1;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {(varied.length ? varied : ["Person"]).map((attribute, index) => (
              <th
                key={attribute}
                className={`${thClass} ${index === 0 ? "sticky left-0 bg-surface" : ""}`}
                rowSpan={many ? 2 : 1}
              >
                {attribute}
              </th>
            ))}
            {props.entities.map((entity) => (
              <th
                key={entity.key}
                className={`${thClass} normal-case tracking-normal`}
                colSpan={props.environments.length}
              >
                <EntityLink report={props.report} entity={entity} setKey={props.setKey} />
                <span className="ml-1.5 font-normal text-faint">{columnLabel(props.column)}</span>
              </th>
            ))}
          </tr>
          {many && (
            <tr>
              {props.entities.flatMap((entity) =>
                props.environments.map((environment) => (
                  <th
                    key={`${entity.key}:${environment}`}
                    className={`${thClass} normal-case tracking-normal font-medium`}
                  >
                    {environment}
                  </th>
                )),
              )}
            </tr>
          )}
        </thead>
        <tbody>
          {props.people.map((person) => (
            <tr key={person.label} className="hover:bg-elevated/60">
              {(varied.length ? varied : [""]).map((attribute, index) => (
                <td
                  key={attribute}
                  className={`${tdClass} ${index === 0 ? "sticky left-0 bg-surface" : ""} font-mono text-xs`}
                >
                  {attribute ? person.values[attribute] : person.label}
                </td>
              ))}
              {props.entities.flatMap((entity) =>
                props.environments.map((environment) => {
                  const row = cellOf(entity.key, person.label, environment);
                  const cell = row?.cells[props.column];
                  return (
                    <td key={`${entity.key}:${environment}`} className={tdClass}>
                      {cell && (
                        <CellView
                          cell={cell}
                          variations={variations}
                          onClick={() =>
                            props.onWhy(
                              `${entity.key} · ${person.label}${environment ? ` · ${environment}` : ""}`,
                              cell,
                            )
                          }
                        />
                      )}
                    </td>
                  );
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DefinitionsTable(props: { report: Report; rows: EntitySummary[]; setKey?: string }) {
  const columns = props.report.show.filter((column) => DEFINITION_COLUMNS.includes(column));
  if (props.rows.length === 0) return <EmptyState title="Nothing matches" />;
  const value = (row: EntitySummary, column: string): React.ReactNode => {
    if (column === "description") return <span className="text-muted">{row.description}</span>;
    if (column === "owner")
      return row.owners?.join(", ") || <span className="text-faint">None</span>;
    if (column === "tags") return (row.tags || []).map((tag) => <Badge key={tag}>{tag}</Badge>);
    if (column === "status")
      return row.environmentStatus ? <Badge>{row.environmentStatus}</Badge> : null;
    return null;
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        {props.rows.length} {props.report.of === "features" ? "features" : "global variables"}
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${thClass} ${keyClass}`}>Key</th>
              {columns.map((column) => (
                <th key={column} className={thClass}>
                  {columnLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.key} className="hover:bg-elevated/60">
                <td className={tdClass}>
                  <EntityLink report={props.report} entity={row} setKey={props.setKey} />
                </td>
                {columns.map((column) => (
                  <td key={column} className={`${tdClass} text-xs`}>
                    <span className="flex flex-wrap gap-1">{value(row, column)}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Why a cell says what it says, as `evaluate --explain` would put it */
function WhyPanel(props: { title: string; cell: Cell; why: Why; onClose: () => void }) {
  const { why } = props;
  const facts: Array<[string, React.ReactNode]> = [
    ["Answer", props.cell.text],
    [
      "Lens",
      why.lens === "audience"
        ? `Everyone matching this row. Without ${why.bucketBy || "what it buckets by"}, which this feature buckets by, a rollout reads as the share it enables.`
        : why.lens === "person"
          ? why.at !== undefined
            ? `One person, placed at ${why.at}% of the rollout.`
            : `One person, bucketed by their ${why.bucketBy || "own attributes"}.`
          : "Exact. Global variable overrides have no rollouts.",
    ],
    ["Reason", <code key="reason">{why.reason}</code>],
  ];
  if (why.forced) facts.push(["Decided by", "A force entry"]);
  if (why.ruleKey) facts.push(["Matched rule", <code key="rule">{why.ruleKey}</code>]);
  if (why.percentage !== undefined)
    facts.push(["Rule's rollout", `${why.percentage}% of this audience`]);
  if (why.split) {
    facts.push([
      "Split",
      <span key="split" className="flex flex-col gap-0.5">
        {why.split.map((share) => (
          <span key={share.variation}>
            <code>{share.variation}</code> {share.percentage}%
            {share.value !== undefined ? (
              <>
                , <code>{share.value}</code>
              </>
            ) : null}
          </span>
        ))}
      </span>,
    ]);
  }
  if (why.overrideKey)
    facts.push(["Matched override", <code key="override">{why.overrideKey}</code>]);

  return (
    <div
      role="dialog"
      aria-label={`Why: ${props.title}`}
      className="fixed bottom-4 right-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-4 shadow-xl"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Why</div>
          <div className="truncate text-sm font-semibold text-text">{props.title}</div>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close"
          className="cursor-pointer rounded px-1.5 text-muted hover:text-text"
        >
          ×
        </button>
      </div>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
        {facts.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-faint">{label}</dt>
            <dd className="text-text">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}

function toMarkdown(
  report: Report,
  rows: OutcomeRow[],
  columns: string[],
  environments: Array<string | null>,
) {
  const varied = report.vary.map((vary) => vary.attribute);
  const showEnvironment = environments.length > 1;
  const header = [
    report.of === "features" ? "Feature" : "Variable",
    ...varied,
    ...(showEnvironment ? ["Environment"] : []),
    ...columns.map(columnLabel),
  ];
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map(
      (row) =>
        `| ${[
          `\`${row.entity.key}\``,
          ...varied.map((attribute) => row.person.values[attribute]),
          ...(showEnvironment ? [row.environment ?? ""] : []),
          ...columns.map((column) => row.cells[column].text),
        ].join(" | ")} |`,
    ),
  ];
  return lines.join("\n");
}
