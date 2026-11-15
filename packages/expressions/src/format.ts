import type { Conditions } from "@featurevisor/types";

import { compile } from "./compile.js";
import { expandConditions } from "./expand.js";
import { parse } from "./parser.js";
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
   * Most items a condition keeps on one line in its list, such as `country in ['nl', 'de']`.
   * A list with more is written one item a line. Defaults to 3.
   */
  listItems?: number;
  /**
   * The longest a condition's line may be with its list on it, counting the indent and the
   * `and`, `or` or `not` before it. Past this, its list is written one item a line, however
   * few items it holds. Defaults to 80.
   */
  width?: number;
}

type ListValue = Extract<ExpressionValue, { type: "list" }>;

/** Comment lines above one item, or above the closing bracket */
interface CommentLines {
  lines: string[];
  /** The author left a blank line before them */
  blank: boolean;
}

/** The comments inside a list, where the author wrote them */
interface ListComments {
  /** Ending the line of the opening bracket */
  open?: string;
  /** Lines above each item, then above the closing bracket */
  above: CommentLines[];
  /** Ending each item's line, after its comma */
  beside: (string | undefined)[];
}

/** The list a condition compares with, as `country in [...]` does */
function listOf(node: ExpressionNode): ListValue | undefined {
  if (node.kind !== "attribute" && node.kind !== "feature" && node.kind !== "variable") return;
  const value = node.comparison?.value;
  return value?.type === "list" ? value : undefined;
}

/**
 * The comments in a list, read from the space between its brackets and items, where nothing
 * but commas, spaces and comments can be. Undefined for one it cannot place.
 */
function readListComments(source: string, list: ListValue): ListComments | undefined {
  const bounds = [
    list.start + 1,
    ...list.items.flatMap((item) => [item.start, item.end]),
    list.end - 1,
  ];
  const comments: ListComments = { above: [], beside: [] };
  for (let gap = 0; gap <= list.items.length; gap++) {
    const [first, ...rest] = source.slice(bounds[2 * gap], bounds[2 * gap + 1]).split("\n");
    // the first line goes on from the bracket or item before the gap
    const beside = first.includes("#") ? first.slice(first.indexOf("#")).trimEnd() : undefined;
    if (gap === 0) comments.open = beside;
    else comments.beside[gap - 1] = beside;

    const above: CommentLines = { lines: [], blank: false };
    for (const line of rest) {
      const text = line.trim();
      if (text.startsWith("#")) above.lines.push(text);
      else if (text === "" && above.lines.length === 0) above.blank = true;
      // a comment after a comma written at the start of a line has nothing to sit beside
      else if (text.includes("#")) return undefined;
    }
    comments.above.push(above);
  }
  return comments;
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

  /**
   * One condition's lines, starting at `pad` after `lead`. A list stays on the condition's line
   * when it has no comments, holds at most `listItems` items and the line fits `width`.
   * Otherwise it takes one item a line, with each comment above or beside its item as written.
   */
  const condition = (node: ExpressionNode, pad: string, lead: string): string[] | undefined => {
    const span = outer(node);
    const list = listOf(node);
    // a comment inside a condition has a line of its own only inside its list
    let commentLines = 0;
    while (next < comments.length && comments[next].start < span.end) {
      const at = comments[next].start;
      if (!list || at < list.start || at >= list.end) return undefined;
      commentLines++;
      next++;
    }
    const result = compile(source.slice(span.start, span.end), { ...options, root: false });
    if (result.errors.length || result.conditions === undefined) return undefined;
    const text = print(result.conditions, { ...options, width: Infinity });
    if (text === undefined) return undefined;
    const line = `${pad}${lead}${text}`;
    if (!list) return [line];

    const leaf = result.conditions as unknown as { value?: unknown };
    const values = Array.isArray(leaf.value) ? leaf.value.map(printValue) : [];
    const listText = `[${values.join(", ")}]`;
    // a comment with nowhere to sit leaves the expression as written
    const notes = readListComments(source, list);
    if (!notes) return undefined;
    const placed = notes.above.reduce((sum, above) => sum + above.lines.length, 0);
    if (placed !== commentLines) return undefined;
    const commented = placed > 0 || notes.open !== undefined || notes.beside.some(Boolean);
    if (values.some((value) => value === undefined) || !text.endsWith(listText)) {
      return commented ? undefined : [line];
    }
    const fits = values.length <= (options.listItems ?? 3) && line.length <= (options.width ?? 80);
    if (!commented && (fits || values.length === 0)) return [line];

    const inner = pad + unit;
    const written = [
      `${pad}${lead}${text.slice(0, -listText.length)}[${notes.open ? ` ${notes.open}` : ""}`,
    ];
    const commentsAbove = (above: CommentLines, first: boolean) => {
      if (above.blank && !first && above.lines.length > 0) written.push("");
      written.push(...above.lines.map((comment) => inner + comment));
    };
    values.forEach((value, index) => {
      commentsAbove(notes.above[index], index === 0);
      const comma = index < values.length - 1 ? "," : "";
      const beside = notes.beside[index];
      written.push(`${inner}${value}${comma}${beside ? ` ${beside}` : ""}`);
    });
    commentsAbove(notes.above[values.length], values.length === 0);
    written.push(`${pad}]`);
    return written;
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
 * A condition's list stays on its line with at most `listItems` items, 3 by default, while the
 * line fits `width`, 80 by default. Otherwise, or when the list holds comments, it is written one
 * item a line, each comment above or beside its item as written.
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
  const { ast, errors, comments } = parse(source, options);
  if (!ast || errors.length) return undefined;
  const compiled = compile(source, { ...options, root });
  if (compiled.errors.length || compiled.conditions === undefined) return undefined;

  const text = layOut(source, ast, options);
  if (text === undefined) return undefined;

  const read = compile(text, { ...options, root });
  if (read.errors.length || !sameBuilt(read.conditions, compiled.conditions as Conditions)) {
    return undefined;
  }
  // every comment kept, in its order, as the tree check cannot tell
  if (JSON.stringify(parse(text, options).comments) !== JSON.stringify(comments)) return undefined;
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
