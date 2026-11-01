import type { Conditions } from "@featurevisor/types";

import { compile } from "./compile.js";
import { parse } from "./parser.js";
import { print, sameBuilt } from "./print.js";
import type { ExpressionLogicNode, ExpressionNode, ExpressionOptions } from "./types.js";

export interface ExpressionFormatOptions extends ExpressionOptions {
  /** Spaces before each condition inside parentheses, per level. Defaults to 2. */
  indent?: number;
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

function outer(node: ExpressionNode): { start: number; end: number } {
  return { start: node.outerStart ?? node.start, end: node.outerEnd ?? node.end };
}

function isGroup(node: ExpressionNode): node is ExpressionLogicNode {
  return node.kind === "and" || node.kind === "or";
}

/**
 * The lines of an expression, one condition a line. A group's conditions go between its
 * parentheses, indented a level, and every condition after the first starts with its `and` or
 * `or`. Comment lines go above the condition below them, with any blank line the author wrote
 * before them. Undefined when a comment sits anywhere else, or a condition does not print.
 */
function layOut(
  source: string,
  ast: ExpressionNode,
  options: ExpressionFormatOptions,
): string | undefined {
  const comments = findComments(source);
  const unit = " ".repeat(options.indent ?? 2);
  const lines: string[] = [];
  let next = 0;

  /** The comments between `from` and `start` above the line at `pad`, or false for one before `from` */
  const above = (from: number, start: number, pad: string, blankable: boolean): boolean => {
    const before: Comment[] = [];
    while (next < comments.length && comments[next].start < start) {
      if (comments[next].start < from) return false;
      before.push(comments[next++]);
    }
    const gapEnd = before.length ? before[0].start : start;
    if (blankable && /\n[ \t]*\n/.test(source.slice(from, gapEnd))) lines.push("");
    lines.push(...before.map((comment) => pad + comment.text));
    return true;
  };

  const condition = (node: ExpressionNode): string | undefined => {
    const span = outer(node);
    // a comment inside one condition has no line of its own to go above
    if (next < comments.length && comments[next].start < span.end) return undefined;
    const result = compile(source.slice(span.start, span.end), { ...options, root: false });
    if (result.errors.length || result.conditions === undefined) return undefined;
    return print(result.conditions, { ...options, width: Infinity });
  };

  /** A group's operands, each starting a line at `depth` */
  const chain = (node: ExpressionLogicNode, depth: number, from: number): boolean => {
    const pad = unit.repeat(depth);
    let previousEnd = from;
    for (const [index, child] of node.children.entries()) {
      if (!above(previousEnd, outer(child).start, pad, index > 0)) return false;
      if (!operand(child, depth, index === 0 ? "" : `${node.kind} `)) return false;
      previousEnd = outer(child).end;
    }
    return true;
  };

  /** One operand on a line at `depth` after `lead`, with a group over the lines below it */
  const operand = (node: ExpressionNode, depth: number, lead: string): boolean => {
    const pad = unit.repeat(depth);
    if (node.kind === "not") return operand(node.child, depth, `${lead}not `);
    if (isGroup(node)) {
      lines.push(`${pad}${lead}(`);
      if (!chain(node, depth + 1, node.outerStart ?? node.start)) return false;
      // a comment after a group's last operand has nothing below it to belong to
      if (next < comments.length && comments[next].start < outer(node).end) return false;
      lines.push(`${pad})`);
      return true;
    }
    const text = condition(node);
    if (text === undefined) return false;
    lines.push(`${pad}${lead}${text}`);
    return true;
  };

  // the expression's own group needs no parentheses
  const written = isGroup(ast)
    ? chain(ast, 0, 0)
    : above(0, outer(ast).start, "", false) && operand(ast, 0, "");
  if (!written || next < comments.length) return undefined;
  return lines.join("\n");
}

/**
 * An expression in house style: one condition a line. A single condition stays on one line.
 * With more, every condition after the first starts with its `and` or `or`, and a group's
 * conditions go between its parentheses, indented a level. Whole line comments stay above the
 * condition below them, with any blank line the author wrote before them.
 *
 * Undefined when the expression should stay as written: it has an error, a comment sits
 * anywhere but above a condition, or the result would read back to anything but exactly the
 * same tree, so formatting never changes a datafile.
 */
export function formatExpression(
  source: string,
  options: ExpressionFormatOptions = {},
): string | undefined {
  const root = options.root ?? true;
  const { ast, errors } = parse(source, options);
  if (!ast || errors.length) return undefined;
  const compiled = compile(source, { ...options, root });
  if (compiled.errors.length || compiled.conditions === undefined) return undefined;

  const text = layOut(source, ast, options);
  if (text === undefined) return undefined;

  const read = compile(text, { ...options, root });
  if (read.errors.length || !sameBuilt(read.conditions, compiled.conditions as Conditions)) {
    return undefined;
  }
  return text;
}
