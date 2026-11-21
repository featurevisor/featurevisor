import { computed, inject, ssrContextKey, type Ref } from "vue";
import type { Featurevisor } from "@featurevisor/sdk";
import type { Context } from "@featurevisor/types";
import { copyValue, createValue, type Source, type ValueOptions } from "@featurevisor/signals";
import { useSource } from "@featurevisor/signals/vue";

import { UPDATES } from "./updates.js";

/** Whether setupApp asked for the behaviour from before. Read in setup. */
export function injectEveryUpdate(): boolean {
  return inject(UPDATES, undefined) === "every";
}

const listenToNothing = () => () => {};

/**
 * A readonly ref holding a composable's value, from its own source on the
 * instance's engine. It changes only when the value does, and the SDK evaluates
 * again only when something the last answer read has changed. Each value keeps
 * its own copy of what the SDK returned, so a component that changes a returned
 * value in place changes nothing the SDK or any other component holds. A
 * constant value, such as the answer for no keys, listens to nothing.
 */
export function usePrecise<T>(
  sdk: Featurevisor,
  compute: (context: Context) => T,
  context: () => Context,
  options: ValueOptions<T> & { constant?: boolean } = {},
): Readonly<Ref<T>> {
  // A server renders once and never listens, so it evaluates directly, handing
  // out a copy as the client does, and makes no value on the engine.
  if (inject(ssrContextKey, null)) return computed(() => copyValue(compute(context())));

  const source: Source<T> = options.constant
    ? { read: () => compute(context()), listen: listenToNothing }
    : createValue(sdk, compute, context, Object.assign({}, options, { copy: true }));

  return useSource(source);
}
