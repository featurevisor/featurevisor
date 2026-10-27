import type { Conditions } from "@featurevisor/types";

import { compile } from "./compile.js";
import { isExpression } from "./keys.js";
import type { FelExpandResult, FelExpression, FelOptions, FelPath } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Replaces every FEL string in a `conditions` value with the tree it compiles to, wherever a
 * string can go: the whole value, list items, and the children of `and`, `or` and `not`.
 * Segment keys and `'*'` stay as they are. The input is never changed. A string with errors
 * is left in place, and its errors are reported with the expression.
 */
export function expandConditions(value: Conditions, options: FelOptions = {}): FelExpandResult {
  const expressions: FelExpression[] = [];

  const visit = (node: unknown, path: FelPath, root: boolean): unknown => {
    if (typeof node === "string") {
      if (!isExpression(node, options)) return node;
      const result = compile(node, { ...options, root });
      expressions.push({
        path,
        source: node,
        spans: result.spans.map((span) => ({ ...span, path: [...path, ...span.path] })),
        errors: result.errors,
        warnings: result.warnings,
      });
      return result.conditions ?? node;
    }
    if (Array.isArray(node)) {
      let changed = false;
      const items = node.map((item, index) => {
        const next = visit(item, [...path, index], false);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? items : node;
    }
    if (isObject(node)) {
      for (const key of ["and", "or", "not"]) {
        if (Object.prototype.hasOwnProperty.call(node, key) && Array.isArray(node[key])) {
          const children = node[key] as unknown[];
          let changed = false;
          const next = children.map((child, index) => {
            const compiled = visit(child, [...path, key, index], false);
            if (compiled !== child) changed = true;
            return compiled;
          });
          return changed ? { ...node, [key]: next } : node;
        }
      }
    }
    return node;
  };

  const conditions = visit(value, [], true) as Conditions;
  return {
    conditions,
    expressions,
    hasErrors: expressions.some((expression) => expression.errors.length > 0),
  };
}

/** Whether a `conditions` value holds any FEL string, without compiling anything. */
export function containsExpression(value: unknown, options: FelOptions = {}): boolean {
  if (typeof value === "string") return isExpression(value, options);
  if (Array.isArray(value)) return value.some((item) => containsExpression(item, options));
  if (isObject(value)) {
    for (const key of ["and", "or", "not"]) {
      if (Array.isArray(value[key])) {
        return (value[key] as unknown[]).some((child) => containsExpression(child, options));
      }
    }
  }
  return false;
}
