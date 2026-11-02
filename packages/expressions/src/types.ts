import type { Condition, Conditions, Operator } from "@featurevisor/types";

export interface ExpressionOptions {
  /** Joins namespaced keys, such as `countries.netherlands`. Defaults to `.`. */
  namespaceCharacter?: string;
  /** Longest expression accepted, in characters. Defaults to 10,000. */
  maxLength?: number;
  /** Deepest nesting of groups and `not` accepted. Defaults to 64. */
  maxDepth?: number;
}

export type ExpressionSeverity = "error" | "warning";

/** A position inside an expression. Offsets count UTF-16 code units, as JavaScript does. */
export interface ExpressionPosition {
  offset: number;
  /** One based. */
  line: number;
  /** One based. */
  column: number;
}

export interface ExpressionDiagnostic {
  /** Stable, for tools to match on. */
  code: string;
  message: string;
  severity: ExpressionSeverity;
  start: ExpressionPosition;
  end: ExpressionPosition;
  /** A suggestion, when one is obvious. */
  hint?: string;
}

export type ExpressionPath = (string | number)[];

export type ExpressionValue =
  | { type: "string"; value: string; start: number; end: number }
  | { type: "number"; value: number; start: number; end: number }
  | { type: "boolean"; value: boolean; start: number; end: number }
  | { type: "null"; value: null; start: number; end: number }
  | { type: "list"; items: ExpressionValue[]; start: number; end: number }
  | { type: "regex"; pattern: string; flags: string; start: number; end: number }
  | { type: "semver"; version: string; start: number; end: number };

export interface ExpressionComparison {
  operator: Operator;
  /** Where the operator is written. */
  operatorStart: number;
  operatorEnd: number;
  value?: ExpressionValue;
}

interface ExpressionNodeBase {
  start: number;
  end: number;
  /** Written inside parentheses. */
  parenthesized?: boolean;
  /** Where the parentheses start and end, when parenthesized. */
  outerStart?: number;
  outerEnd?: number;
}

export interface ExpressionSegmentNode extends ExpressionNodeBase {
  kind: "segment";
  segment: string;
}

export interface ExpressionAttributeNode extends ExpressionNodeBase {
  kind: "attribute";
  attribute: string;
  subjectEnd: number;
  comparison: ExpressionComparison;
}

export interface ExpressionFeatureNode extends ExpressionNodeBase {
  kind: "feature";
  feature: string;
  subjectEnd: number;
  /** Absent for `feature('x')` alone. */
  enabled?: boolean;
  /** Set for `feature('x').variation == '...'`. */
  variation?: string;
  comparison?: ExpressionComparison;
}

export interface ExpressionVariableNode extends ExpressionNodeBase {
  kind: "variable";
  variable: string;
  /** Set when reading a feature's own variable: `feature('x').label`. */
  feature?: string;
  path: ExpressionPath;
  subjectEnd: number;
  comparison: ExpressionComparison;
}

export interface ExpressionLogicNode extends ExpressionNodeBase {
  kind: "and" | "or";
  children: ExpressionNode[];
}

export interface ExpressionNotNode extends ExpressionNodeBase {
  kind: "not";
  child: ExpressionNode;
}

export type ExpressionLeafNode =
  | ExpressionSegmentNode
  | ExpressionAttributeNode
  | ExpressionFeatureNode
  | ExpressionVariableNode;
export type ExpressionNode = ExpressionLeafNode | ExpressionLogicNode | ExpressionNotNode;

export interface ExpressionParseResult {
  ast?: ExpressionNode;
  errors: ExpressionDiagnostic[];
  warnings: ExpressionDiagnostic[];
}

/** Where one compiled leaf came from in its expression. */
export interface ExpressionLeafSpan {
  /** Path of the leaf inside the compiled conditions. */
  path: ExpressionPath;
  start: ExpressionPosition;
  end: ExpressionPosition;
  /** The name, call or segment the leaf reads. */
  subject: { start: ExpressionPosition; end: ExpressionPosition };
  operator?: { start: ExpressionPosition; end: ExpressionPosition };
  value?: { start: ExpressionPosition; end: ExpressionPosition };
}

export interface ExpressionCompileResult {
  conditions?: Condition | Condition[];
  spans: ExpressionLeafSpan[];
  errors: ExpressionDiagnostic[];
  warnings: ExpressionDiagnostic[];
}

/** One expression found while expanding a `conditions` value. */
export interface ExpandedExpression {
  /** Path of the string inside the `conditions` value it was found in. */
  path: ExpressionPath;
  source: string;
  /** Leaf spans, with paths relative to the `conditions` value. */
  spans: ExpressionLeafSpan[];
  errors: ExpressionDiagnostic[];
  warnings: ExpressionDiagnostic[];
}

export interface ExpressionExpandResult {
  conditions: Conditions;
  expressions: ExpandedExpression[];
  /** True when any expression has an error. */
  hasErrors: boolean;
}

export interface ExpressionPrintOptions extends ExpressionOptions {
  /** Lines longer than this break before each top level `and` or `or`. Defaults to 80. */
  width?: number;
  /**
   * For `toExpressions`: convert only where the expression reads back to exactly the same tree, key
   * order included, so datafiles stay byte identical. When false, also convert where it reads
   * back to a tree that means the same, such as a whole value written as `{ and: [...] }`
   * becoming a list, or `{ feature, enabled: true, variation }` becoming `.variation == ...`.
   * Defaults to true.
   */
  exact?: boolean;
}
