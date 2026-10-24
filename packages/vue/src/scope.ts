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
