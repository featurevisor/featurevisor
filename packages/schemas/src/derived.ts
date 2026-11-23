import { isConstList, isPlainObject, resolveNode, type Resolve } from "./engine.js";
import type { FieldConstraints, FieldKind, SchemaOption } from "./types.js";

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

/** A node's choices as options, in the order its rules list them. */
function optionsOf(node: unknown, resolve: Resolve): SchemaOption[] | undefined {
  const values = valuesOf(node, resolve);
  return values && values.map((value) => ({ value }));
}

function collectOptions(
  node: Node,
  prefix: string,
  resolve: Resolve,
  result: Record<string, SchemaOption[]>,
  seen: Set<unknown>,
): void {
  if (seen.has(node)) return;
  seen.add(node);
  const properties = isPlainObject(node.properties) ? node.properties : {};
  for (const key of Object.keys(properties)) {
    const path = prefix + key;
    const options = optionsOf(properties[key], resolve);
    if (options) result[path] = options;
    const child = resolveNode(properties[key], resolve);
    if (child && isObjectNode(child)) collectOptions(child, `${path}.`, resolve, result, seen);
  }
}

/** The choices a node allows: by field path for an object, or its own list. */
export function getOptions(
  node: unknown,
  resolve: Resolve,
): Record<string, SchemaOption[]> | SchemaOption[] {
  const resolved = resolveNode(node, resolve);
  if (resolved && isObjectNode(resolved)) {
    const result: Record<string, SchemaOption[]> = {};
    collectOptions(resolved, "", resolve, result, new Set());
    return result;
  }
  return optionsOf(node, resolve) || [];
}

/** What a node's rules make a field, or undefined for a `oneOf` of shapes. */
export function getKind(node: unknown, resolve: Resolve): FieldKind | undefined {
  const resolved = resolveNode(node, resolve);
  if (!resolved) return undefined;
  if (Array.isArray(resolved.enum) || "const" in resolved || isConstList(resolved, resolve))
    return "select";
  if (Array.isArray(resolved.oneOf)) {
    // A nullable field is what its other branch is.
    const rules = nonNullBranch(resolved, resolve);
    return rules ? getKind(rules, resolve) : undefined;
  }
  if (resolved.type === "string")
    return resolved.format === "date-time"
      ? "date-time"
      : resolved.format === "semver"
        ? "version"
        : "text";
  if (resolved.type === "array")
    return getKind(resolved.items, resolve) === "select" ? "multiselect" : "list";
  if (resolved.type === "integer") return "number";
  if (resolved.type === "number" || resolved.type === "boolean") return resolved.type;
  return isObjectNode(resolved) ? "object" : undefined;
}
