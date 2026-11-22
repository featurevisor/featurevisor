import type { Context } from "@featurevisor/types";

import type { ContextSetEventDetails } from "./events.js";
import { sameValue } from "./session.js";

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

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Whether an attribute keeps its value. Values compare by what they hold, but
 * an object or array given again as the same reference counts as changed, since
 * it may have been changed in place.
 */
function sameAttributeValue(previous: unknown, next: unknown): boolean {
  if (previous === next) return previous === null || typeof previous !== "object";

  try {
    return sameValue(previous, next);
  } catch {
    // A value that contains itself counts as changed.
    return false;
  }
}

function valueOf(context: Context, key: string): unknown {
  return hasOwn(context, key) ? context[key] : undefined;
}

/**
 * The top level keys whose values differ between two contexts. A merge can
 * change only the keys it carries, given as `incoming`, and a replace any key of
 * either context. A key that is absent and one whose value is undefined read the
 * same, so they are not a change.
 */
export function getChangedContextKeys(
  previous: Context,
  next: Context,
  incoming?: Context,
): string[] {
  const keys: string[] = [];

  // The stored context given back may have been changed in place, so every key
  // in it may have changed.
  if (previous === next || previous === incoming) {
    for (const key in previous) if (hasOwn(previous, key)) keys.push(key);
    for (const key in next) if (hasOwn(next, key) && !hasOwn(previous, key)) keys.push(key);
    return keys;
  }

  if (incoming) {
    for (const key in incoming) {
      if (hasOwn(incoming, key) && !sameAttributeValue(valueOf(previous, key), valueOf(next, key)))
        keys.push(key);
    }
    return keys;
  }

  for (const key in previous) {
    if (hasOwn(previous, key) && !sameAttributeValue(previous[key], valueOf(next, key)))
      keys.push(key);
  }
  for (const key in next) {
    if (hasOwn(next, key) && !hasOwn(previous, key) && !sameAttributeValue(undefined, next[key]))
      keys.push(key);
  }
  return keys;
}

/**
 * The details of a `context_set` event, for someone who receives them. A merge
 * compares only the keys it carries, so its `keys` come at once. A replace may
 * compare every key of two large contexts, so its `keys` are worked out when
 * first read and kept.
 */
export function createContextSetDetails(
  context: Context,
  replaced: boolean,
  previous: Context,
  incoming: Context | undefined,
): ContextSetEventDetails {
  if (incoming) {
    return { context, replaced, keys: getChangedContextKeys(previous, context, incoming) };
  }

  let keys: string[] | undefined;
  return {
    context,
    replaced,
    get keys() {
      return keys || (keys = getChangedContextKeys(previous, context));
    },
  };
}
