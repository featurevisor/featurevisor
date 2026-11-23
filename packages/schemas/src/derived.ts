import {
  annotationsOf,
  isConstList,
  isPlainObject,
  optionEntry,
  resolveNode,
  type Resolve,
} from "./engine.js";
import { assignOwn } from "./paths.js";
import type { FieldConstraints, FieldKind, SchemaOption } from "./types.js";

type Node = Record<string, unknown>;

/** What a handle has when the datafile lacks its schema or its field: no constraints and no options. */
export const EMPTY: Readonly<Record<string, never>> = Object.freeze({});
export const EMPTY_LIST: ReadonlyArray<never> = Object.freeze([] as never[]);

/**
 * The branch a nullable field's rules come from: a `oneOf` whose other branches
 * only allow `null`, such as `oneOf: [{ type: string, maxLength: 40 }, { const: null }]`.
 */
export function nonNullBranch(node: Node, resolve: Resolve): Node | undefined {
  if (!Array.isArray(node.oneOf)) return node;
  const branches = node.oneOf
    .map((branch) => resolveNode(branch, resolve))
    .filter((branch): branch is NonNullable<typeof branch> => Boolean(branch))
    .filter((branch) => !("const" in branch && branch.const === null));
  return branches.length === 1 ? (branches[0] as Node) : undefined;
}

export function isObjectNode(node: Node | undefined): boolean {
  return Boolean(
    node && (node.type === "object" || (!node.type && isPlainObject(node.properties))),
  );
}

/** Whether a node takes `null`: a `const: null`, an `enum` listing it, or a `oneOf` branch that does. */
export function takesNull(node: unknown, resolve: Resolve, seen = new Set<unknown>()): boolean {
  const resolved = resolveNode(node, resolve);
  if (!resolved || seen.has(resolved)) return false;
  seen.add(resolved);
  if ("const" in resolved) return resolved.const === null;
  if (Array.isArray(resolved.enum)) return resolved.enum.indexOf(null) !== -1;
  return (
    Array.isArray(resolved.oneOf) &&
    resolved.oneOf.some((branch) => takesNull(branch, resolve, seen))
  );
}

/** Whether a choice is between booleans, such as `const: true` for accepting terms. */
function isBooleanChoice(values: unknown[] | undefined): values is boolean[] {
  return Boolean(
    values &&
    values.some((value) => typeof value === "boolean") &&
    values.every((value) => typeof value === "boolean" || value === null),
  );
}

/**
 * Whether an input left empty fails a field's rules, as `required` tells a
 * browser. An unchecked box reads as `false` and a required list with nothing
 * chosen as `[]`, so each passes unless its rules say otherwise. A nullable
 * field, which reads it as `null`, never reaches here.
 */
function emptyFails(rules: Node, resolve: Resolve): boolean {
  if (rules.type === "boolean") return false;
  if (rules.type === "array") return Number(rules.minItems) > 0;
  const values = valuesOf(rules, resolve);
  return !isBooleanChoice(values) || values.indexOf(false) < 0;
}

function attributesOf(node: unknown, required: boolean, resolve: Resolve): FieldConstraints {
  const constraints: FieldConstraints = {};
  const resolved = resolveNode(node, resolve);
  const rules = resolved && nonNullBranch(resolved, resolve);
  if (required && !takesNull(resolved, resolve) && (!rules || emptyFails(rules, resolve)))
    constraints.required = true;
  if (!rules) return Object.freeze(constraints);
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
  return Object.freeze(constraints);
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
    return Object.freeze(result);
  }
  return attributesOf(node, false, resolve);
}

/**
 * A node's choices in the order its rules list them, each as its value with
 * what the schema says about it: an `enum` value's entry in the `options`
 * annotation beside it, or a `const` branch's own annotations in a `oneOf` of
 * consts. Undefined when the node lists no choices. A multiple select's
 * choices are its items'.
 */
function choicesOf(
  node: unknown,
  resolve: Resolve,
  branch = false,
  seen = new Set<unknown>(),
): ReadonlyArray<SchemaOption> | undefined {
  const resolved = resolveNode(node, resolve);
  if (!resolved || seen.has(resolved)) return undefined;
  seen.add(resolved);
  // Frozen, since every caller shares them. Values and the entries' values stay the datafile's own.
  // `value` comes first, as a console shows it, and again last, so an entry can never replace it.
  const choice = (value: unknown, entry: Node | undefined) =>
    Object.freeze(assignOwn({ value }, entry, { value })) as SchemaOption;
  if (Array.isArray(resolved.enum))
    return resolved.enum.map((value) => choice(value, optionEntry(resolved, value)));
  if ("const" in resolved)
    return [choice(resolved.const, branch ? annotationsOf(node, resolve) : undefined)];
  if (Array.isArray(resolved.oneOf)) {
    // Only a list of choices gives its branches' annotations to the choices. Any other branch's are a field's.
    const list = isConstList(resolved, resolve);
    const choices: SchemaOption[] = [];
    for (const each of resolved.oneOf) {
      const found = choicesOf(each, resolve, list, seen);
      if (!found) return undefined;
      for (const option of found)
        if (!choices.some((other) => other.value === option.value)) choices.push(option);
    }
    return choices;
  }
  if (resolved.type === "array" && resolved.items !== undefined)
    return choicesOf(resolved.items, resolve, false, seen);
  return undefined;
}

function valuesOf(node: unknown, resolve: Resolve): unknown[] | undefined {
  return choicesOf(node, resolve)?.map((option) => option.value);
}

/** A node's choices as options, frozen. */
function optionsOf(node: unknown, resolve: Resolve): ReadonlyArray<SchemaOption> | undefined {
  const choices = choicesOf(node, resolve);
  return choices && Object.freeze(choices);
}

/** The keys of an object's fields, the ones its `order` lists first, then the rest, here as written, which nothing promises. */
export function fieldKeys(node: unknown, resolve: Resolve): string[] {
  const resolved = resolveNode(node, resolve);
  if (!resolved || !isPlainObject(resolved.properties)) return [];
  const keys = Object.keys(resolved.properties);
  const order = annotationsOf(node, resolve)?.order;
  const first = Array.isArray(order)
    ? order.filter((key, index) => keys.indexOf(key) !== -1 && order.indexOf(key) === index)
    : [];
  return first.concat(keys.filter((key) => first.indexOf(key) === -1));
}

/** A node's annotations, over those of a schema it references, frozen. */
export function getAnnotations(node: unknown, resolve: Resolve): Readonly<Record<string, unknown>> {
  return Object.freeze(assignOwn({}, annotationsOf(node, resolve)));
}

function collectOptions(
  node: Node,
  prefix: string,
  resolve: Resolve,
  result: Record<string, ReadonlyArray<SchemaOption>>,
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
): Readonly<Record<string, ReadonlyArray<SchemaOption>>> | ReadonlyArray<SchemaOption> {
  const resolved = resolveNode(node, resolve);
  if (resolved && isObjectNode(resolved)) {
    const result: Record<string, ReadonlyArray<SchemaOption>> = {};
    collectOptions(resolved, "", resolve, result, new Set());
    return Object.freeze(result);
  }
  return optionsOf(node, resolve) || EMPTY_LIST;
}

/** What a node's rules make a field, or undefined for a `oneOf` of shapes. */
export function getKind(node: unknown, resolve: Resolve): FieldKind | undefined {
  const resolved = resolveNode(node, resolve);
  if (!resolved) return undefined;
  if (Array.isArray(resolved.enum) || "const" in resolved || isConstList(resolved, resolve))
    return isBooleanChoice(valuesOf(resolved, resolve)) ? "boolean" : "select";
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
