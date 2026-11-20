import type { Featurevisor } from "@featurevisor/sdk";
import type { Context } from "@featurevisor/types";

import { getEngine, Node, type Batch, type Follows, type Source } from "./engine.js";
import { sameValue } from "./values.js";

export interface ValueOptions<T> {
  /** How answers compare. By value by default, so an equal answer keeps the previous one. */
  equals?: (previous: T, next: T) => boolean;
  /** Asks again only when a change touches what the last answer read. On by default. */
  precise?: boolean;
  /** Keeps its own copy of each new value, so changing it in place reaches nothing else. */
  copy?: boolean;
  /** Freezes each kept value, so changing it in place throws. */
  freeze?: boolean;
  /** Runs notifications together, such as Preact's `batch`. */
  batch?: Batch;
  /** What the value follows where the SDK cannot say what it read, such as on a child instance. */
  follows?: Follows;
}

/**
 * One value of an instance, from any function of a context. It is what readers
 * build their values from, and what framework hooks use directly, so their
 * bundles carry only the engine.
 */
export function createValue<T>(
  f: Featurevisor,
  compute: (context: Context) => T,
  context: () => Context,
  options: ValueOptions<T> = {},
): Source<T> {
  return new Node<T>(getEngine(f), {
    compute,
    context,
    equals: options.equals || sameValue,
    precise: options.precise !== false,
    copy: options.copy === true,
    freeze: options.freeze === true,
    batch: options.batch,
    follows: options.follows,
  });
}
