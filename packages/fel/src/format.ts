import type { Conditions } from "@featurevisor/types";

import { compile } from "./compile.js";
import { parse } from "./parser.js";
import { print, sameBuilt } from "./print.js";
import type { FelNode, FelOptions } from "./types.js";

export interface FelFormatOptions extends FelOptions {
  /** Expressions longer than this break before each top level `and` or `or`. Defaults to 80. */
  width?: number;
  /**
   * Whether the expression is a whole `conditions` value, where `a and b` reads as a list,
   * rather than an item of a list or a group. Defaults to true.
   */
  root?: boolean;
}

interface Comment {
  start: number;
  text: string;
}

/** Whole line comments, as the parser reads them: lines starting with `#` after spaces. */
function findComments(source: string): Comment[] {
  const comments: Comment[] = [];
  let offset = 0;
  for (const line of source.split("\n")) {
    const text = line.trim();
    if (text.startsWith("#")) comments.push({ start: offset + line.indexOf("#"), text });
    offset += line.length + 1;
  }
  return comments;
}

function outer(node: FelNode): { start: number; end: number } {
  return { start: node.outerStart ?? node.start, end: node.outerEnd ?? node.end };
}

/** One operand on its own, printed as an item of its chain: in parentheses when a group. */
function printOperand(source: string, options: FelFormatOptions): string | undefined {
  const result = compile(source, { ...options, root: false });
  if (result.errors.length || result.conditions === undefined) return undefined;
  const text = print(result.conditions, { ...options, width: Infinity });
  if (text === undefined) return undefined;
  const value = result.conditions as unknown;
  const group =
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ("and" in (value as object) || "or" in (value as object));
  return group ? `(${text})` : text;
}

/**
 * An expression whose comments sit between the operands of its top level `and` or `or`, one
 * operand a line, each below its comments. A blank line the author wrote before an operand or
 * its comments stays. Undefined when a comment sits anywhere else, such as inside an operand.
 */
function formatWithComments(
  source: string,
  ast: FelNode,
  comments: Comment[],
  options: FelFormatOptions,
): string | undefined {
  const chain = (ast.kind === "and" || ast.kind === "or") && !ast.parenthesized;
  const operands = chain ? (ast as { children: FelNode[] }).children : [ast];
  const join = chain ? (ast.kind as "and" | "or") : undefined;

  const lines: string[] = [];
  let next = 0;
  let previousEnd = 0;
  for (const [index, operand] of operands.entries()) {
    const span = outer(operand);
    const before: Comment[] = [];
    while (next < comments.length && comments[next].start < span.start) {
      if (comments[next].start < previousEnd) return undefined;
      before.push(comments[next++]);
    }
    if (next < comments.length && comments[next].start < span.end) return undefined;

    const text = printOperand(source.slice(span.start, span.end), options);
    if (text === undefined) return undefined;
    const gapEnd = before.length ? before[0].start : span.start;
    if (index > 0 && /\n[ \t]*\n/.test(source.slice(previousEnd, gapEnd))) lines.push("");
    lines.push(...before.map((comment) => comment.text));
    lines.push(index === 0 || !join ? text : `${join} ${text}`);
    previousEnd = span.end;
  }
  // a comment after the last operand has nothing below it to belong to
  return next < comments.length ? undefined : lines.join("\n");
}

/**
 * An expression in house style: one line when it fits `width`, and otherwise one top level
 * operand a line, each line after the first starting with its `and` or `or`. Whole line
 * comments stay above the operand below them, with any blank line the author wrote before
 * them, and keep the expression over several lines.
 *
 * Undefined when the expression should stay as written: it has an error, a comment sits
 * inside an operand or after the last one, or the result would read back to anything but
 * exactly the same tree, so formatting never changes a datafile.
 */
export function formatExpression(
  source: string,
  options: FelFormatOptions = {},
): string | undefined {
  const root = options.root ?? true;
  const { ast, errors } = parse(source, options);
  if (!ast || errors.length) return undefined;
  const compiled = compile(source, { ...options, root });
  if (compiled.errors.length || compiled.conditions === undefined) return undefined;

  const comments = findComments(source);
  const text = comments.length
    ? formatWithComments(source, ast, comments, options)
    : print(compiled.conditions, { ...options, width: options.width });
  if (text === undefined) return undefined;

  const read = compile(text, { ...options, root });
  if (read.errors.length || !sameBuilt(read.conditions, compiled.conditions as Conditions)) {
    return undefined;
  }
  return text;
}
