import {
  expandConditions,
  treeToExpression,
  type ExpressionOptions,
  type TreeComment,
} from "@featurevisor/expressions";
import { IGNORE_LINE_COMMENT } from "@featurevisor/parsers";
import type { Conditions } from "@featurevisor/types";
import { isMap, isNode, isScalar, isSeq, Scalar } from "yaml";
import type { Document, Node, Pair } from "yaml";

import { visitConditionLocations, type ConditionPath } from "../datasource/conditionLocations";
import { HOUSE_STYLE } from "../formatter/style";

/**
 * Writes a definition's conditions another way, editing its YAML document so every other line
 * stays as written. convert writes them as expressions or as trees, building exactly the same
 * trees, key order included, so datafiles stay byte identical: a tree becomes an expression
 * only where the expression reads back to that tree, and an expression becomes the tree it
 * builds. fmt's --simplify writes each condition in its simplest form that evaluates the same,
 * which may change a datafile's shape but never what it evaluates to. Comment lines move with
 * the condition they sit above.
 */

export type ConditionKind = "feature" | "segment" | "variable";

export const CONDITION_KINDS: string[] = ["feature", "segment", "variable"];

/** What writing a definition's conditions another way did */
export interface ConditionsResult {
  /** Trees or expressions written the other way */
  changed: number;
  /** Paths of leaves that stay trees, having no expression form */
  kept: ConditionPath[];
  /** Expressions with errors, which have no tree to write */
  invalid: ConditionPath[];
  /** Expressions kept as written with the ignore comment, written as trees all the same */
  unmarked: ConditionPath[];
  /** Comment lines moved from the YAML into expressions, trimmed as parsers list them */
  moved: string[];
}

function emptyResult(): ConditionsResult {
  return { changed: 0, kept: [], invalid: [], unmarked: [], moved: [] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isIgnoreComment(comment: string | null | undefined): boolean {
  return !!comment && comment.trim() === IGNORE_LINE_COMMENT;
}

function keyOf(pair: Pair): string | undefined {
  return isScalar(pair.key) ? String(pair.key.value) : undefined;
}

/** The node at `path` in a document, without resolving scalars to values */
function nodeAt(doc: Document, path: ConditionPath): Node | undefined {
  const node = path.length === 0 ? doc.contents : doc.getIn(path, true);
  return isNode(node) ? node : undefined;
}

/** The pair whose value is the node at `path`, when its parent is a map */
function pairAt(doc: Document, path: ConditionPath): Pair | undefined {
  const parent = nodeAt(doc, path.slice(0, -1));
  if (!isMap(parent)) return undefined;
  return (parent.items as Pair[]).find((pair) => keyOf(pair) === String(path[path.length - 1]));
}

/** Puts `node` in place of the node at `path` */
function replaceAt(doc: Document, path: ConditionPath, node: Node) {
  const parent = nodeAt(doc, path.slice(0, -1));
  const last = path[path.length - 1];
  if (isSeq(parent) && typeof last === "number") parent.items[last] = node;
  else {
    const pair = pairAt(doc, path);
    if (pair) pair.value = node;
  }
}

/**
 * The comments inside a list or map, each at the path of the item it belongs to. A comment on
 * a map's key or on a plain value in it belongs to the map, and so does the comment written on
 * a list or map below a key. `own` adds the node's own comments, at its own path.
 */
function collectComments(node: Node, at: ConditionPath, out: TreeComment[], own: boolean) {
  const add = (comment: string | null | undefined, path: ConditionPath) => {
    if (comment) out.push({ path, text: comment });
  };
  if (own) {
    add(node.commentBefore, at);
    add(node.comment, at);
  }
  if (isSeq(node)) {
    node.items.forEach((item, index) => {
      if (isNode(item)) collectComments(item, [...at, index], out, true);
    });
  } else if (isMap(node)) {
    for (const pair of node.items as Pair[]) {
      if (isScalar(pair.key)) {
        add(pair.key.commentBefore, at);
        add(pair.key.comment, at);
      }
      const value = pair.value;
      if (isMap(value) || isSeq(value)) {
        add(value.commentBefore, at);
        add(value.comment, at);
        collectComments(value, [...at, keyOf(pair) ?? ""], out, false);
      } else if (isNode(value)) {
        add(value.commentBefore, at);
        add(value.comment, at);
      }
    }
  }
}

/** Whether a line inside the value, or the line of its key, is kept as written */
function isKeptAsWritten(doc: Document, path: ConditionPath, node: Node): boolean {
  const comments: TreeComment[] = [];
  collectComments(node, [], comments, true);
  const pair = pairAt(doc, path);
  const key = pair && isScalar(pair.key) ? pair.key : undefined;
  return (
    comments.some((comment) => isIgnoreComment(comment.text)) ||
    isIgnoreComment(key?.comment) ||
    isIgnoreComment(key?.commentBefore)
  );
}

/** Each condition a `conditions` value holds, as a whole value, a list item or a group child */
function eachPosition(
  value: unknown,
  at: ConditionPath,
  root: boolean,
  visit: (value: unknown, at: ConditionPath, root: boolean) => boolean,
) {
  // a condition written as a whole needs none of its parts written
  if (visit(value, at, root)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => eachPosition(item, [...at, index], false, visit));
  } else if (isObject(value) && Object.keys(value).length === 1) {
    for (const key of ["and", "or", "not"]) {
      const children = value[key];
      if (Array.isArray(children)) {
        children.forEach((child, index) => eachPosition(child, [...at, key, index], false, visit));
      }
    }
  }
}

/** Whether a value holds a condition leaf written as a tree, at any depth */
function hasLeaf(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasLeaf);
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  const group = keys.length === 1 && ["and", "or", "not"].includes(keys[0]);
  return group && Array.isArray(value[keys[0]]) ? hasLeaf(value[keys[0]]) : true;
}

/** Whether a value is a condition leaf, rather than a list, a group or a string */
function isLeaf(value: unknown): boolean {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  return !(keys.length === 1 && ["and", "or", "not"].some((key) => Array.isArray(value[key])));
}

/**
 * Writes each condition tree in a definition as an expression, wherever the expression reads
 * back to exactly the tree. The comments inside a tree move above the condition they sat
 * beside. `# featurevisor-ignore-line` keeps a value as written, with everything below it.
 */
export function writeTreesAsExpressions(
  doc: Document,
  kind: ConditionKind,
  definition: unknown,
  options: ExpressionOptions,
  { joinOnly = false }: { joinOnly?: boolean } = {},
): ConditionsResult {
  const result = emptyResult();
  visitConditionLocations(kind, definition, (_location, conditions, path) => {
    if (conditions === undefined) return;
    const top = nodeAt(doc, path);
    if (top && isKeptAsWritten(doc, path, top)) return;

    eachPosition(conditions, path, true, (value, at, root) => {
      if (typeof value === "string" || value === null || typeof value !== "object") return true;
      const node = nodeAt(doc, at);
      if (!node || !(isMap(node) || isSeq(node))) return true;
      if (isKeptAsWritten(doc, at, node)) return true;
      // joining expressions side by side leaves every tree leaf to convert
      if (joinOnly && hasLeaf(value)) return false;

      // a key's value takes its own comments into the expression, a list item keeps them above
      const own = root;
      const comments: TreeComment[] = [];
      collectComments(node, [], comments, own);
      let text = treeToExpression(value as Conditions, {
        ...options,
        root,
        indent: HOUSE_STYLE.indent,
        comments,
      });
      if (text === undefined) {
        if (isLeaf(value)) result.kept.push(at);
        return false;
      }
      if (HOUSE_STYLE.expressions.finalNewline && text.includes("\n")) text += "\n";

      const scalar = new Scalar(text);
      if (text.includes("\n")) scalar.type = Scalar.BLOCK_LITERAL;
      scalar.spaceBefore = node.spaceBefore;
      if (!own) {
        scalar.commentBefore = node.commentBefore;
        scalar.comment = node.comment;
      }
      replaceAt(doc, at, scalar);
      result.changed++;
      for (const comment of comments) {
        result.moved.push(...comment.text.split("\n").map((line) => line.trim()));
      }
      return true;
    });
  });
  return result;
}

/** A group written as a map of one `and`, `or` or `not` key over a list, with its parts */
function groupOf(node: Node) {
  if (!isMap(node) || node.items.length !== 1) return undefined;
  const pair = node.items[0] as Pair;
  const key = keyOf(pair);
  if (!key || !["and", "or", "not"].includes(key) || !isSeq(pair.value)) return undefined;
  return { key, pair, seq: pair.value };
}

/**
 * Puts `to` in place of the node at `path`, which wraps it, carrying the wrappers' comments.
 * Above a whole value they go above its key, where a plain value cannot show them.
 */
function lift(doc: Document, path: ConditionPath, to: Node, wrappers: (Node | unknown)[]) {
  const nodes = wrappers.filter(isNode);
  const before = joinComments(...nodes.map((node) => node.commentBefore), to.commentBefore);
  const after = joinComments(to.comment, ...nodes.map((node) => node.comment));
  to.spaceBefore = nodes[0]?.spaceBefore;
  const key = pairAt(doc, path)?.key;
  if (isScalar(to) && isScalar(key)) {
    key.commentBefore = joinComments(key.commentBefore, before);
    to.commentBefore = undefined;
  } else to.commentBefore = before;
  to.comment = after;
  replaceAt(doc, path, to);
}

/** Simplifies the condition at `path` and the conditions inside it, saying how many changed */
function simplifyNode(doc: Document, path: ConditionPath, root: boolean): number {
  let node = nodeAt(doc, path);
  if (!node || isKeptAsWritten(doc, path, node)) return 0;
  let changed = 0;
  if (isSeq(node)) {
    node.items.forEach((item, index) => {
      if (isNode(item)) changed += simplifyNode(doc, [...path, index], false);
    });
  } else {
    const group = groupOf(node);
    group?.seq.items.forEach((item, index) => {
      if (isNode(item)) changed += simplifyNode(doc, [...path, group.key, index], false);
    });
  }

  // an `and` or `or` of one condition is that condition
  const group = groupOf(node);
  const only = group?.seq.items[0];
  if (group && group.key !== "not" && group.seq.items.length === 1 && isNode(only)) {
    lift(doc, path, only, [node, group.pair.key, group.seq]);
    node = only;
    changed++;
  }
  if (!root) return changed;

  // a whole value's `and` group is the list it holds, and a list of one is that condition,
  // until neither applies, since a list of one can hold an `and` group
  for (;;) {
    const whole = groupOf(node);
    if (whole?.key === "and" && whole.seq.items.length > 1) {
      lift(doc, path, whole.seq, [node, whole.pair.key]);
      node = whole.seq;
      changed++;
      continue;
    }
    const item = isSeq(node) ? node.items[0] : undefined;
    if (isSeq(node) && node.items.length === 1 && isNode(item)) {
      lift(doc, path, item, [node]);
      node = item;
      changed++;
      continue;
    }
    return changed;
  }
}

/** A value's group of one `and`, `or` or `not` key over a list, as its key and list */
function groupIn(value: unknown): [string, unknown[]] | undefined {
  if (!isObject(value) || Object.keys(value).length !== 1) return undefined;
  const key = Object.keys(value)[0];
  return ["and", "or", "not"].includes(key) && Array.isArray(value[key])
    ? [key, value[key] as unknown[]]
    : undefined;
}

/**
 * A `conditions` value in the simplest form that evaluates the same, as `simplifyConditions`
 * writes it, apart from joining expressions: an `and` or `or` of one condition is that
 * condition, and a whole value's list of one condition, or its `and` group, is that condition
 * or the list it holds. Conditions that evaluate the same compare equal in this form.
 */
export function simplestConditions(value: unknown, root = true): unknown {
  let result: unknown = value;
  const group = groupIn(value);
  if (Array.isArray(value)) result = value.map((item) => simplestConditions(item, false));
  else if (group) {
    result = { [group[0]]: group[1].map((item) => simplestConditions(item, false)) };
  } else return value;
  const simplified = groupIn(result);
  if (simplified && simplified[0] !== "not" && simplified[1].length === 1) return simplified[1][0];
  if (root && simplified?.[0] === "and" && simplified[1].length > 1) result = simplified[1];
  if (root && Array.isArray(result) && result.length === 1) {
    return simplestConditions(result[0], true);
  }
  return result;
}

/**
 * Writes each condition in a definition in its simplest form that evaluates the same. A whole
 * value's list of one condition becomes that condition, and its `and` group the list it holds.
 * An `and` or `or` of one condition becomes that condition anywhere. With `expressions`, in a
 * project that allows them, expressions side by side then join into one, where it builds
 * exactly the same tree. Tree leaves stay trees. `# featurevisor-ignore-line` keeps a value as
 * written, with everything below it.
 */
export function simplifyConditions(
  doc: Document,
  kind: ConditionKind,
  definition: unknown,
  expressions?: ExpressionOptions,
): ConditionsResult {
  const result = emptyResult();
  visitConditionLocations(kind, definition, (_location, conditions, path) => {
    if (conditions !== undefined) result.changed += simplifyNode(doc, path, true);
  });
  if (expressions) {
    const joined = writeTreesAsExpressions(doc, kind, doc.toJS(), expressions, { joinOnly: true });
    result.changed += joined.changed;
    result.moved.push(...joined.moved);
  }
  return result;
}

/** Whole line comments in an expression, with where each starts */
function commentLines(source: string): { offset: number; text: string }[] {
  const comments: { offset: number; text: string }[] = [];
  let offset = 0;
  for (const line of source.split("\n")) {
    const text = line.trim();
    if (text.startsWith("#")) comments.push({ offset: offset + line.indexOf("#"), text });
    offset += line.length + 1;
  }
  return comments;
}

/** The node at `path` inside a node made for a tree */
function nodeInside(node: Node, path: ConditionPath): Node | undefined {
  let current: unknown = node;
  for (const part of path) {
    if (isSeq(current) && typeof part === "number") current = current.items[part];
    else if (isMap(current)) {
      current = (current.items as Pair[]).find((pair) => keyOf(pair) === String(part))?.value;
    } else return undefined;
  }
  return isNode(current) ? current : undefined;
}

/**
 * A tree with each variable path as the dotted text that builds the same path, as authors write
 * it, such as `routing.enabled`. A path whose keys hold a dot, or a key made of digits that a
 * dotted path would read as an index, stays a list.
 */
function withDottedPaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withDottedPaths);
  if (!isObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const dotted =
      key === "path" &&
      typeof value.variable === "string" &&
      Array.isArray(child) &&
      child.length > 0 &&
      child.every(
        (part) =>
          (typeof part === "number" && Number.isInteger(part) && part >= 0) ||
          (typeof part === "string" &&
            part !== "" &&
            !part.includes(".") &&
            !/^(0|[1-9]\d*)$/.test(part)),
      );
    result[key] = dotted ? (child as unknown[]).join(".") : withDottedPaths(child);
  }
  return result;
}

function joinComments(...comments: (string | null | undefined)[]): string | undefined {
  const joined = comments.filter(Boolean).join("\n");
  return joined || undefined;
}

/**
 * Writes each expression in a definition as the tree it builds. Each comment line inside an
 * expression goes above the condition below it, and an expression with an error stays as
 * written, reported in `invalid`.
 */
export function writeExpressionsAsTrees(
  doc: Document,
  kind: ConditionKind,
  definition: unknown,
  options: ExpressionOptions,
): ConditionsResult {
  const result = emptyResult();
  visitConditionLocations(kind, definition, (_location, conditions, path) => {
    if (conditions === undefined) return;
    const expanded = expandConditions(conditions as Conditions, options);
    for (const expression of expanded.expressions) {
      const at = [...path, ...expression.path];
      if (expression.errors.length > 0) {
        result.invalid.push(at);
        continue;
      }
      const written = nodeAt(doc, at);
      if (!written) continue;
      let tree: unknown = expanded.conditions;
      for (const part of expression.path) tree = (tree as Record<string | number, unknown>)[part];

      const node = doc.createNode(withDottedPaths(tree)) as Node;
      // each comment above the first condition after it, in the tree's own terms
      const spans = [...expression.spans].sort((a, b) => a.start.offset - b.start.offset);
      for (const comment of commentLines(expression.source)) {
        const next = spans.find((span) => span.start.offset > comment.offset);
        const target = next ? nodeInside(node, next.path.slice(expression.path.length)) : undefined;
        const text = comment.text.slice(1);
        if (target) target.commentBefore = joinComments(target.commentBefore, text);
        else node.comment = joinComments(node.comment, text);
      }
      // an expression kept as written with the ignore comment is written as a tree all the same,
      // since the project stops allowing expressions, so the comment has nothing left to keep
      const own = (comment: string | null | undefined) =>
        isIgnoreComment(comment) ? undefined : comment;
      if (isIgnoreComment(written.comment) || isIgnoreComment(written.commentBefore)) {
        result.unmarked.push(at);
      }
      node.commentBefore = joinComments(own(written.commentBefore), node.commentBefore);
      node.spaceBefore = written.spaceBefore;
      node.comment = joinComments(node.comment, own(written.comment));
      replaceAt(doc, at, node);
      result.changed++;
    }
  });
  return result;
}
