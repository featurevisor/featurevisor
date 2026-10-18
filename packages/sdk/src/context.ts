import type { Context } from "@featurevisor/types";

export function mergeContext(first: Context, second: Context = {}): Context {
  const result: Context = {};
  // Define the own key before assigning so it cannot invoke the prototype setter.
  if (
    Object.prototype.hasOwnProperty.call(first, "__proto__") ||
    Object.prototype.hasOwnProperty.call(second, "__proto__")
  ) {
    Object.defineProperty(result, "__proto__", {
      value: undefined,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return Object.assign(result, first, second);
}
