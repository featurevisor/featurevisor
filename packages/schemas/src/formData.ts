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

function setAt(root: Record<string, unknown>, steps: PathStep[], value: unknown): void {
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
      setOwn(holder, key, value);
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

/** Removes the holes that indices leave, keeping the order. */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined).map(compact);
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) setOwn(value, key, compact(value[key]));
  }
  return value;
}

/** Sets `false` for every boolean field an object leaves out, as an unchecked checkbox sends nothing. */
function fillBooleans(
  node: unknown,
  value: unknown,
  resolve: Resolve,
  seen = new Set<unknown>(),
): void {
  const resolved = resolveNode(node, resolve);
  if (!resolved || seen.has(resolved)) return;
  if (Array.isArray(value)) {
    if (resolved.type === "array" && resolved.items !== undefined) {
      for (const item of value) fillBooleans(resolved.items, item, resolve, new Set(seen));
    }
    return;
  }
  if (!isPlainObject(value) || !isPlainObject(resolved.properties)) return;
  seen.add(resolved);
  const properties = resolved.properties;
  for (const key of Object.keys(properties)) {
    const property = properties[key];
    if (getOwn(value, key) === undefined) {
      if (fieldType(property, resolve) === "boolean") setOwn(value, key, false);
    } else {
      fillBooleans(property, value[key], resolve, seen);
    }
  }
}

/**
 * Reads `FormData` or `URLSearchParams` by a schema's types: names such as
 * `address.city` or `items[0].name` nest, a name given several times fills an
 * array field, an empty string is absent, numbers and booleans are read from
 * their text, and names the schema does not describe are left out.
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
    if (raw === "") continue;
    let steps = parsePath(name);
    if (steps.length === 0) continue;

    let field = locate(resolve, node, steps);
    if (!field) continue;

    const resolved = resolveNode(field.node, resolve);
    // A name given several times, or written `tags[]`, fills an array field.
    if (resolved && resolved.type === "array" && steps[steps.length - 1].kind !== "items") {
      steps = [...steps, { kind: "items" }];
      field = locate(resolve, node, steps);
      if (!field) continue;
    }

    setAt(result, steps, readText(raw, fieldType(field.node, resolve)));
  }

  compact(result);
  fillBooleans(node, result, resolve);
  return result;
}
