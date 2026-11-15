import type { Conditions } from "@featurevisor/types";

import { compile } from "./compile.js";
import { expandConditions } from "./expand.js";
import { parse, type ParsedComment } from "./parser.js";
import { print, printValue, printWithNotes, sameBuilt } from "./print.js";
import type {
  ExpressionLogicNode,
  ExpressionNode,
  ExpressionOptions,
  ExpressionPath,
  ExpressionValue,
} from "./types.js";

export interface ExpressionFormatOptions extends ExpressionOptions {
  /** Spaces before each condition inside parentheses, per level. Defaults to 2. */
  indent?: number;
  /**
   * Whether the expression is a whole `conditions` value, where `a and b` reads as a list,
   * rather than an item of a list or a group. Defaults to true.
   */
  root?: boolean;
  /**
   * Most items a list keeps on its condition's line, as `country in ['nl', 'de']` does. A list
   * with more is written one item a line. Defaults to 3.
   */
  listItemsOnOneLine?: number;
  /**
   * The longest a condition's line may be with its list on it, counting the indent and the
   * `and`, `or` or `not` before it. Past this, the list is written one item a line, however
   * few items it holds. Defaults to 80.
   */
  listLineWidth?: number;
}

type ListValue = Extract<ExpressionValue, { type: "list" }>;

/** The list a condition compares with, as `country in [...]` does */
function listOf(node: ExpressionNode): ListValue | undefined {
  if (node.kind !== "attribute" && node.kind !== "feature" && node.kind !== "variable") return;
  const value = node.comparison?.value;
  return value?.type === "list" ? value : undefined;
}

const BLANK_LINE = /\n[ \t]*\n/;

/**
 * A list one item a line, `opening` and its bracket on the first line. Each comment stays where
 * it was written: ending the line of the bracket or item before it, or on a line of its own
 * above the item or bracket after it, with a blank line before it where the author left one.
 * Undefined when two comments end lines between the same two items, which share one line.
 */
function listLines(
  source: string,
  list: ListValue,
  items: string[],
  comments: ParsedComment[],
  opening: string,
  pad: string,
  inner: string,
): string[] | undefined {
  const lines = [`${opening}[`];
  let next = 0;
  /** The comments before `end`, in the gap that starts at `from` */
  const place = (from: number, end: number): boolean => {
    let previous = from;
    let ownLines = 0;
    while (next < comments.length && comments[next].start < end) {
      const comment = comments[next++];
      if (comment.ownLine) {
        // a blank line the author left before a run of comment lines, but never right after `[`
        const gap = source.slice(previous, comment.start);
        if (ownLines === 0 && lines.length > 1 && BLANK_LINE.test(gap)) lines.push("");
        lines.push(inner + comment.text);
        ownLines++;
      } else if (previous === from) lines[lines.length - 1] += ` ${comment.text}`;
      else return false;
      previous = comment.end;
    }
    return true;
  };

  let from = list.start + 1;
  for (const [index, item] of list.items.entries()) {
    if (!place(from, item.start)) return undefined;
    lines.push(`${inner}${items[index]}${index < items.length - 1 ? "," : ""}`);
    from = item.end;
  }
  if (!place(from, list.end)) return undefined;
  return [...lines, `${pad}]`];
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
  comments: ParsedComment[],
  options: ExpressionFormatOptions,
): string | undefined {
  const unit = " ".repeat(options.indent ?? 2);
  const lines: string[] = [];
  let next = 0;

  /** The comments between `from` and `start` above the line at `pad`, or false for one before `from` */
  const above = (from: number, start: number, pad: string, blankable: boolean): boolean => {
    const before: ParsedComment[] = [];
    while (next < comments.length && comments[next].start < start) {
      if (comments[next].start < from) return false;
      before.push(comments[next++]);
    }
    const gapEnd = before.length ? before[0].start : start;
    if (blankable && BLANK_LINE.test(source.slice(from, gapEnd))) lines.push("");
    lines.push(...before.map((comment) => pad + comment.text));
    return true;
  };

  /**
   * One condition's lines, starting at `pad` after `lead`. Its list stays on the line with no
   * comments and at most `listItemsOnOneLine` items, while the line fits `listLineWidth`.
   * Otherwise the list takes one item a line.
   */
  const condition = (node: ExpressionNode, pad: string, lead: string): string[] | undefined => {
    const span = outer(node);
    const list = listOf(node);
    // a comment inside a condition has a place of its own only in its list
    const inList: ParsedComment[] = [];
    while (next < comments.length && comments[next].start < span.end) {
      const comment = comments[next++];
      if (!list || comment.start < list.start || comment.start >= list.end) return undefined;
      inList.push(comment);
    }
    const result = compile(source.slice(span.start, span.end), { ...options, root: false });
    if (result.errors.length || result.conditions === undefined) return undefined;
    const text = print(result.conditions, { ...options, width: Infinity });
    if (text === undefined) return undefined;
    const line = `${pad}${lead}${text}`;
    if (!list) return [line];

    // the condition reads a list, so its leaf holds the list's values
    const items = (result.conditions as { value: unknown[] }).value.map(
      (value) => printValue(value)!,
    );
    const fits =
      items.length <= (options.listItemsOnOneLine ?? 3) &&
      (items.length === 0 || line.length <= (options.listLineWidth ?? 80));
    if (fits && inList.length === 0) return [line];
    // print writes the list last, after the subject and operator
    const listText = `[${items.join(", ")}]`;
    if (!text.endsWith(listText)) return undefined;
    const opening = `${pad}${lead}${text.slice(0, -listText.length)}`;
    return listLines(source, list, items, inList, opening, pad, pad + unit);
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
    const written = condition(node, pad, lead);
    if (written === undefined) return false;
    lines.push(...written);
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
 * A condition's list stays on its line with at most `listItemsOnOneLine` items, 3 by default,
 * while the line fits `listLineWidth`, 80 by default. Otherwise, or when the list holds
 * comments, it is written one item a line, each comment above or beside its item as written.
 *
 * Undefined when the expression should stay as written: it has an error, a comment sits
 * anywhere but above a condition or in a list, or the result would read back to anything but
 * exactly the same tree with every comment, so formatting never changes a datafile.
 */
export function formatExpression(
  source: string,
  options: ExpressionFormatOptions = {},
): string | undefined {
  const root = options.root ?? true;
  const { ast, errors, comments = [] } = parse(source, options);
  if (!ast || errors.length) return undefined;
  const compiled = compile(source, { ...options, root });
  if (compiled.errors.length || compiled.conditions === undefined) return undefined;

  const text = layOut(source, ast, comments, options);
  if (text === undefined) return undefined;

  const read = compile(text, { ...options, root });
  if (read.errors.length || !sameBuilt(read.conditions, compiled.conditions as Conditions)) {
    return undefined;
  }
  // every comment kept, in its order, as the tree check cannot tell
  const texts = (read: ParsedComment[] = []) => JSON.stringify(read.map((comment) => comment.text));
  if (texts(parse(text, options).comments) !== texts(comments)) return undefined;
  return text;
}

/** A comment written inside a condition tree, beside the item at `path` in it. */
export interface TreeComment {
  path: ExpressionPath;
  /** The comment's text after its `#`, over one or more lines */
  text: string;
}

/**
 * A condition tree written as one expression in house style, or undefined when it cannot be.
 * The tree may hold expressions already, as items or group children. Each comment moves above
 * the condition at its path, and a comment at the tree's own path above the whole expression.
 *
 * Undefined when a part has no expression form, such as a disabled feature's variation, a
 * comment sits where no condition starts, or the expression would read back to anything but
 * exactly the tree, key order included, so a datafile cannot change.
 */
export function treeToExpression(
  value: Conditions,
  options: ExpressionFormatOptions & { comments?: TreeComment[] } = {},
): string | undefined {
  const root = options.root ?? true;
  const expanded = expandConditions(value, options);
  if (expanded.hasErrors) return undefined;
  const tree = expanded.conditions;

  const notes = new Map<string, string[]>();
  for (const comment of options.comments ?? []) {
    const key = JSON.stringify(comment.path);
    const lines = comment.text.split("\n").map((line) => `#${line}`);
    notes.set(key, [...(notes.get(key) ?? []), ...lines]);
  }
  const used = new Set<string>();
  const whole = notes.get("[]");
  if (whole) used.add("[]");
  const printed = printWithNotes(tree, notes, used, options);
  if (printed === undefined || used.size !== notes.size) return undefined;

  const source = whole ? `${whole.join("\n")}\n${printed}` : printed;
  const text = formatExpression(source, { ...options, root });
  if (text === undefined) return undefined;
  const read = compile(text, { ...options, root });
  return read.errors.length || !sameBuilt(read.conditions, tree) ? undefined : text;
}
