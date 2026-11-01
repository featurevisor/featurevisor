import {
  formatExpression,
  treeToExpression,
  type ExpressionOptions,
} from "@featurevisor/expressions";
import type { FormatComment, FormatLayout, FormatPath } from "@featurevisor/parsers";
import type { Conditions, EntityType } from "@featurevisor/types";

import type { ProjectConfig } from "../config";
import { visitConditionLocations } from "../datasource/conditionLocations";
import {
  expandConditionExpressions,
  ConditionExpressionError,
  getConditionExpressions,
  type ConditionExpressionRecord,
} from "../datasource/expressions";
import { HOUSE_STYLE } from "./style";

/** The options fmt formats expressions with, or undefined when the project does not allow them */
export function getFormatExpressionOptions(config: ProjectConfig): ExpressionOptions | undefined {
  return config.allowConditionExpressions
    ? { namespaceCharacter: config.namespaceCharacter }
    : undefined;
}

/** House style texts of expressions, by the JSON of their path in the definition */
export type ExpressionTexts = Map<string, string>;

function findExpressions(
  entityType: EntityType,
  value: unknown,
  options: ExpressionOptions,
): ConditionExpressionRecord[] {
  if (entityType !== "feature" && entityType !== "segment" && entityType !== "variable") return [];
  try {
    return getConditionExpressions(expandConditionExpressions(entityType, "", value, options));
  } catch (error) {
    // the expressions that compile are formatted, and the others left for lint to report
    if (error instanceof ConditionExpressionError) return error.expressions;
    throw error;
  }
}

/**
 * Each expression in a definition that the house style writes differently, as it would
 * write it. An expression with an error, or one the formatter leaves as written, has none.
 */
export function getExpressionTexts(
  entityType: EntityType,
  value: unknown,
  options: ExpressionOptions,
): ExpressionTexts {
  const texts: ExpressionTexts = new Map();
  for (const record of findExpressions(entityType, value, options)) {
    if (record.errors.length > 0) continue;
    let text = formatExpression(record.source, {
      ...options,
      root: record.path.length === record.conditionsPath.length,
      indent: HOUSE_STYLE.indent,
    });
    if (text === undefined) continue;
    if (HOUSE_STYLE.expressions.finalNewline && text.includes("\n")) text += "\n";
    if (text !== record.source) texts.set(JSON.stringify(record.path), text);
  }
  return texts;
}

/**
 * Where a condition can be written as one expression: each whole `conditions` value, each item
 * of a list, and each child of an `and`, `or` or `not` group, with whether it is a whole value.
 */
function findConditionPositions(entityType: EntityType, value: unknown): Map<string, boolean> {
  const positions = new Map<string, boolean>();
  if (entityType !== "feature" && entityType !== "segment" && entityType !== "variable") {
    return positions;
  }
  const add = (at: FormatPath, node: unknown, root: boolean) => {
    positions.set(JSON.stringify(at), root);
    if (Array.isArray(node)) {
      node.forEach((item, index) => add([...at, index], item, false));
    } else if (node && typeof node === "object") {
      for (const key of ["and", "or", "not"]) {
        const children = (node as Record<string, unknown>)[key];
        if (Array.isArray(children)) {
          children.forEach((child, index) => add([...at, key, index], child, false));
        }
      }
    }
  };
  visitConditionLocations(entityType, value, (_location, conditions, path) => {
    if (conditions !== undefined) add(path, conditions, true);
  });
  return positions;
}

/** What fmt does to a definition's conditions, and what it did, for the guards to check */
export interface ExpressionPlan {
  options?: ExpressionOptions;
  /** House style texts of the expressions written already */
  texts: ExpressionTexts;
  /** Where a tree can be written as an expression, with whether it is a whole value */
  positions: Map<string, boolean>;
  /** The trees written as expressions, by path, with the comments moved into each */
  converted: Map<string, { text: string; comments: FormatComment[] }>;
}

export function emptyExpressionPlan(): ExpressionPlan {
  return { texts: new Map(), positions: new Map(), converted: new Map() };
}

/** The plan for a definition's parsed value, in a project that allows condition expressions */
export function planExpressions(
  entityType: EntityType,
  value: unknown,
  options: ExpressionOptions,
): ExpressionPlan {
  return {
    options,
    texts: getExpressionTexts(entityType, value, options),
    positions: findConditionPositions(entityType, value),
    converted: new Map(),
  };
}

/** The layout's formatText for these texts */
export function formatTextOf(texts: ExpressionTexts) {
  return (path: FormatPath) => texts.get(JSON.stringify(path));
}

/**
 * The layout hooks that write the plan: each expression in the house style, and each
 * condition tree that can be one as an expression, recording each conversion in the plan.
 */
export function applyExpressionPlan(layout: FormatLayout, plan: ExpressionPlan) {
  if (!plan.options) return;
  const options = plan.options;
  if (plan.texts.size > 0) layout.formatText = formatTextOf(plan.texts);
  layout.replaceValue = (path, value, comments) => {
    const key = JSON.stringify(path);
    const root = plan.positions.get(key);
    if (root === undefined) return undefined;
    let text = treeToExpression(value as Conditions, {
      ...options,
      root,
      indent: HOUSE_STYLE.indent,
      comments,
    });
    if (text === undefined) return undefined;
    if (HOUSE_STYLE.expressions.finalNewline && text.includes("\n")) text += "\n";
    plan.converted.set(key, { text, comments });
    return text;
  };
}

function valueAt(value: unknown, path: FormatPath): unknown {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

function setAt(value: unknown, path: FormatPath, replacement: unknown): unknown {
  if (path.length === 0) return replacement;
  const [head, ...rest] = path;
  const copy = (Array.isArray(value) ? [...value] : { ...(value as object) }) as Record<
    string | number,
    unknown
  >;
  copy[head] = setAt(copy[head], rest, replacement);
  return copy;
}

/**
 * The value as formatting should leave it: each expression in the house style and each
 * converted tree as its expression, except where the parser kept a line as written, such as
 * one marked with the ignore comment. Any other difference is a fault the guard catches.
 */
export function withExpressionPlan<T>(value: T, plan: ExpressionPlan, formatted: unknown): T {
  let result: unknown = value;
  const texts: [string, string][] = [
    ...[...plan.converted].map(([key, { text }]) => [key, text] as [string, string]),
    ...plan.texts,
  ];
  for (const [key, text] of texts) {
    const path = JSON.parse(key) as FormatPath;
    if (valueAt(formatted, path) === text && valueAt(result, path) !== undefined) {
      result = setAt(result, path, text);
    }
  }
  return result as T;
}

/** The comment lines the plan's conversions moved into expressions, trimmed as parsers list them */
export function movedComments(plan: ExpressionPlan): string[] {
  return [...plan.converted.values()].flatMap(({ comments }) =>
    comments.flatMap((comment) => comment.text.split("\n").map((line) => line.trim())),
  );
}
