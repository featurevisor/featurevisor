import { isObjectNode, nonNullBranch, takesNull } from "./derived.js";
import { isPlainObject, resolveNode, type Resolve } from "./engine.js";
import { hasOwn, parsePath, setOwn, type PathStep } from "./paths.js";
import { locate } from "./store.js";

type Container = Record<string, unknown> | unknown[];

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** The one kind every listed value has, so `enum: [1, 2]` reads as a number, or undefined. */
function listedType(values: unknown[]): string | undefined {
  const kinds = values.filter((value) => value !== null).map((value) => typeof value);
  if (kinds.length === 0 || kinds.some((kind) => kind !== kinds[0])) return undefined;
  return kinds[0] === "number" || kinds[0] === "boolean" ? kinds[0] : undefined;
}

/** The rules a field's text is read by: a nullable field's are its other branch's. */
function fieldType(node: unknown, resolve: Resolve): string | undefined {
  const resolved = resolveNode(node, resolve);
  if (!resolved) return undefined;
  if (typeof resolved.type === "string") return resolved.type;
  if (Array.isArray(resolved.enum)) return listedType(resolved.enum);
  if ("const" in resolved) return listedType([resolved.const]);
  if (Array.isArray(resolved.oneOf)) {
    const types = resolved.oneOf
      .map((branch) => resolveNode(branch, resolve))
      .filter((branch) => branch && !("const" in branch && branch.const === null))
      .map((branch) => branch!.type);
    if (types.length === 1 && typeof types[0] === "string") return types[0];
  }
  return undefined;
}

/** Text from a form, read by the type it fills. A file stays as it is. */
function readText(raw: FormDataEntryValue, type: string | undefined): unknown {
  if (typeof raw !== "string") return raw;
  if (type === "integer" || type === "number") {
    const trimmed = raw.trim();
    return NUMBER.test(trimmed) ? Number(trimmed) : raw;
  }
  if (type === "boolean") {
    if (raw === "on" || raw === "true") return true;
    if (raw === "false") return false;
  }
  return raw;
}

function getOwn(holder: Record<string | number, unknown>, key: string | number): unknown {
  return hasOwn(holder, key) ? holder[key] : undefined;
}

/** Sets a value at a path, making the objects and arrays on the way. With `keep`, an existing value stays. */
function setAt(
  root: Record<string, unknown>,
  steps: PathStep[],
  value: unknown,
  keep?: boolean,
): void {
  let container: Container = root;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const last = index === steps.length - 1;
    const next = steps[index + 1];
    const makeChild = (): Container =>
      next && (next.kind === "index" || next.kind === "items") ? [] : {};

    if (step.kind === "items") {
      const list = container as unknown[];
      if (last) list.push(value);
      else {
        const child = makeChild();
        list.push(child);
        container = child;
      }
      continue;
    }

    const key = step.kind === "index" ? step.index : step.kind === "key" ? step.key : "*";
    const holder = container as Record<string | number, unknown>;
    if (last) {
      if (!keep || getOwn(holder, key) === undefined) setOwn(holder, key, value);
    } else {
      const existing = getOwn(holder, key);
      const child = (
        typeof existing === "object" && existing !== null ? existing : makeChild()
      ) as Container;
      setOwn(holder, key, child);
      container = child;
    }
  }
}

/** Keeps the row an empty input sits in, so the rows after it keep their indices. */
function keepRow(
  root: Record<string, unknown>,
  steps: PathStep[],
  node: unknown,
  resolve: Resolve,
): void {
  for (let end = steps.length - 1; end >= 0; end--) {
    if (steps[end].kind !== "index") continue;
    const row = steps.slice(0, end + 1);
    const located = locate(resolve, node, row);
    if (located && isObjectNode(resolveNode(located.node, resolve))) {
      setAt(root, row, {}, true);
      return;
    }
  }
}

/**
 * Settles a value read from a form by its schema. A row of objects no input
 * named reads as `{}`, so every row keeps its index, while other lists close
 * their gaps. An unchecked box reads as `false`, and a required list with
 * nothing chosen as `[]`, since neither sends anything.
 */
function settle(node: unknown, value: unknown, resolve: Resolve): unknown {
  const resolved = resolveNode(node, resolve);
  const rules = resolved && nonNullBranch(resolved, resolve);
  if (Array.isArray(value)) {
    const items = rules && rules.type === "array" ? rules.items : undefined;
    const rows = isObjectNode(resolveNode(items, resolve));
    const list: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      if (value[index] !== undefined || rows)
        list.push(settle(items, value[index] === undefined ? {} : value[index], resolve));
    }
    return list;
  }
  if (!isPlainObject(value) || !rules) return value;
  const properties = isPlainObject(rules.properties) ? rules.properties : {};
  const required = Array.isArray(rules.required) ? (rules.required as string[]) : [];
  for (const key of Object.keys(value)) {
    const child = hasOwn(properties, key) ? properties[key] : rules.additionalProperties;
    setOwn(value, key, settle(child, value[key], resolve));
  }
  for (const key of Object.keys(properties)) {
    if (getOwn(value, key) !== undefined) continue;
    const type = fieldType(properties[key], resolve);
    if (type === "boolean") setOwn(value, key, false);
    else if (type === "array" && required.indexOf(key) !== -1) setOwn(value, key, []);
  }
  return value;
}

/**
 * Reads `FormData` or `URLSearchParams` by a schema's types: names such as
 * `address.city` or `items[0].name` nest, a name given several times fills an
 * array field, an empty string is absent, or `null` for a nullable field,
 * numbers and booleans are read from their text, and names the schema does
 * not describe are left out.
 */
export function readFormData(
  node: unknown,
  data: FormData | URLSearchParams,
  resolve: Resolve,
): unknown {
  const result: Record<string, unknown> = {};
  const entries = (
    data as unknown as { entries(): Iterable<[string, FormDataEntryValue]> }
  ).entries();

  for (const [name, raw] of entries) {
    let steps = parsePath(name);
    if (steps.length === 0) continue;

    let field = locate(resolve, node, steps);
    if (!field) continue;

    if (raw === "") {
      // Clearing a nullable field is how a form sets it to null.
      if (takesNull(field.node, resolve) && fieldType(field.node, resolve) !== "array")
        setAt(result, steps, null);
      else keepRow(result, steps, node, resolve);
      continue;
    }

    const resolved = resolveNode(field.node, resolve);
    // A name given several times, or written `tags[]`, fills an array field.
    if (resolved && resolved.type === "array" && steps[steps.length - 1].kind !== "items") {
      steps = [...steps, { kind: "items" }];
      field = locate(resolve, node, steps);
      if (!field) continue;
    }

    setAt(result, steps, readText(raw, fieldType(field.node, resolve)));
  }

  return settle(node, result, resolve);
}
