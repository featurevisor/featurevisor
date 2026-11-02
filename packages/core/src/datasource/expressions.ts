import { containsExpression, expandConditions } from "@featurevisor/expressions";
import type { ExpandedExpression, ExpressionOptions } from "@featurevisor/expressions";

import type { ConditionLocation } from "../config";
import { visitConditionLocations, type ConditionPath } from "./conditionLocations";

export type ExpressionEntityType = "segment" | "feature" | "variable";

/** One expression found in a definition, with paths from the definition's root. */
export interface ConditionExpressionRecord extends ExpandedExpression {
  /** Where the `conditions` value holding the string sits. */
  conditionsPath: ConditionPath;
  location: ConditionLocation;
}

const expressionsByDefinition = new WeakMap<object, ConditionExpressionRecord[]>();

/** Expressions the datasource expanded while reading this definition. */
export function getConditionExpressions(definition: unknown): ConditionExpressionRecord[] {
  return (
    (definition && typeof definition === "object" && expressionsByDefinition.get(definition)) || []
  );
}

function formatPath(path: ConditionPath): string {
  return path.join(".") || "(root)";
}

/**
 * A definition holding an expression that does not compile. Reading it fails, as a malformed file does,
 * so nothing builds from a guess. The definition, with every valid expression expanded, stays
 * available for tools that report the errors alongside other diagnostics.
 */
export class ConditionExpressionError extends Error {
  constructor(
    readonly entityType: ExpressionEntityType,
    readonly entityKey: string,
    readonly definition: unknown,
    readonly expressions: ConditionExpressionRecord[],
  ) {
    const lines = expressions.flatMap((expression) =>
      expression.errors.map(
        (error) =>
          `  ${formatPath(expression.path)}: ${error.message}${error.hint ? ` ${error.hint}` : ""} (line ${error.start.line}, column ${error.start.column} of the expression)`,
      ),
    );
    super(
      `Invalid condition expression in ${entityType} "${entityKey}":\n${lines.join("\n")}\nRun featurevisor lint to see each problem in its file.`,
    );
    this.name = "ConditionExpressionError";
  }
}

function setAtPath(root: unknown, path: ConditionPath, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const copy = root.slice();
    copy[head as number] = setAtPath(root[head as number], rest, value);
    return copy;
  }
  const record = root as Record<string, unknown>;
  return { ...record, [head]: setAtPath(record[head as string], rest, value) };
}

/**
 * Expands every expression in a definition's `conditions` into the tree it stands for, so
 * everything that reads definitions sees trees, as if the author had written them. The input
 * is left unchanged. Throws ConditionExpressionError when an expression does not compile.
 */
export function expandConditionExpressions<T>(
  entityType: ExpressionEntityType,
  entityKey: string,
  definition: T,
  options: ExpressionOptions,
): T {
  if (!definition || typeof definition !== "object") return definition;

  const found: { location: ConditionLocation; path: ConditionPath; value: unknown }[] = [];
  visitConditionLocations(entityType, definition, (location, conditions, path) => {
    if (conditions !== undefined && containsExpression(conditions, options)) {
      found.push({ location, path, value: conditions });
    }
  });
  if (found.length === 0) return definition;

  let result: unknown = definition;
  const records: ConditionExpressionRecord[] = [];
  for (const { location, path, value } of found) {
    const expanded = expandConditions(value as never, options);
    result = setAtPath(result, path, expanded.conditions);
    for (const expression of expanded.expressions) {
      records.push({
        ...expression,
        path: [...path, ...expression.path],
        spans: expression.spans.map((span) => ({ ...span, path: [...path, ...span.path] })),
        conditionsPath: path,
        location,
      });
    }
  }

  expressionsByDefinition.set(result as object, records);
  if (records.some((record) => record.errors.length > 0)) {
    throw new ConditionExpressionError(entityType, entityKey, result, records);
  }
  return result as T;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, child) =>
    child && typeof child === "object" && !Array.isArray(child)
      ? Object.fromEntries(
          Object.keys(child)
            .sort()
            .map((key) => [key, child[key]]),
        )
      : child,
  );
}

/**
 * Puts authored expressions back into a definition that was built from expanded reads, such as a
 * promotion result. Each `conditions` value equal to the expansion of an authored expression
 * becomes that authored value again. Everything else stays as it is.
 */
export function restoreConditionExpressions<T>(
  entityType: ExpressionEntityType,
  definition: T,
  authoredDefinitions: unknown[],
  options: ExpressionOptions,
): T {
  const authoredByExpansion = new Map<string, unknown>();
  for (const authored of authoredDefinitions) {
    visitConditionLocations(entityType, authored, (_location, conditions) => {
      if (conditions === undefined || !containsExpression(conditions, options)) return;
      const expanded = expandConditions(conditions as never, options);
      if (!expanded.hasErrors) authoredByExpansion.set(stableJson(expanded.conditions), conditions);
    });
  }
  if (authoredByExpansion.size === 0) return definition;

  let result: unknown = definition;
  visitConditionLocations(entityType, definition, (_location, conditions, path) => {
    if (conditions === undefined) return;
    const authored = authoredByExpansion.get(stableJson(conditions));
    if (authored !== undefined) result = setAtPath(result, path, authored);
  });
  return result as T;
}
