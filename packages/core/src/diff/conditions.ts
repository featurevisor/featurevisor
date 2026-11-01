import { isDeepStrictEqual } from "node:util";

import {
  containsExpression,
  expandConditions,
  print,
  type ExpressionOptions,
} from "@featurevisor/expressions";
import type { Conditions } from "@featurevisor/types";

import { visitConditionLocations, type ConditionPath } from "../datasource/conditionLocations";

/**
 * How diff reads and shows conditions. A condition expression and the tree it builds are the
 * same condition, and so are the forms `fmt --simplify` moves between, such as a list of one
 * condition and that condition. A definition that only changes between them is not changed,
 * and a project that writes expressions sees its conditions as expressions.
 */
export interface ConditionsView {
  /** How the project reads expressions */
  options: ExpressionOptions;
  /** Shows trees as expressions too, in a project that allows them */
  expressions: boolean;
}

const KINDS = ["feature", "segment", "variable"];

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A variable path as the list of keys and indexes a dotted path builds */
function withPathLists(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withPathLists);
  if (!isObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] =
      key === "path" && typeof child === "string" && typeof value.variable === "string"
        ? child.split(".").map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part))
        : withPathLists(child);
  }
  return result;
}

/** A group of one `and`, `or` or `not` key over a list, as its key and list */
function groupOf(value: unknown): [string, unknown[]] | undefined {
  if (!isObject(value) || Object.keys(value).length !== 1) return undefined;
  const key = Object.keys(value)[0];
  return ["and", "or", "not"].includes(key) && Array.isArray(value[key])
    ? [key, value[key] as unknown[]]
    : undefined;
}

/**
 * One form for conditions that evaluate the same, as `fmt --simplify` writes them: an `and` or
 * `or` of one condition is that condition, and a whole value's list of one condition, or its
 * `and` group, is that condition or the list it holds.
 */
function simplest(value: unknown, root: boolean): unknown {
  let result: unknown = value;
  const group = groupOf(value);
  if (Array.isArray(value)) result = value.map((item) => simplest(item, false));
  else if (group) result = { [group[0]]: group[1].map((item) => simplest(item, false)) };
  else return value;
  const simplified = groupOf(result);
  if (simplified && simplified[0] !== "not" && simplified[1].length === 1) return simplified[1][0];
  if (root && simplified?.[0] === "and" && simplified[1].length > 1) result = simplified[1];
  if (root && Array.isArray(result) && result.length === 1) return simplest(result[0], true);
  return result;
}

/** The tree a `conditions` value builds, with its expressions expanded, in its simplest form */
function built(value: unknown, view: ConditionsView): unknown {
  if (value === undefined) return value;
  return simplest(
    withPathLists(expandConditions(value as Conditions, view.options).conditions),
    true,
  );
}

/** Whether two `conditions` values build the same tree */
export function sameConditions(before: unknown, after: unknown, view: ConditionsView): boolean {
  return isDeepStrictEqual(built(before, view), built(after, view));
}

/** A definition with every `conditions` value as the tree it builds, for comparing meaning */
export function withBuiltConditions(entity: string, value: unknown, view: ConditionsView) {
  if (!KINDS.includes(entity) || !isObject(value)) return value;
  const paths: ConditionPath[] = [];
  visitConditionLocations(entity as "feature", value, (_location, conditions, path) => {
    if (conditions !== undefined) paths.push(path);
  });
  if (paths.length === 0) return value;
  const copy = structuredClone(value) as Record<string | number, unknown>;
  for (const path of paths) {
    let parent: Record<string | number, unknown> = copy;
    for (const part of path.slice(0, -1)) parent = parent[part] as Record<string | number, unknown>;
    const last = path[path.length - 1];
    parent[last] = built(parent[last], view);
  }
  return copy;
}

/**
 * A `conditions` value on one line: an expression as written without its comment lines, and a
 * tree holding expressions, or any tree in a project that writes them, as an expression. Other
 * trees, and parts with no expression form, are shown as JSON.
 */
export function describeConditions(value: unknown, view: ConditionsView): string {
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .join(" ");
  }
  if (value !== undefined && (view.expressions || containsExpression(value, view.options))) {
    try {
      const tree = expandConditions(value as Conditions, view.options).conditions;
      const text = print(tree, { ...view.options, width: Infinity });
      if (text !== undefined) return text;
    } catch {
      // a tree the printer cannot read is shown as JSON
    }
  }
  return JSON.stringify(value);
}
