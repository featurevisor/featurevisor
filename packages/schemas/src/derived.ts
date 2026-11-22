import { isPlainObject, resolveNode, type Resolve } from "./engine.js";
import type { FieldConstraints } from "./types.js";

type Node = Record<string, unknown>;

/**
 * The branch a nullable field's rules come from: a `oneOf` whose other branches
 * only allow `null`, such as `oneOf: [{ type: string, maxLength: 40 }, { const: null }]`.
 */
function nonNullBranch(node: Node, resolve: Resolve): Node | undefined {
  if (!Array.isArray(node.oneOf)) return node;
  const branches = node.oneOf
    .map((branch) => resolveNode(branch, resolve))
    .filter((branch): branch is NonNullable<typeof branch> => Boolean(branch))
    .filter((branch) => !("const" in branch && branch.const === null));
  return branches.length === 1 ? (branches[0] as Node) : undefined;
}

function isObjectNode(node: Node | undefined): boolean {
  return Boolean(
    node && (node.type === "object" || (!node.type && isPlainObject(node.properties))),
  );
}

function attributesOf(node: unknown, required: boolean, resolve: Resolve): FieldConstraints {
  const constraints: FieldConstraints = {};
  if (required) constraints.required = true;
  const resolved = resolveNode(node, resolve);
  const rules = resolved && nonNullBranch(resolved, resolve);
  if (!rules) return constraints;
  if (rules.type === "string") {
    if (typeof rules.minLength === "number") constraints.minLength = rules.minLength;
    if (typeof rules.maxLength === "number") constraints.maxLength = rules.maxLength;
  } else if (rules.type === "integer" || rules.type === "number") {
    if (typeof rules.minimum === "number") constraints.min = rules.minimum;
    if (typeof rules.maximum === "number") constraints.max = rules.maximum;
    if (rules.type === "integer") constraints.step = 1;
  } else if (rules.type === "array") {
    constraints.multiple = true;
  }
  return constraints;
}

function collectConstraints(
  node: Node,
  prefix: string,
  resolve: Resolve,
  result: Record<string, FieldConstraints>,
  seen: Set<unknown>,
): void {
  if (seen.has(node)) return;
  seen.add(node);
  const properties = isPlainObject(node.properties) ? node.properties : {};
  const required = Array.isArray(node.required) ? (node.required as string[]) : [];
  for (const key of Object.keys(properties)) {
    const path = prefix + key;
    result[path] = attributesOf(properties[key], required.indexOf(key) !== -1, resolve);
    // Nested objects by dot path. Arrays stop here, since a row's handle has constraints of its own.
    const child = resolveNode(properties[key], resolve);
    if (child && isObjectNode(child)) collectConstraints(child, `${path}.`, resolve, result, seen);
  }
}

/** The HTML validation attributes a node's rules imply: by field path for an object, or its own. */
export function getConstraints(
  node: unknown,
  resolve: Resolve,
): Record<string, FieldConstraints> | FieldConstraints {
  const resolved = resolveNode(node, resolve);
  if (resolved && isObjectNode(resolved)) {
    const result: Record<string, FieldConstraints> = {};
    collectConstraints(resolved, "", resolve, result, new Set());
    return result;
  }
  return attributesOf(node, false, resolve);
}

/** The values a node allows by `enum` or `const`, or undefined when it does not list them. */
function valuesOf(
  node: unknown,
  resolve: Resolve,
  seen = new Set<unknown>(),
): unknown[] | undefined {
  const resolved = resolveNode(node, resolve);
  if (!resolved || seen.has(resolved)) return undefined;
  seen.add(resolved);
  if (Array.isArray(resolved.enum)) return resolved.enum as unknown[];
  if ("const" in resolved) return [resolved.const];
  if (Array.isArray(resolved.oneOf)) {
    const values: unknown[] = [];
    for (const branch of resolved.oneOf) {
      const branchValues = valuesOf(branch, resolve, seen);
      if (!branchValues) return undefined;
      for (const value of branchValues) if (values.indexOf(value) === -1) values.push(value);
    }
    return values;
  }
  // A multiple select's choices are its items'.
  if (resolved.type === "array" && resolved.items !== undefined)
    return valuesOf(resolved.items, resolve, seen);
  return undefined;
}

function collectOptions(
  node: Node,
  prefix: string,
  resolve: Resolve,
  result: Record<string, unknown[]>,
  seen: Set<unknown>,
): void {
  if (seen.has(node)) return;
  seen.add(node);
  const properties = isPlainObject(node.properties) ? node.properties : {};
  for (const key of Object.keys(properties)) {
    const path = prefix + key;
    const values = valuesOf(properties[key], resolve);
    if (values) result[path] = values;
    const child = resolveNode(properties[key], resolve);
    if (child && isObjectNode(child)) collectOptions(child, `${path}.`, resolve, result, seen);
  }
}

/** The values a node allows: by field path for an object, or its own list. */
export function getOptions(node: unknown, resolve: Resolve): Record<string, unknown[]> | unknown[] {
  const resolved = resolveNode(node, resolve);
  if (resolved && isObjectNode(resolved)) {
    const result: Record<string, unknown[]> = {};
    collectOptions(resolved, "", resolve, result, new Set());
    return result;
  }
  return valuesOf(node, resolve) || [];
}
