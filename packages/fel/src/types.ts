import type { Condition, Conditions, Operator } from "@featurevisor/types";

export interface FelOptions {
  /** Joins namespaced keys, such as `countries.netherlands`. Defaults to `.`. */
  namespaceCharacter?: string;
  /** Longest expression accepted, in characters. Defaults to 10,000. */
  maxLength?: number;
  /** Deepest nesting of groups and `not` accepted. Defaults to 64. */
  maxDepth?: number;
}

export type FelSeverity = "error" | "warning";

/** A position inside an expression. Offsets count UTF-16 code units, as JavaScript does. */
export interface FelPosition {
  offset: number;
  /** One based. */
  line: number;
  /** One based. */
  column: number;
}

export interface FelError {
  /** Stable, for tools to match on. */
  code: string;
  message: string;
  severity: FelSeverity;
  start: FelPosition;
  end: FelPosition;
  /** A suggestion, when one is obvious. */
  hint?: string;
}

export type FelPath = (string | number)[];

export type FelValue =
  | { type: "string"; value: string; start: number; end: number }
  | { type: "number"; value: number; start: number; end: number }
  | { type: "boolean"; value: boolean; start: number; end: number }
  | { type: "null"; value: null; start: number; end: number }
  | { type: "list"; items: FelValue[]; start: number; end: number }
  | { type: "regex"; pattern: string; flags: string; start: number; end: number }
  | { type: "semver"; version: string; start: number; end: number };

export interface FelComparison {
  operator: Operator;
  /** Where the operator is written. */
  operatorStart: number;
  operatorEnd: number;
  value?: FelValue;
}

interface FelNodeBase {
  start: number;
  end: number;
  /** Written inside parentheses. */
  parenthesized?: boolean;
  /** Where the parentheses start and end, when parenthesized. */
  outerStart?: number;
  outerEnd?: number;
}

export interface FelSegmentNode extends FelNodeBase {
  kind: "segment";
  segment: string;
}

export interface FelAttributeNode extends FelNodeBase {
  kind: "attribute";
  attribute: string;
  subjectEnd: number;
  comparison: FelComparison;
}

export interface FelFeatureNode extends FelNodeBase {
  kind: "feature";
  feature: string;
  subjectEnd: number;
  /** Absent for `feature('x')` alone. */
  enabled?: boolean;
  /** Set for `feature('x').variation == '...'`. */
  variation?: string;
  comparison?: FelComparison;
}

export interface FelVariableNode extends FelNodeBase {
  kind: "variable";
  variable: string;
  /** Set when reading a feature's own variable: `feature('x').label`. */
  feature?: string;
  path: FelPath;
  subjectEnd: number;
  comparison: FelComparison;
}

export interface FelLogicNode extends FelNodeBase {
  kind: "and" | "or";
  children: FelNode[];
}

export interface FelNotNode extends FelNodeBase {
  kind: "not";
  child: FelNode;
}

export type FelLeafNode = FelSegmentNode | FelAttributeNode | FelFeatureNode | FelVariableNode;
export type FelNode = FelLeafNode | FelLogicNode | FelNotNode;

export interface FelParseResult {
  ast?: FelNode;
  errors: FelError[];
  warnings: FelError[];
}

/** Where one compiled leaf came from in its expression. */
export interface FelLeafSpan {
  /** Path of the leaf inside the compiled conditions. */
  path: FelPath;
  start: FelPosition;
  end: FelPosition;
  /** The name, call or segment the leaf reads. */
  subject: { start: FelPosition; end: FelPosition };
  operator?: { start: FelPosition; end: FelPosition };
  value?: { start: FelPosition; end: FelPosition };
}

export interface FelCompileResult {
  conditions?: Condition | Condition[];
  spans: FelLeafSpan[];
  errors: FelError[];
  warnings: FelError[];
}

/** One expression found while expanding a `conditions` value. */
export interface FelExpression {
  /** Path of the string inside the `conditions` value it was found in. */
  path: FelPath;
  source: string;
  /** Leaf spans, with paths relative to the `conditions` value. */
  spans: FelLeafSpan[];
  errors: FelError[];
  warnings: FelError[];
}

export interface FelExpandResult {
  conditions: Conditions;
  expressions: FelExpression[];
  /** True when any expression has an error. */
  hasErrors: boolean;
}

export interface FelPrintOptions extends FelOptions {
  /** Lines longer than this break before each top level `and` or `or`. Defaults to 80. */
  width?: number;
  /**
   * For `toFel`: convert only where the expression reads back to exactly the same tree, key
   * order included, so datafiles stay byte identical. When false, also convert where it reads
   * back to a tree that means the same, such as a whole value written as `{ and: [...] }`
   * becoming a list, or `{ feature, enabled: true, variation }` becoming `.variation == ...`.
   * Defaults to true.
   */
  exact?: boolean;
}
