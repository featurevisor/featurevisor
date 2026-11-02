import type { Operator } from "@featurevisor/types";

export type Symbol = "==" | "!=" | "<" | "<=" | ">" | ">=";

/** How each operator is written. Typed by every Operator, so a new one needs a spelling here. */
export const OPERATOR_SPELLINGS: Record<
  Operator,
  { form: "symbol"; symbol: Symbol; semver: boolean } | { form: "word" } | { form: "postfix" }
> = {
  equals: { form: "symbol", symbol: "==", semver: false },
  notEquals: { form: "symbol", symbol: "!=", semver: false },
  greaterThan: { form: "symbol", symbol: ">", semver: false },
  greaterThanOrEquals: { form: "symbol", symbol: ">=", semver: false },
  lessThan: { form: "symbol", symbol: "<", semver: false },
  lessThanOrEquals: { form: "symbol", symbol: "<=", semver: false },

  semverEquals: { form: "symbol", symbol: "==", semver: true },
  semverNotEquals: { form: "symbol", symbol: "!=", semver: true },
  semverGreaterThan: { form: "symbol", symbol: ">", semver: true },
  semverGreaterThanOrEquals: { form: "symbol", symbol: ">=", semver: true },
  semverLessThan: { form: "symbol", symbol: "<", semver: true },
  semverLessThanOrEquals: { form: "symbol", symbol: "<=", semver: true },

  contains: { form: "word" },
  notContains: { form: "word" },
  startsWith: { form: "word" },
  endsWith: { form: "word" },
  in: { form: "word" },
  notIn: { form: "word" },
  includes: { form: "word" },
  notIncludes: { form: "word" },
  includesAny: { form: "word" },
  notIncludesAny: { form: "word" },
  matches: { form: "word" },
  notMatches: { form: "word" },
  before: { form: "word" },
  after: { form: "word" },

  exists: { form: "postfix" },
  notExists: { form: "postfix" },
  isNull: { form: "postfix" },
  notNull: { form: "postfix" },
  empty: { form: "postfix" },
  notEmpty: { form: "postfix" },
};

const OPERATORS = Object.keys(OPERATOR_SPELLINGS) as Operator[];

export const WORD_OPERATORS = OPERATORS.filter(
  (operator) => OPERATOR_SPELLINGS[operator].form === "word",
);
export const POSTFIX_OPERATORS = OPERATORS.filter(
  (operator) => OPERATOR_SPELLINGS[operator].form === "postfix",
);

export const SYMBOL_OPERATORS: Record<Symbol, { plain: Operator; semver: Operator }> = {
  "==": { plain: "equals", semver: "semverEquals" },
  "!=": { plain: "notEquals", semver: "semverNotEquals" },
  ">": { plain: "greaterThan", semver: "semverGreaterThan" },
  ">=": { plain: "greaterThanOrEquals", semver: "semverGreaterThanOrEquals" },
  "<": { plain: "lessThan", semver: "semverLessThan" },
  "<=": { plain: "lessThanOrEquals", semver: "semverLessThanOrEquals" },
};

/** Operators whose value is a list. */
export const LIST_OPERATORS: Operator[] = ["in", "notIn", "includesAny", "notIncludesAny"];
/** Operators whose value is text. */
export const TEXT_OPERATORS: Operator[] = [
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "before",
  "after",
];
export const REGEX_OPERATORS: Operator[] = ["matches", "notMatches"];
/**
 * Positive operators with a named negative that differs from `not (...)` for a missing
 * value: the negative returns false, while `not` turns the positive's false into true.
 * `==` and `exists` are left out, since `!=` and `notExists` already match a missing value.
 */
export const NAMED_NEGATIVES: Partial<Record<Operator, Operator>> = {
  in: "notIn",
  contains: "notContains",
  includes: "notIncludes",
  includesAny: "notIncludesAny",
  matches: "notMatches",
  isNull: "notNull",
  empty: "notEmpty",
  semverEquals: "semverNotEquals",
};

export function isOperator(value: string): value is Operator {
  return Object.prototype.hasOwnProperty.call(OPERATOR_SPELLINGS, value);
}

/** Every keyword. A name equal to one cannot be written bare. */
export const KEYWORDS = ["and", "or", "not", "true", "false", "null"];
