import { compile } from "@featurevisor/expressions";
import type { Condition } from "@featurevisor/types";

import { ANY_OTHER, type Person } from "./engine";
import {
  DETAILS,
  PROPERTIES,
  ROW_KEY,
  SUBJECTS,
  exprText,
  propertyOf,
  readOf,
  type Detail,
  type Expr,
  type Read,
  type ReadKey,
  type Report,
  type ReportColumn,
  type ReportSort,
  type ReportVary,
  type ReportWhere,
  type Subject,
} from "./report";

/**
 * FQL, the text form of a Query report. One clause a line, keywords in capitals:
 *
 *   FROM features
 *   WHERE tags includes 'checkout' and rollout(feature(key)) < 100
 *   FOR { country: 'nl' }
 *   VARY country, device ['mobile', OTHER]
 *   ENVIRONMENT staging, production
 *   SELECT key, owner, feature(key), feature(key).variation, feature(key).label
 *   SORT BY owner, key DESC
 *   LIMIT 20
 *   AS MATRIX
 *
 * A bare name is a property of the row, such as `owner` or `bucketBy`. A call reads what someone
 * gets, as conditions read it: `feature('foo')`, its `.variation` or a variable, or
 * `variable('foo')`, with `key` standing for the row's own key and an environment of its own as
 * a second argument. `rollout()`, `rule()`, `reason()` and `override()` read what an evaluation
 * says beside its answer, and `count()` counts the rows GROUP BY gathers.
 *
 * Without FROM, each row is a person, one per combination FOR and VARY give.
 */

export const CLAUSES = [
  "FROM",
  "WHERE",
  "FOR",
  "VARY",
  "ENVIRONMENT",
  "SELECT",
  "GROUP",
  "SORT",
  "LIMIT",
  "AS",
] as const;
type ClauseKeyword = (typeof CLAUSES)[number];
const KEYWORDS = new Set<string>([...CLAUSES, "TABLE", "MATRIX", "OTHER", "BY", "ASC", "DESC"]);

/** Calls a column can make, each reading what someone gets or counting rows */
export const READ_CALLS = ["feature", "variable"];
export const CALLS = [...READ_CALLS, ...Object.keys(DETAILS), "count"];

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
  keyword: ClauseKeyword;
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
    if (!starts.has(index)) continue;
    const previous = clauses[clauses.length - 1];
    if (previous) previous.text = source.slice(previous.textStart, token.start);
    clauses.push({
      keyword: token.text as ClauseKeyword,
      start: token.start,
      textStart: token.start + token.text.length,
      text: "",
    });
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

/** An expression as written, and where its parts sit, for errors that point at them */
interface Located {
  expr: Expr;
  offset: number;
  keyOffset?: number;
  variableOffset?: number;
  environmentOffset?: number;
}

interface SelectItem extends Located {
  alias?: string;
}

/** Literal values and expressions, as conditions write them */
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

  /** Where the next character sits in the whole query */
  here() {
    this.skip();
    return this.offset + this.at;
  }

  /** Moves to a place in the text, for reading an expression from the middle of it */
  seek(at: number) {
    this.at = at;
  }

  /** Where reading stopped, within the text */
  stop() {
    return this.at;
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

  /** Takes a keyword such as `BY` or `DESC`, when it comes next */
  keyword(word: string) {
    this.skip();
    if (!new RegExp(`^${word}\\b`).test(this.text.slice(this.at))) return false;
    this.at += word.length;
    return true;
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

  /** Names or text separated by commas, such as environments */
  names(): string[] {
    const names: string[] = [];
    while (true) {
      names.push(this.peek() === "'" ? String(this.value()) : this.word());
      if (this.peek() !== ",") return names;
      this.at++;
    }
  }

  /**
   * An expression: a property's name, a read as conditions write one, `feature('foo')`,
   * `feature(key).variation`, `feature('foo', 'staging').label`, `variable(key).currency`, a
   * detail of a read, such as `rollout(feature(key))`, or `count()`.
   */
  expr(): Located {
    const offset = this.here();
    const name = this.word();
    if (this.peek() !== "(" || !CALLS.includes(name))
      return { offset, expr: { kind: "property", name } };
    if (name === "count") {
      this.expect("(");
      this.expect(")");
      return { offset, expr: { kind: "count" } };
    }
    if (name in DETAILS) {
      this.expect("(");
      const inner = this.expr();
      this.expect(")");
      const read = readOf(inner.expr);
      if (!read || inner.expr.kind !== "read")
        throw new Failure(`${name}() takes a read, such as ${name}(feature(key)).`, inner.offset);
      return { ...inner, offset, expr: { kind: "detail", detail: name as Detail, read } };
    }
    return { offset, ...this.read(name) };
  }

  private read(name: string): Omit<Located, "offset"> {
    this.expect("(");
    const keyOffset = this.here();
    let key: ReadKey;
    if (this.text[this.at] === "'") {
      const value = this.value();
      if (typeof value !== "string" || value === "")
        throw new Failure(
          `${name}() takes a key in quotes, such as ${name}('checkout').`,
          keyOffset,
        );
      key = value;
    } else if (/^key\b/.test(this.text.slice(this.at))) {
      this.at += 3;
      key = ROW_KEY;
    } else {
      throw new Failure(
        `${name}() takes a key in quotes, such as ${name}('checkout'), or key for the row's own.`,
        keyOffset,
      );
    }
    let environment: string | undefined;
    let environmentOffset: number | undefined;
    if (this.peek() === ",") {
      this.at++;
      environmentOffset = this.here();
      const value = this.value();
      if (typeof value !== "string")
        throw new Failure(
          "An environment goes in quotes, such as 'production'.",
          environmentOffset,
        );
      environment = value;
    }
    this.expect(")");
    const accessors = this.accessors();
    const where = environment === undefined ? {} : { environment };
    if (name === "variable") {
      const read: Read = {
        kind: "global",
        variable: key,
        path: accessors.map((item) => item.key),
        ...where,
      };
      return { expr: { kind: "read", read }, keyOffset, environmentOffset };
    }
    if (accessors.length === 0)
      return {
        expr: { kind: "read", read: { kind: "flag", feature: key, ...where } },
        keyOffset,
        environmentOffset,
      };
    if (accessors[0].style === "dot" && accessors[0].key === "variation") {
      if (accessors.length > 1)
        throw new Failure(
          "A variation is text, so nothing can follow `.variation`.",
          accessors[1].offset,
        );
      return {
        expr: { kind: "read", read: { kind: "variation", feature: key, ...where } },
        keyOffset,
        environmentOffset,
      };
    }
    const [variable, ...path] = accessors;
    if (typeof variable.key !== "string")
      throw new Failure(
        "Read a variable by its name, such as feature(key).label.",
        variable.offset,
      );
    const read: Read = {
      kind: "variable",
      feature: key,
      variable: variable.key,
      path: path.map((item) => item.key),
      ...where,
    };
    return {
      expr: { kind: "read", read },
      keyOffset,
      variableOffset: variable.offset,
      environmentOffset,
    };
  }

  /** `.name`, `.0`, `['name']` or `[0]` after a read, as conditions write paths */
  private accessors() {
    const accessors: Array<{ key: string | number; style: "dot" | "bracket"; offset: number }> = [];
    while (true) {
      const offset = this.offset + this.at;
      const character = this.text[this.at];
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

  /** A SELECT item: an expression, then optionally `AS` and a heading */
  column(): SelectItem {
    const item: SelectItem = this.expr();
    if (this.keyword("AS")) item.alias = this.peek() === "'" ? String(this.value()) : this.word();
    return item;
  }

  /** Items separated by commas, until the clause ends */
  items<T>(read: () => T): T[] {
    const items: T[] = [];
    while (true) {
      items.push(read());
      if (this.done()) return items;
      this.expect(",");
    }
  }
}

/** What the project has, for checking the names a query reads */
export interface FqlProject {
  environments: string[];
  /** Feature keys, each with its variables' keys */
  features?: Record<string, string[]>;
  variables?: string[];
  attributes?: string[];
}

/** Names that used to be columns but are what someone gets, with how to read each now */
const READ_INSTEAD: Record<string, string> = {
  enabled: "feature(key)",
  variation: "feature(key).variation",
  value: "variable(key)",
  rule: "rule(feature(key))",
  reason: "reason(feature(key))",
  override: "override(variable(key))",
};

/** Placeholder names that stand in for reads while WHERE compiles as a condition expression */
const placeholder = (index: number, length: number) => `q${index}`.padEnd(Math.max(length, 3), "_");

/**
 * WHERE as conditions, each read swapped for a name of the same length that the row's context
 * then holds the read's answer under, so errors point where they did in the text.
 */
function parseWhere(text: string, offset: number): { where: ReportWhere; reads: Located[] } {
  const literals = new Literals(text, offset);
  const located: Located[] = [];
  const reads: Record<string, Expr> = {};
  let substituted = "";
  let copied = 0;
  const tokens = lexFql(text);
  for (const [index, token] of tokens.entries()) {
    if (token.start < copied || token.type !== "word" || !CALLS.includes(token.text)) continue;
    if (tokens[index + 1]?.text !== "(") continue;
    literals.seek(token.start);
    const item = literals.expr();
    if (item.expr.kind === "count")
      throw new Failure("count() counts groups, so WHERE cannot compare it.", item.offset);
    const end = literals.stop();
    const name = placeholder(located.length, end - token.start);
    reads[name] = item.expr;
    located.push(item);
    substituted += text.slice(copied, token.start) + name;
    copied = end;
  }
  substituted += text.slice(copied);

  const result = compile(substituted, { root: true });
  if (result.errors.length) {
    const error = result.errors[0];
    throw new Failure(error.message, offset + error.start.offset);
  }
  const names = new Set<string>();
  // A read written alone, as `feature(key)`, compiles as a segment's name: it means true
  const resolve = (conditions: unknown): unknown => {
    if (typeof conditions === "string") {
      if (reads[conditions]) return { attribute: conditions, operator: "equals", value: true };
      if (conditions !== "*")
        throw new Failure(
          `\`${conditions}\` alone names a segment, which rows do not have. Compare it, such as archived == true.`,
          offset,
        );
      return conditions;
    }
    if (Array.isArray(conditions)) return conditions.map(resolve);
    if (!conditions || typeof conditions !== "object") return conditions;
    const leaf = conditions as Record<string, unknown>;
    if (typeof leaf.attribute === "string") {
      if (!reads[leaf.attribute]) names.add(leaf.attribute);
      return leaf;
    }
    return Object.fromEntries(
      Object.entries(leaf).map(([key, value]) =>
        ["and", "or", "not"].includes(key) ? [key, resolve(value)] : [key, value],
      ),
    );
  };
  const conditions = resolve(result.conditions) as Condition | Condition[];
  return { where: { conditions, reads, names: [...names] }, reads: located };
}

/** The names a project offers, for an error's "it has" hint */
function some(names: string[]) {
  return names.length > 6 ? `${names.slice(0, 6).join(", ")} and more` : names.join(", ");
}

const subjectWords = (subjects: Subject[]) =>
  subjects.map((subject) => `${subject}s`).join(" and ");

/**
 * A report from FQL, or the errors that keep it from being one, each at its line and column.
 * Environments are checked against the project's, and so are the features, variables and
 * attributes a query reads, when the project lists them.
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
    subjects: [],
    vary: [],
    environments: project.environments.slice(-1),
    columns: [],
    group: [],
    sort: [],
    as: "table",
  };
  const seen = new Set<string>();
  let selected: SelectItem[] | undefined;
  let grouped: Located[] = [];
  let sorted: Array<{ item: Located & { alias?: string }; descending: boolean }> = [];
  let whereReads: Located[] = [];
  let person: Person | undefined;
  let varied = false;
  let matrixOffset: number | undefined;

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
        for (const name of literals.names()) {
          const subject = SUBJECTS[name];
          if (!subject)
            throw new Failure(
              "FROM reads features, variables, segments or attributes. Leave it out for a row per person.",
              clause.textStart + clause.text.indexOf(name),
            );
          if (!report.subjects.includes(subject)) report.subjects.push(subject);
        }
      } else if (clause.keyword === "WHERE") {
        const parsed = parseWhere(clause.text, clause.textStart);
        report.where = parsed.where;
        whereReads = parsed.reads;
      } else if (clause.keyword === "FOR") {
        const value = literals.value();
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Failure("FOR takes a person, such as { country: 'nl' }.", clause.textStart);
        person = value as Person;
      } else if (clause.keyword === "VARY") {
        varied = true;
        while (!literals.done()) {
          if (literals.peek() === "*") {
            literals.expect("*");
            report.vary.push({ attribute: "*", values: [] });
          } else {
            const attribute = literals.word();
            const values = literals.peek() === "[" ? literals.list(true) : [];
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
        selected = literals.items(() => literals.column());
      } else if (clause.keyword === "GROUP") {
        literals.keyword("BY");
        grouped = literals.items(() => literals.expr());
      } else if (clause.keyword === "SORT") {
        literals.keyword("BY");
        sorted = literals.items(() => {
          // A heading in quotes names a SELECT column
          const item: Located & { alias?: string } =
            literals.peek() === "'"
              ? {
                  offset: literals.here(),
                  expr: { kind: "property", name: "" },
                  alias: String(literals.value()),
                }
              : literals.expr();
          const descending = literals.keyword("DESC");
          if (!descending) literals.keyword("ASC");
          return { item, descending };
        });
      } else if (clause.keyword === "LIMIT") {
        const offset = literals.here();
        const value = literals.value();
        if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
          throw new Failure("LIMIT takes how many rows to show, such as LIMIT 10.", offset);
        report.limit = value;
      } else if (clause.keyword === "AS") {
        if (literals.word() === "MATRIX") {
          report.as = "matrix";
          matrixOffset = clause.start;
        }
      }
      // WHERE's text is a condition expression, compiled whole above
      if (clause.keyword !== "WHERE" && !literals.done()) {
        throw new Failure(
          `Unexpected text after ${clause.keyword}.`,
          clause.textStart + clause.text.search(/\S(?=\s*$)/),
        );
      }
    } catch (error) {
      if (!(error instanceof Failure)) throw error;
      fail(error.message, error.offset);
    }
  }
  if (errors.length) return { errors };

  const people = report.subjects.length === 0;
  // Reading what someone gets needs someone: FOR's person, or everyone when it says none
  const reads = [
    ...(selected || []),
    ...grouped,
    ...sorted.map((sort) => sort.item),
    ...whereReads,
  ];
  if (person || varied || people || reads.some((item) => readOf(item.expr)))
    report.person = person ?? {};
  const evaluating = report.person !== undefined;

  const attributes = project.attributes && [
    ...project.attributes,
    ...Object.keys(report.person || {}),
    ...report.vary.map((vary) => vary.attribute),
  ];
  const isAttribute = (name: string) => (attributes ? attributes.includes(name) : evaluating);

  /** Checks an expression's names against the rows and the project */
  const check = (item: Located, place: "SELECT" | "GROUP BY" | "SORT" | "WHERE") => {
    const { expr } = item;
    if (expr.kind === "count") {
      if (place === "GROUP BY")
        fail("GROUP BY gathers rows by a column, and count() counts them.", item.offset);
      return;
    }
    if (expr.kind === "property") {
      const { name } = expr;
      if (name === "environment" && evaluating) return;
      if (people) {
        if (!isAttribute(name))
          fail(
            `No attribute called ${name}. Read a feature with feature('key'), or a global variable with variable('key').`,
            item.offset,
          );
        return;
      }
      const property = propertyOf(name);
      if (property && report.subjects.some((subject) => property.subjects.includes(subject)))
        return;
      if (property) {
        fail(`${name} is a property of ${subjectWords(property.subjects)} only.`, item.offset);
        return;
      }
      if (READ_INSTEAD[name] || name.startsWith("variables.")) {
        const instead = READ_INSTEAD[name] ?? `feature(key).${name.slice("variables.".length)}`;
        fail(`${name} is what someone gets, not a property. Read it with ${instead}.`, item.offset);
        return;
      }
      if (evaluating && isAttribute(name)) return;
      const known = Object.keys(PROPERTIES).filter((key) =>
        report.subjects.some((subject) => PROPERTIES[key].subjects.includes(subject)),
      );
      fail(`No property called ${name}. Try ${some(known)}, or metadata.<key>.`, item.offset);
      return;
    }
    const read = expr.read;
    if (expr.kind === "detail") {
      const fits =
        expr.detail === "rollout"
          ? read.kind === "flag"
          : expr.detail === "override"
            ? read.kind === "variable" || read.kind === "global"
            : expr.detail === "rule"
              ? read.kind !== "global"
              : true;
      if (!fits)
        fail(
          expr.detail === "rollout"
            ? "rollout() reads how much of an audience a feature is on for, such as rollout(feature(key))."
            : expr.detail === "override"
              ? "override() reads which override a variable's value came from, such as override(variable(key))."
              : "Global variables have overrides, not rules. Read override(variable(key)) instead.",
          item.offset,
        );
    }
    if (read.environment !== undefined && !project.environments.includes(read.environment))
      fail(
        `No environment called ${read.environment}. The project has ${project.environments.join(", ") || "none"}.`,
        item.environmentOffset ?? item.offset,
      );
    const global = read.kind === "global";
    const key = global ? read.variable : read.feature;
    if (typeof key !== "string") {
      const subject: Subject = global ? "variable" : "feature";
      if (people)
        fail(
          `key names each row's own key, and a row per person has none. Name one, such as ${global ? "variable" : "feature"}('checkout').`,
          item.keyOffset ?? item.offset,
        );
      else if (!report.subjects.includes(subject))
        fail(
          `${global ? "variable" : "feature"}(key) reads each row's own ${global ? "global variable" : "feature"}, so it needs FROM ${subject}s.`,
          item.keyOffset ?? item.offset,
        );
      return;
    }
    if (global) {
      if (project.variables && !project.variables.includes(key))
        fail(
          `No global variable called ${key}.${project.features?.[key] ? ` ${key} is a feature, read with feature('${key}').` : ""}`,
          item.keyOffset ?? item.offset,
        );
      return;
    }
    if (!project.features) return;
    const variables = project.features[key];
    if (!variables) {
      fail(
        `No feature called ${key}.${project.variables?.includes(key) ? ` ${key} is a global variable, read with variable('${key}').` : ""}`,
        item.keyOffset ?? item.offset,
      );
    } else if (read.kind === "variable" && !variables.includes(read.variable)) {
      fail(
        variables.length
          ? `${key} has no variable called ${read.variable}. It has ${some(variables)}.`
          : `${key} has no variables.`,
        item.variableOffset ?? item.offset,
      );
    }
  };

  for (const item of selected || []) check(item, "SELECT");
  for (const item of grouped) check(item, "GROUP BY");
  for (const item of whereReads) check(item, "WHERE");
  for (const name of report.where?.names || []) {
    check(
      {
        expr: { kind: "property", name },
        offset: clauses.find((clause) => clause.keyword === "WHERE")!.textStart,
      },
      "WHERE",
    );
  }

  report.group = grouped.map((item) => ({ expr: item.expr }));
  const groupTexts = new Set(report.group.map((column) => exprText(column.expr)));
  const counting = (selected || []).some((item) => item.expr.kind === "count");

  // Columns: as written, or what the rows are best known by
  if (selected) {
    report.columns = selected.map((item) => ({ expr: item.expr, alias: item.alias }));
  } else if (report.group.length) {
    report.columns = [...report.group, { expr: { kind: "count" } }];
  } else if (people) {
    fail(
      "SELECT what to read, such as SELECT feature('key'), feature('key').variation or variable('key').",
      source.length,
    );
  } else {
    const subjects = report.subjects;
    const read: ReportColumn[] =
      evaluating && subjects.length === 1 && subjects[0] === "feature"
        ? [{ expr: { kind: "read", read: { kind: "flag", feature: ROW_KEY } } }]
        : evaluating && subjects.length === 1 && subjects[0] === "variable"
          ? [{ expr: { kind: "read", read: { kind: "global", variable: ROW_KEY, path: [] } } }]
          : [];
    const names = read.length
      ? ["key"]
      : [...(subjects.length > 1 ? ["kind"] : []), "key", "description", "owner", "tags"];
    report.columns = [
      ...names.map((name) => ({ expr: { kind: "property" as const, name } })),
      ...read,
    ];
  }

  if (report.group.length || counting) {
    for (const item of selected || []) {
      if (item.expr.kind !== "count" && !groupTexts.has(exprText(item.expr)))
        fail(
          report.group.length
            ? `${exprText(item.expr)} is not in GROUP BY. SELECT what GROUP BY names, and count().`
            : "count() counts groups. Add GROUP BY, such as GROUP BY owner, or SELECT count() alone.",
          item.offset,
        );
    }
  }

  // SORT names a column by its heading, or by an expression of its own
  for (const { item, descending } of sorted) {
    const byHeading = report.columns.find(
      (column) =>
        column.alias !== undefined &&
        (column.alias === item.alias ||
          (item.expr.kind === "property" && column.alias === item.expr.name)),
    );
    if (item.alias !== undefined && !byHeading) {
      fail(
        `No column headed ${item.alias}. SORT names a heading AS gives, or an expression.`,
        item.offset,
      );
      continue;
    }
    if (byHeading) {
      report.sort.push({ column: byHeading, descending } satisfies ReportSort);
      continue;
    }
    if (report.group.length || counting) {
      if (item.expr.kind !== "count" && !groupTexts.has(exprText(item.expr)))
        fail(`SORT a grouped report by what GROUP BY names, or by count().`, item.offset);
    } else if (item.expr.kind === "count") {
      fail("count() counts groups, so it sorts a report with GROUP BY.", item.offset);
      continue;
    } else {
      check(item, "SORT");
    }
    report.sort.push({ column: { expr: item.expr }, descending });
  }

  if (report.as === "matrix") {
    if (!evaluating)
      fail(
        "AS MATRIX shows what people get, so it needs a read, such as SELECT feature(key).",
        matrixOffset!,
      );
    else if (report.group.length || counting)
      fail("AS MATRIX cannot show groups. Leave out one or the other.", matrixOffset!);
  }

  return errors.length ? { errors } : { report, errors };
}
