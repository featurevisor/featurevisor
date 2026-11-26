import type { Context } from "@featurevisor/types";

import { isPlainObject, matchingMutations, mutatedRules, type Resolve } from "./engine.js";
import { assignOwn, hasOwn, type PathStep } from "./paths.js";

type Node = Record<string, unknown>;

/** Applies a node's mutations whose conditions match the value at it and the context. */
export type Adjust = (node: unknown, value: unknown) => unknown;

export function adjuster(resolve: Resolve, context: Context, schema: string): Adjust {
  return (node, value) =>
    isPlainObject(node) && Array.isArray(node.mutations) && node.mutations.length > 0
      ? mutatedRules(
          node as never,
          matchingMutations(node as never, value, context, resolve, schema),
        )
      : node;
}

function childOf(value: unknown, key: string): unknown {
  return isPlainObject(value) && hasOwn(value, key) ? value[key] : undefined;
}

/**
 * A copy of a node with each child mapped: a property with its key, the items
 * and an open object's values with `[]` and `*`, and a `oneOf` branch with none.
 */
function mapChildren(node: Node, map: (child: unknown, key?: string, many?: string) => unknown) {
  const copy = assignOwn({}, node) as Node;
  const { properties, items, additionalProperties, oneOf } = node;
  if (isPlainObject(properties)) {
    const mapped: Node = {};
    for (const key of Object.keys(properties)) mapped[key] = map(properties[key], key);
    copy.properties = mapped;
  }
  if (isPlainObject(items)) copy.items = map(items, undefined, "[]");
  if (isPlainObject(additionalProperties))
    copy.additionalProperties = map(additionalProperties, undefined, "*");
  if (Array.isArray(oneOf)) copy.oneOf = oneOf.map((branch) => map(branch));
  return copy;
}

/**
 * A node's subtree for a value, with the matching mutations applied at every
 * node for the value there. References are inlined, so each use of a schema,
 * such as a billing and a shipping address, resolves for its own value. Items
 * and the values of an open object resolve for no value, since each is its own.
 */
export function resolveTree(
  node: unknown,
  value: unknown,
  adjust: Adjust,
  resolve: Resolve,
  seen: string[] = [],
): unknown {
  const current = adjust(node, value);
  if (!isPlainObject(current)) return current;
  const key = current.schema;
  if (typeof key !== "string") {
    return mapChildren(current, (child, name, many) =>
      resolveTree(
        child,
        many ? undefined : name ? childOf(value, name) : value,
        adjust,
        resolve,
        seen,
      ),
    );
  }
  const target = seen.indexOf(key) === -1 ? resolve(key)?.node : undefined;
  if (!target) return current;
  const inner = resolveTree(target, value, adjust, resolve, [...seen, key]) as Node;
  // The reference's own annotations win over the referenced schema's, as they do outside a view.
  return assignOwn({}, inner, {
    annotations: assignOwn({}, inner.annotations, current.annotations),
  });
}

/** A copy of values with a value at a path, so the fields around it read as they will. `[]` and `*` name no one place. */
export function place(values: unknown, steps: ReadonlyArray<PathStep>, value: unknown): unknown {
  if (steps.length === 0) return value;
  const [step, ...rest] = steps;
  if (step.kind === "key") {
    return assignOwn({}, values, { [step.key]: place(childOf(values, step.key), rest, value) });
  }
  if (step.kind === "index") {
    const list = Array.isArray(values) ? values.slice() : [];
    list[step.index] = place(list[step.index], rest, value);
    return list;
  }
  return values;
}

/** Calls back with the input paths conditions read, in `input` and `valueFrom`, through every group. */
function inputsOf(conditions: unknown, found: (path: unknown) => void): void {
  // Datafiles can carry conditions as JSON text, as features' are.
  if (typeof conditions === "string" && /^[{["]/.test(conditions)) {
    try {
      conditions = JSON.parse(conditions);
    } catch {
      return;
    }
  }
  if (Array.isArray(conditions)) conditions.forEach((item) => inputsOf(item, found));
  if (!isPlainObject(conditions)) return;
  found(conditions.input);
  if (isPlainObject(conditions.valueFrom)) found(conditions.valueFrom.input);
  for (const group of ["and", "or", "not"]) inputsOf(conditions[group], found);
}

/**
 * The fields, relative to a node, that the conditions of its mutations and
 * issues read, at any depth and through references, as `at` takes paths:
 * `accountType`, `address.country` or `items[].room`.
 */
export function readsOf(node: unknown, resolve: Resolve): string[] {
  const reads: string[] = [];
  const visit = (current: unknown, at: string, seen: string[]): unknown => {
    if (!isPlainObject(current)) return;
    const join = (path: string) => (at ? `${at}.${path}` : path);
    for (const list of [current.mutations, current.issues]) {
      if (!Array.isArray(list)) continue;
      for (const entry of list)
        inputsOf(isPlainObject(entry) && entry.conditions, (path) => {
          if (typeof path === "string" && reads.indexOf(join(path)) === -1) reads.push(join(path));
        });
    }
    const key = current.schema;
    if (typeof key === "string" && seen.indexOf(key) === -1)
      visit(resolve(key)?.node, at, [...seen, key]);
    mapChildren(current, (child, name, many) =>
      visit(child, name ? join(name) : many === "[]" ? `${at}[]` : many ? join(many) : at, seen),
    );
  };
  visit(node, "", []);
  return reads;
}
