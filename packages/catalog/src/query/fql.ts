import { compile } from "@featurevisor/expressions";
import type { Condition } from "@featurevisor/types";

import { ANY_OTHER, type Person } from "./engine";
import {
  DEFINITION_COLUMNS,
  FEATURE_COLUMNS,
  VARIABLE_COLUMNS,
  type Report,
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
  ["punctuation", /^[()[\]{},:*]/],
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

/** Clauses start at their keyword, outside brackets and braces */
function clausesOf(source: string, tokens: FqlToken[]): Clause[] {
  const clauses: Clause[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.type === "punctuation" && "([{".includes(token.text)) depth++;
    if (token.type === "punctuation" && ")]}".includes(token.text)) depth--;
    if (
      depth === 0 &&
      token.type === "keyword" &&
      (CLAUSES as readonly string[]).includes(token.text)
    ) {
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

/**
 * A report from FQL, or the errors that keep it from being one, each at its line and column.
 * Environments are checked against the project's.
 */
export function parseFql(
  source: string,
  project: { environments: string[] },
): { report?: Report; errors: FqlError[] } {
  const errors: FqlError[] = [];
  const fail = (message: string, offset: number) =>
    errors.push({ message, ...position(source, offset) });
  const clauses = clausesOf(source, lexFql(source));

  const firstText = source.replace(/^(\s|#[^\n]*)*/, "");
  if (
    !clauses.length ||
    clauses[0].keyword !== "FROM" ||
    clauses[0].start !== source.length - firstText.length
  ) {
    fail("Start with FROM features or FROM variables.", source.length - firstText.length);
    return { errors };
  }

  const report: Report = {
    of: "features",
    vary: [],
    environments: project.environments.slice(-1),
    show: [],
    as: "table",
  };
  const seen = new Set<string>();
  let selected: Array<{ column: string; offset: number }> | undefined;

  for (const clause of clauses) {
    if (seen.has(clause.keyword) && clause.keyword !== "VARY") {
      fail(`${clause.keyword} appears twice.`, clause.start);
      continue;
    }
    seen.add(clause.keyword);
    const literals = new Literals(clause.text, clause.textStart);
    try {
      if (clause.keyword === "FROM") {
        const table = literals.word();
        if (table !== "features" && table !== "variables")
          throw new Failure(
            "FROM reads features or variables.",
            clause.textStart + clause.text.indexOf(table),
          );
        report.of = table;
      } else if (clause.keyword === "WHERE") {
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
        selected = literals.names().map((column) => ({
          column: column.startsWith("variables.") ? `variable:${column.slice(10)}` : column,
          offset: clause.textStart + clause.text.indexOf(column),
        }));
      } else if (clause.keyword === "AS") {
        const layout = literals.word();
        if (layout !== "TABLE" && layout !== "MATRIX")
          throw new Failure(
            "AS takes TABLE or MATRIX.",
            clause.textStart + clause.text.indexOf(layout),
          );
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
    }
  }

  // Columns a report of this kind has, outcomes only with a person
  const allowed = report.person
    ? report.of === "features"
      ? FEATURE_COLUMNS
      : VARIABLE_COLUMNS
    : ["key", ...DEFINITION_COLUMNS];
  for (const { column, offset } of selected || []) {
    const ok =
      allowed.includes(column) ||
      (report.person && report.of === "features" && column.startsWith("variable:"));
    if (!ok) {
      fail(
        report.person || !FEATURE_COLUMNS.includes(column)
          ? `No column ${column} here. Try ${allowed.join(", ")}${report.person && report.of === "features" ? " or variables.<key>" : ""}.`
          : `${column} is what someone gets, so it needs FOR, such as FOR { country: 'nl' }.`,
        offset,
      );
    }
  }
  report.show = (selected || []).map((item) => item.column).filter((column) => column !== "key");
  if (!selected) {
    report.show = report.person
      ? report.of === "features"
        ? ["enabled"]
        : ["value"]
      : ["description", "owner", "tags"];
  }
  if (report.as === "matrix" && !report.person)
    fail("AS MATRIX needs FOR, since it shows what people get.", source.length);

  return errors.length ? { errors } : { report, errors };
}
