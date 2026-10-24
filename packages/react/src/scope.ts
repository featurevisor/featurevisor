import * as React from "react";
import type { Context } from "@featurevisor/types";

/** The merged context of the enclosing scopes, undefined outside any scope. */
export const ScopeContext = React.createContext<Context | undefined>(undefined);

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

/**
 * The context a hook evaluates with: its own context merged over the enclosing
 * scopes. Outside any scope it is the same object, so the SDK receives exactly
 * what it did before scopes existed.
 */
export function useScopedContext(context: Context): Context {
  const scope = React.useContext(ScopeContext);

  return scope ? mergeContext(scope, context) : context;
}
