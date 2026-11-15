import { compile } from "@featurevisor/expressions";
import type { Condition } from "@featurevisor/types";

import { ANY_OTHER, type Person } from "./engine";
import {
  DEFINITION_COLUMNS,
  FEATURE_COLUMNS,
  VARIABLE_COLUMNS,
  type ColumnRead,
  type Report,
  type ReportColumn,
  type ReportVary,
} from "./report";

/**
 * FQL, the text form of a Query report. One clause a line, keywords in capitals:
 *
 *   FROM features
 *   WHERE tags includes 'checkout'
 *   FOR { country: 'nl' }
 *   VARY country, device ['mobile', OTHER]
 *   ENVIRONMENT staging, production
 *   SELECT enabled, variation, variables.label
 *   AS MATRIX
 *
 * `WHERE` is a condition expression over each row's columns, matched as conditions are. Without
 * `FOR` the report lists definitions. `VARY *` varies by every attribute the rows' conditions
 * compare, and an attribute alone varies by the values they compare it with, plus `OTHER`.
 *
 * Without `FROM`, each row is a person, and `SELECT` reads columns from anywhere, as conditions
 * read features and variables, each optionally headed with `AS`:
 *
 *   FOR { userId: 'user-1' }
 *   VARY country
 *   SELECT country, feature('foo') AS 'Foo', feature('foo').variation, feature('foo').bar,
 *     variable('checkoutSettings').currency
 */

export const CLAUSES = ["FROM", "WHERE", "FOR", "VARY", "ENVIRONMENT", "SELECT", "AS"] as const;
const KEYWORDS = new Set<string>([...CLAUSES, "TABLE", "MATRIX", "OTHER"]);

export interface FqlError {
  message: string;
  line: number;
  column: number;
}

export type FqlTokenType =
  | "keyword"
  | "comment"
  | "string"
  | "number"
  | "word"
  | "operator"
  | "punctuation"
  | "space"
  | "newline"
  | "other";

export interface FqlToken {
  type: FqlTokenType;
  text: string;
  start: number;
}

const RULES: Array<[FqlTokenType, RegExp]> = [
  ["space", /^[ \t]+/],
  ["newline", /^\r?\n/],
  ["string", /^'(?:[^'\\\n]|\\.)*'?/],
  ["number", /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/],
  ["operator", /^(?:==|!=|>=|<=|>|<)/],
  ["word", /^[A-Za-z_][\w-]*(?:[./][A-Za-z_][\w-]*)*/],
  ["punctuation", /^[()[\]{},:*.]/],
];

/** FQL's tokens, for highlighting and for finding clauses */
export function lexFql(source: string): FqlToken[] {
  const tokens: FqlToken[] = [];
  let at = 0;
  let lineStart = true;
  while (at < source.length) {
    const rest = source.slice(at);
    let token: FqlToken | undefined;
    if (lineStart && rest.startsWith("#")) {
      token = { type: "comment", text: /^#[^\n]*/.exec(rest)![0], start: at };
    }
    for (const [type, pattern] of RULES) {
      if (token) break;
      const match = pattern.exec(rest);
      if (match) token = { type, text: match[0], start: at };
    }
    token ??= { type: "other", text: rest[0], start: at };
    if (token.type === "word" && KEYWORDS.has(token.text)) token.type = "keyword";
    tokens.push(token);
    at += token.text.length;
    if (token.type === "newline") lineStart = true;
    else if (token.type !== "space") lineStart = false;
  }
  return tokens;
}

function position(source: string, offset: number) {
  const before = source.slice(0, offset).split("\n");
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

interface Clause {
  keyword: (typeof CLAUSES)[number];
  start: number;
  /** Where its text starts, after the keyword */
  textStart: number;
  text: string;
}

/**
 * The tokens that start a clause: its keyword, outside brackets and braces. `AS` starts one only
 * before `TABLE` or `MATRIX`, and otherwise heads a column.
 */
export function clauseStarts(tokens: FqlToken[]): Set<number> {
  const starts = new Set<number>();
  let depth = 0;
  tokens.forEach((token, index) => {
    if (token.type === "punctuation" && "([{".includes(token.text)) depth++;
    if (token.type === "punctuation" && ")]}".includes(token.text)) depth--;
    if (depth !== 0 || token.type !== "keyword") return;
    if (!(CLAUSES as readonly string[]).includes(token.text)) return;
    if (token.text === "AS") {
      const next = tokens
        .slice(index + 1)
        .find((item) => !["space", "newline", "comment"].includes(item.type));
      if (next?.text !== "TABLE" && next?.text !== "MATRIX") return;
    }
    starts.add(index);
  });
  return starts;
}

function clausesOf(source: string, tokens: FqlToken[]): Clause[] {
  const clauses: Clause[] = [];
  const starts = clauseStarts(tokens);
  for (const [index, token] of tokens.entries()) {
    if (starts.has(index)) {
      const previous = clauses[clauses.length - 1];
      if (previous) previous.text = source.slice(previous.textStart, token.start);
      clauses.push({
        keyword: token.text as Clause["keyword"],
        start: token.start,
        textStart: token.start + token.text.length,
        text: "",
      });
    }
  }
  const last = clauses[clauses.length - 1];
  if (last) last.text = source.slice(last.textStart);
  return clauses;
}

class Failure extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

/** Literal values, as conditions write them: single quoted text, numbers, lists and objects */
class Literals {
  private at = 0;

  constructor(
    private readonly text: string,
    private readonly offset: number,
  ) {}

  private fail(message: string): never {
    throw new Failure(message, this.offset + this.at);
  }

  private skip() {
    while (this.at < this.text.length) {
      if (/\s/.test(this.text[this.at])) this.at++;
      else if (this.text[this.at] === "#") {
        while (this.at < this.text.length && this.text[this.at] !== "\n") this.at++;
      } else break;
    }
  }

  peek() {
    this.skip();
    return this.text[this.at];
  }

  done() {
    return this.peek() === undefined;
  }

  expect(character: string) {
    if (this.peek() !== character) this.fail(`Expected \`${character}\`.`);
    this.at++;
  }

  word(): string {
    this.skip();
    const match = /^[A-Za-z_][\w-]*(?:[./][A-Za-z_][\w-]*)*/.exec(this.text.slice(this.at));
    if (!match) this.fail("Expected a name.");
    this.at += match[0].length;
    return match[0];
  }

  value(allowOther = false): unknown {
    const character = this.peek();
    if (character === "'") {
      const match = /^'((?:[^'\\\n]|\\.)*)'/.exec(this.text.slice(this.at));
      if (!match) this.fail("Close the text with `'`.");
      this.at += match[0].length;
      return match[1].replace(/\\(.)/g, (_, escaped) =>
        escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped,
      );
    }
    if (character === '"') this.fail("Text uses single quotes, as in conditions.");
    if (character === "[") return this.list(allowOther);
    if (character === "{") return this.object();
    const number = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.at));
    if (number) {
      this.at += number[0].length;
      return Number(number[0]);
    }
    const word = this.word();
    if (word === "true" || word === "false") return word === "true";
    if (word === "null") return null;
    if (word === "OTHER" && allowOther) return ANY_OTHER;
    this.at -= word.length;
    return this.fail(`Unexpected \`${word}\`. Quote text, such as '${word}'.`);
  }

  list(allowOther = false): unknown[] {
    this.expect("[");
    const items: unknown[] = [];
    if (this.peek() === "]") {
      this.at++;
      return items;
    }
    while (true) {
      items.push(this.value(allowOther));
      if (this.peek() === ",") {
        this.at++;
        continue;
      }
      this.expect("]");
      return items;
    }
  }

  object(): Record<string, unknown> {
    this.expect("{");
    const object: Record<string, unknown> = {};
    if (this.peek() === "}") {
      this.at++;
      return object;
    }
    while (true) {
      const key = this.peek() === "'" ? String(this.value()) : this.word();
      this.expect(":");
      object[key] = this.value();
      if (this.peek() === ",") {
        this.at++;
        continue;
      }
      this.expect("}");
      return object;
    }
  }

  /** Where the next character sits in the whole query */
  here() {
    this.skip();
    return this.offset + this.at;
  }

  /**
   * A SELECT item: a column's name, or a read as conditions write one, `feature('foo')`,
   * `feature('foo').variation`, `feature('foo').label`, `variable('settings').currency`, then
   * optionally `AS` and a heading.
   */
  column(): SelectItem {
    const offset = this.here();
    const name = this.word();
    let item: SelectItem;
    if ((name === "feature" || name === "variable") && this.peek() === "(") {
      this.expect("(");
      const keyOffset = this.here();
      const key = this.value();
      if (typeof key !== "string" || key === "")
        throw new Failure(
          `${name}() takes a key in quotes, such as ${name}('checkout').`,
          keyOffset,
        );
      this.expect(")");
      const accessors = this.accessors();
      if (name === "variable") {
        item = {
          offset,
          keyOffset,
          read: { kind: "variable", variable: key, path: accessors.map((item) => item.key) },
        };
      } else if (accessors.length === 0) {
        item = { offset, keyOffset, read: { kind: "flag", feature: key } };
      } else if (accessors[0].style === "dot" && accessors[0].key === "variation") {
        if (accessors.length > 1)
          throw new Failure(
            "A variation is text, so nothing can follow `.variation`.",
            accessors[1].offset,
          );
        item = { offset, keyOffset, read: { kind: "variation", feature: key } };
      } else {
        const [variable, ...path] = accessors;
        if (typeof variable.key !== "string")
          throw new Failure(
            `Read a variable by its name, such as feature('${key}').label.`,
            variable.offset,
          );
        item = {
          offset,
          keyOffset,
          variableOffset: variable.offset,
          read: {
            kind: "variable",
            feature: key,
            variable: variable.key,
            path: path.map((item) => item.key),
          },
        };
      }
    } else {
      item = { offset, name };
    }
    this.skip();
    if (/^AS\b/.test(this.text.slice(this.at))) {
      this.at += 2;
      item.alias = this.peek() === "'" ? String(this.value()) : this.word();
    }
    return item;
  }

  /** `.name`, `.0`, `['name']` or `[0]` after a read, as conditions write paths */
  private accessors() {
    const accessors: Array<{ key: string | number; style: "dot" | "bracket"; offset: number }> = [];
    while (true) {
      const offset = this.here();
      const character = this.peek();
      if (character === ".") {
        this.at++;
        const match = /^(\d+|[A-Za-z_][\w-]*)/.exec(this.text.slice(this.at));
        if (!match) this.fail("Expected a name after `.`.");
        this.at += match[0].length;
        accessors.push({
          key: /^\d/.test(match[0]) ? Number(match[0]) : match[0],
          style: "dot",
          offset,
        });
      } else if (character === "[") {
        this.at++;
        const key = this.value();
        if (typeof key !== "string" && typeof key !== "number")
          throw new Failure("A path reads a name in quotes or a position.", offset + 1);
        this.expect("]");
        accessors.push({ key, style: "bracket", offset });
      } else {
        return accessors;
      }
    }
  }

  /** Names or text separated by commas, such as environments */
  names(): string[] {
    const names: string[] = [];
    while (true) {
      names.push(this.peek() === "'" ? String(this.value()) : this.word());
      if (this.peek() !== ",") return names;
      this.at++;
    }
  }
}

interface SelectItem {
  offset: number;
  /** A column of the row, or a person's attribute */
  name?: string;
  read?: ColumnRead;
  alias?: string;
  keyOffset?: number;
  variableOffset?: number;
}

/** What the project has, for checking the names a query reads */
export interface FqlProject {
  environments: string[];
  /** Feature keys, each with its variables' keys */
  features?: Record<string, string[]>;
  variables?: string[];
  attributes?: string[];
}

/** Every leaf of a compiled filter that names a segment or reads a feature, which rows lack */
function unsupportedLeaf(conditions: unknown): string | undefined {
  if (typeof conditions === "string") return conditions === "*" ? undefined : conditions;
  if (Array.isArray(conditions)) {
    for (const item of conditions) {
      const found = unsupportedLeaf(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!conditions || typeof conditions !== "object") return undefined;
  const leaf = conditions as Record<string, unknown>;
  if (typeof leaf.feature === "string") return `feature('${leaf.feature}')`;
  if (typeof leaf.variable === "string") return `variable('${leaf.variable}')`;
  for (const key of ["and", "or", "not"]) {
    const found = unsupportedLeaf(leaf[key]);
    if (found) return found;
  }
  return undefined;
}

/** The names a project offers, for an error's "it has" hint */
function some(names: string[]) {
  return names.length > 6 ? `${names.slice(0, 6).join(", ")} and more` : names.join(", ");
}

/**
 * A report from FQL, or the errors that keep it from being one, each at its line and column.
 * Environments are checked against the project's, and so are the features, variables and
 * attributes a people report reads, when the project lists them.
 */
export function parseFql(
  source: string,
  project: FqlProject,
): { report?: Report; errors: FqlError[] } {
  const errors: FqlError[] = [];
  const fail = (message: string, offset: number) =>
    errors.push({ message, ...position(source, offset) });
  const clauses = clausesOf(source, lexFql(source));

  const firstText = source.replace(/^(\s|#[^\n]*)*/, "");
  const firstOffset = source.length - firstText.length;
  if (!clauses.length || clauses[0].start !== firstOffset) {
    fail(
      "Start with a clause, such as FROM features, or SELECT feature('key') for a row per person.",
      firstOffset,
    );
    return { errors };
  }

  const report: Report = {
    of: clauses.some((clause) => clause.keyword === "FROM") ? "features" : "people",
    vary: [],
    environments: project.environments.slice(-1),
    show: [],
    as: "table",
  };
  const seen = new Set<string>();
  let selected: SelectItem[] | undefined;
  let selectBroken = false;
  let whereOffset: number | undefined;

  for (const clause of clauses) {
    if (seen.has(clause.keyword) && clause.keyword !== "VARY") {
      fail(`${clause.keyword} appears twice.`, clause.start);
      continue;
    }
    seen.add(clause.keyword);
    const literals = new Literals(clause.text, clause.textStart);
    try {
      if (clause.keyword === "FROM") {
        if (clause !== clauses[0]) throw new Failure("FROM comes first.", clause.start);
        const table = literals.word();
        if (table !== "features" && table !== "variables")
          throw new Failure(
            "FROM reads features or variables. Leave it out for a row per person.",
            clause.textStart + clause.text.indexOf(table),
          );
        report.of = table;
      } else if (clause.keyword === "WHERE") {
        whereOffset = clause.start;
        const result = compile(clause.text, { root: true });
        if (result.errors.length) {
          const error = result.errors[0];
          throw new Failure(error.message, clause.textStart + error.start.offset);
        }
        const unsupported = unsupportedLeaf(result.conditions);
        if (unsupported) {
          throw new Failure(
            unsupported.includes("(")
              ? `${unsupported} reads what someone gets. Select it instead, such as SELECT enabled.`
              : `\`${unsupported}\` alone names a segment, which rows do not have. Compare it, such as archived == true.`,
            clause.textStart,
          );
        }
        report.where = result.conditions as Condition | Condition[];
      } else if (clause.keyword === "FOR") {
        const person = literals.value();
        if (!person || typeof person !== "object" || Array.isArray(person))
          throw new Failure("FOR takes a person, such as { country: 'nl' }.", clause.textStart);
        report.person = person as Person;
      } else if (clause.keyword === "VARY") {
        while (!literals.done()) {
          if (literals.peek() === "*") {
            literals.expect("*");
            report.vary.push({ attribute: "*", values: [] });
          } else {
            const attribute = literals.word();
            const values = literals.peek() === "[" ? literals.list(true).map(String) : [];
            report.vary.push({ attribute, values } satisfies ReportVary);
          }
          if (literals.done()) break;
          literals.expect(",");
        }
      } else if (clause.keyword === "ENVIRONMENT") {
        if (literals.peek() === "*") {
          literals.expect("*");
          report.environments = project.environments;
        } else {
          const environments = literals.names();
          for (const environment of environments) {
            if (!project.environments.includes(environment))
              throw new Failure(
                `No environment called ${environment}. The project has ${project.environments.join(", ") || "none"}.`,
                clause.textStart + clause.text.indexOf(environment),
              );
          }
          report.environments = environments;
        }
      } else if (clause.keyword === "SELECT") {
        selected = [];
        while (true) {
          selected.push(literals.column());
          if (literals.done()) break;
          literals.expect(",");
        }
      } else if (clause.keyword === "AS") {
        const layout = literals.word();
        report.as = layout === "MATRIX" ? "matrix" : "table";
      }
      if (clause.keyword !== "WHERE" && clause.keyword !== "VARY" && !literals.done()) {
        throw new Failure(
          `Unexpected text after ${clause.keyword}.`,
          clause.textStart + clause.text.search(/\S(?=\s*$)/),
        );
      }
    } catch (error) {
      if (!(error instanceof Failure)) throw error;
      fail(error.message, error.offset);
      if (clause.keyword === "SELECT") selectBroken = true;
    }
  }

  if (report.of === "people")
    checkPeople(report, selectBroken ? [] : selected, whereOffset, project, fail, source);
  else checkEntities(report, selected, fail, source);

  return errors.length ? { errors } : { report, errors };
}

type Fail = (message: string, offset: number) => void;

/** A row per person: columns are reads and the person's own attributes */
function checkPeople(
  report: Report,
  selected: SelectItem[] | undefined,
  whereOffset: number | undefined,
  project: FqlProject,
  fail: Fail,
  source: string,
) {
  report.person ??= {};
  const broken = selected?.length === 0;
  if (whereOffset !== undefined)
    fail(
      "WHERE filters features or variables, so it needs FROM. A row per person has no filter yet.",
      whereOffset,
    );
  if (!broken && !selected?.some((item) => item.read)) {
    fail(
      "SELECT what to read, such as SELECT feature('key'), feature('key').variation or variable('key').",
      selected?.[0]?.offset ?? source.length,
    );
  }
  const attributes = project.attributes && [
    ...project.attributes,
    ...Object.keys(report.person),
    ...report.vary.map((vary) => vary.attribute),
  ];
  const columns: ReportColumn[] = [];
  for (const item of selected || []) {
    if (item.name !== undefined) {
      if (attributes && !attributes.includes(item.name)) {
        fail(
          `No attribute called ${item.name}. Read a feature with feature('key'), or a global variable with variable('key').`,
          item.offset,
        );
      }
      columns.push({ read: { kind: "attribute", attribute: item.name }, alias: item.alias });
      continue;
    }
    const read = item.read!;
    if (read.kind === "attribute") continue;
    if (read.kind === "variable" && !read.feature) {
      if (project.variables && !project.variables.includes(read.variable))
        fail(
          `No global variable called ${read.variable}.${project.features?.[read.variable] ? ` ${read.variable} is a feature, read with feature('${read.variable}').` : ""}`,
          item.keyOffset!,
        );
    } else if (project.features) {
      const variables = project.features[read.feature!];
      if (!variables) {
        fail(
          `No feature called ${read.feature}.${project.variables?.includes(read.feature!) ? ` ${read.feature} is a global variable, read with variable('${read.feature}').` : ""}`,
          item.keyOffset!,
        );
      } else if (read.kind === "variable" && !variables.includes(read.variable)) {
        fail(
          variables.length
            ? `${read.feature} has no variable called ${read.variable}. It has ${some(variables)}.`
            : `${read.feature} has no variables.`,
          item.variableOffset!,
        );
      }
    }
    columns.push({ read, alias: item.alias });
  }
  report.columns = columns;
}

/** A row per feature or global variable: columns are the row's own */
function checkEntities(
  report: Report,
  selected: SelectItem[] | undefined,
  fail: Fail,
  source: string,
) {
  const allowed = report.person
    ? report.of === "features"
      ? FEATURE_COLUMNS
      : VARIABLE_COLUMNS
    : ["key", ...DEFINITION_COLUMNS];
  const show: string[] = [];
  for (const item of selected || []) {
    if (item.read) {
      fail(
        `${source.slice(item.offset).match(/^\w+\(/)?.[0]}...) reads one thing for every row. Leave out FROM for a row per person, and SELECT reads from anywhere.`,
        item.offset,
      );
      continue;
    }
    if (item.alias !== undefined) {
      fail("AS heads columns of a row per person report only.", item.offset);
    }
    const name = item.name!;
    const column = name.startsWith("variables.") ? `variable:${name.slice(10)}` : name;
    const ok =
      allowed.includes(column) ||
      (report.person && report.of === "features" && column.startsWith("variable:"));
    if (!ok) {
      fail(
        report.person || !FEATURE_COLUMNS.includes(column)
          ? `No column ${column} here. Try ${allowed.join(", ")}${report.person && report.of === "features" ? " or variables.<key>" : ""}.`
          : `${column} is what someone gets, so it needs FOR, such as FOR { country: 'nl' }.`,
        item.offset,
      );
    }
    if (column !== "key") show.push(column);
  }
  report.show = selected
    ? show
    : report.person
      ? report.of === "features"
        ? ["enabled"]
        : ["value"]
      : ["description", "owner", "tags"];
  if (report.as === "matrix" && !report.person)
    fail("AS MATRIX needs FOR, since it shows what people get.", source.length);
}
