import { inject, type InjectionKey, type Ref } from "vue";
import type { Context } from "@featurevisor/types";

import { readContext, type ContextSource } from "./live.js";

/** The merged context of the enclosing scopes, provided by FeaturevisorScope. */
export const SCOPE: InjectionKey<Readonly<Ref<Context>>> = Symbol("featurevisor scope");

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * A shallow merge where the second context wins, like the SDK's own merge of
 * instance and call context, including its guard against a __proto__ key.
 */
export function mergeContext(first: Context, second: Context): Context {
  const result: Context = {};
  // Define the own key before assigning so it cannot invoke the prototype setter.
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Compares context values by what they hold. Attribute values are strings,
 * numbers, booleans, dates, arrays and plain objects, so an inline context with
 * nested objects is equal to the one before it when its values are.
 */
export function sameValue(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;

  if (first instanceof Date && second instanceof Date) {
    return first.getTime() === second.getTime();
  }

  if (Array.isArray(first) && Array.isArray(second)) {
    return (
      first.length === second.length && first.every((item, index) => sameValue(item, second[index]))
    );
  }

  if (isPlainObject(first) && isPlainObject(second)) {
    const keys = Object.keys(first);

    return (
      keys.length === Object.keys(second).length &&
      keys.every((key) => hasOwn(second, key) && sameValue(first[key], second[key]))
    );
  }

  return false;
}

/** The enclosing scope, read in setup. Undefined outside any scope. */
export function injectScope(): Readonly<Ref<Context>> | undefined {
  return inject(SCOPE, undefined);
}

/**
 * The context a composable evaluates with: its own context merged over the
 * enclosing scopes. Outside any scope it is exactly what readContext gives, so
 * the SDK receives what it did before scopes existed. Inside a computed, the
 * scope is tracked too.
 */
export function readScopedContext(
  scope: Readonly<Ref<Context>> | undefined,
  context: ContextSource | undefined,
): Context {
  const own = readContext(context);

  return scope ? mergeContext(scope.value, own) : own;
}
