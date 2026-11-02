import type { Condition, ConditionValue } from "@featurevisor/types";

import { parse } from "./parser.js";
import { createPositionResolver } from "./position.js";
import type {
  ExpressionCompileResult,
  ExpressionLeafNode,
  ExpressionLeafSpan,
  ExpressionNode,
  ExpressionOptions,
  ExpressionPath,
  ExpressionValue,
} from "./types.js";

export interface CompileOptions extends ExpressionOptions {
  /**
   * Whether the expression is a whole `conditions` value. There, `a and b` compiles to a
   * list, as a YAML list would. Elsewhere it compiles to `{ and: [a, b] }`. Defaults to true.
   */
  root?: boolean;
}

function toConditionValue(value: ExpressionValue): ConditionValue {
  switch (value.type) {
    case "list":
      return value.items.map((item) => toConditionValue(item)) as ConditionValue;
    case "regex":
      return value.pattern;
    case "semver":
      return value.version;
    default:
      return value.value;
  }
}

/** Compiles one expression into the condition tree it stands for. */
export function compile(source: string, options: CompileOptions = {}): ExpressionCompileResult {
  const { ast, errors, warnings } = parse(source, options);
  if (!ast) return { spans: [], errors, warnings };

  const resolve = createPositionResolver(source);
  const spans: ExpressionLeafSpan[] = [];
  const range = (start: number, end: number) => ({ start: resolve(start), end: resolve(end) });

  const leaf = (node: ExpressionLeafNode, path: ExpressionPath): Condition => {
    const span: ExpressionLeafSpan = {
      path,
      ...range(node.start, node.end),
      subject: range(node.start, node.kind === "segment" ? node.end : node.subjectEnd),
    };
    const comparison = node.kind === "segment" ? undefined : node.comparison;
    if (comparison) {
      span.operator = range(comparison.operatorStart, comparison.operatorEnd);
      if (comparison.value) span.value = range(comparison.value.start, comparison.value.end);
    }
    spans.push(span);

    switch (node.kind) {
      case "segment":
        return node.segment;
      case "feature":
        if (node.variation !== undefined)
          return { feature: node.feature, variation: node.variation };
        if (node.enabled !== undefined) return { feature: node.feature, enabled: node.enabled };
        return { feature: node.feature };
      case "attribute":
      case "variable": {
        const condition: Record<string, unknown> =
          node.kind === "attribute"
            ? { attribute: node.attribute }
            : {
                ...(node.feature !== undefined ? { feature: node.feature } : {}),
                variable: node.variable,
                ...(node.path.length ? { path: node.path } : {}),
              };
        const { operator, value } = node.comparison;
        condition.operator = operator;
        if (value) {
          condition.value = toConditionValue(value);
          if (value.type === "regex" && value.flags) condition.regexFlags = value.flags;
        }
        return condition as unknown as Condition;
      }
    }
  };

  const visit = (
    node: ExpressionNode,
    path: ExpressionPath,
    root: boolean,
  ): Condition | Condition[] => {
    switch (node.kind) {
      case "and":
        if (root)
          return node.children.map(
            (child, index) => visit(child, [...path, index], false) as Condition,
          );
        return {
          and: node.children.map(
            (child, index) => visit(child, [...path, "and", index], false) as Condition,
          ),
        };
      case "or":
        return {
          or: node.children.map(
            (child, index) => visit(child, [...path, "or", index], false) as Condition,
          ),
        };
      case "not":
        // `not (a and b)` is `{ not: [a, b] }`, the tree's own meaning of not with a list.
        if (node.child.kind === "and") {
          return {
            not: node.child.children.map(
              (child, index) => visit(child, [...path, "not", index], false) as Condition,
            ),
          };
        }
        return { not: [visit(node.child, [...path, "not", 0], false) as Condition] };
      default:
        return leaf(node, path);
    }
  };

  const conditions = visit(ast, [], options.root !== false);
  return { conditions, spans, errors, warnings };
}
