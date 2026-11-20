import type { Context } from "@featurevisor/types";

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Compares values by what they hold: arrays and plain objects item by item,
 * dates by time, and everything else by identity. A pair already being compared
 * further up counts as equal, so values that contain themselves end.
 */
export function sameValue(first: unknown, second: unknown): boolean {
  return compare(first, second, []);
}

function compare(first: unknown, second: unknown, path: unknown[]): boolean {
  if (Object.is(first, second)) return true;

  if (first instanceof Date && second instanceof Date) {
    return first.getTime() === second.getTime();
  }

  const arrays = Array.isArray(first) && Array.isArray(second);
  if (!arrays && !(isPlainObject(first) && isPlainObject(second))) return false;

  for (let index = 0; index < path.length; index += 2) {
    if (path[index] === first && path[index + 1] === second) return true;
  }
  path.push(first, second);

  try {
    if (arrays) {
      const a = first as unknown[];
      const b = second as unknown[];
      if (a.length !== b.length) return false;
      for (let index = 0; index < a.length; index++) {
        if (!compare(a[index], b[index], path)) return false;
      }
      return true;
    }

    const a = first as Record<string, unknown>;
    const b = second as Record<string, unknown>;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
      if (!hasOwn(b, key) || !compare(a[key], b[key], path)) return false;
    }
    return true;
  } finally {
    path.length -= 2;
  }
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  // Define a __proto__ key, which plain assignment would turn into a prototype change.
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else {
    target[key] = value;
  }
}

/** Thrown inside copies of values that contain themselves, which cannot be copied. */
const CYCLE = {};

function copyWithin<T>(value: T, ancestors: unknown[]): T {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  const array = Array.isArray(value);
  if (!array && !isPlainObject(value)) return value;
  if (ancestors.indexOf(value) !== -1) throw CYCLE;

  ancestors.push(value);
  try {
    if (array) return (value as unknown[]).map((item) => copyWithin(item, ancestors)) as T;

    const copy: Record<string, unknown> = {};
    const source = value as Record<string, unknown>;
    for (const key of Object.keys(source)) setOwn(copy, key, copyWithin(source[key], ancestors));
    return copy as T;
  } finally {
    ancestors.pop();
  }
}

/**
 * A deep copy of arrays, plain objects and dates. Anything else is kept as it
 * is, and so is a value that contains itself, which cannot be copied.
 */
export function copyValue<T>(value: T): T {
  try {
    return copyWithin(value, []);
  } catch (error) {
    if (error === CYCLE) return value;
    throw error;
  }
}

/** A copy for comparing later, or undefined for a value that contains itself. */
export function snapshot<T>(value: T): T | undefined {
  try {
    return copyWithin(value, []);
  } catch (error) {
    if (error === CYCLE) return undefined;
    throw error;
  }
}

/** Freezes arrays and plain objects at every depth. */
export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    Object.freeze(value);
    for (const item of value) deepFreeze(item);
  } else if (isPlainObject(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }

  return value;
}

// Bundlers replace process.env.NODE_ENV. Without one, process may not exist.
declare const process: { env: { NODE_ENV?: string } };

/** Development builds, where bundlers set NODE_ENV to anything but production. */
export function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

/** A browser, where the change count may listen before anything watches. Servers never do. */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * A shallow merge where the second context wins, like the SDK's own merge of
 * instance and call context, including its guard against a __proto__ key.
 */
export function mergeContext(first: Context, second: Context): Context {
  const result: Context = {};
  if (hasOwn(first, "__proto__") || hasOwn(second, "__proto__")) {
    Object.defineProperty(result, "__proto__", {
      value: undefined,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return Object.assign(result, first, second);
}
