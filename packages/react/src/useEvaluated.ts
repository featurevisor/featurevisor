import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";
import type { Context } from "@featurevisor/types";
import { copyValue, createValue, type Source, type ValueOptions } from "@featurevisor/signals";
import { useSource } from "@featurevisor/signals/react";

import { UpdatesContext } from "./updates.js";

/** Whether the provider asked for the behaviour from before. */
export function useEveryUpdate(): boolean {
  return React.useContext(UpdatesContext) === "every";
}

/** What a hook's source evaluates, built once per source from the hook's keys. */
export interface Evaluated<T> {
  compute: (context: Context) => T;
  options: ValueOptions<T>;
  /** A value nothing can change, such as the answer for no keys, which listens to nothing. */
  constant?: boolean;
}

const { useSyncExternalStore } = React as Partial<typeof React>;

const listenToNothing = () => () => {};

/**
 * One hook's value. Its source on the instance's engine is made when a client
 * first reads or listens, so a server, which renders once and never listens,
 * evaluates directly and makes none. Hydrating in a browser reads the source,
 * so the first client render matches what it holds.
 */
class HookValue<T> implements Source<T> {
  private source: Source<T> | undefined;

  constructor(
    private readonly sdk: Featurevisor,
    private readonly evaluated: Evaluated<T>,
    public context: Context,
  ) {}

  read = (): T => this.get().read();

  listen = (changed: () => void): (() => void) => this.get().listen(changed);

  readOnServer = (): T =>
    typeof document === "undefined"
      ? copyValue(this.evaluated.compute(this.context))
      : this.get().read();

  private get(): Source<T> {
    if (this.source) return this.source;

    const { compute, options, constant } = this.evaluated;
    if (constant) {
      const value = compute(this.context);
      this.source = { read: () => value, listen: listenToNothing };
    } else {
      this.source = createValue(this.sdk, compute, () => this.context, { ...options, copy: true });
    }

    return this.source;
  }
}

/**
 * A hook's value from its own source on the instance's engine. The component
 * renders again only when the value changes, and the SDK evaluates again only
 * when something the last answer read has changed. Each value keeps its own
 * copy of what the SDK returned, so a component that changes a returned value
 * in place changes nothing the SDK or any other component holds.
 *
 * `identity` names what the source evaluates, so a new key makes a new source,
 * and `build` makes what it evaluates from the keys only then, so a render
 * allocates nothing here. The source reads the latest context as it was given,
 * so the SDK and its modules receive the same object they always did. It
 * compares that context by value with the one its last answer was for, so an
 * inline context asks nothing again, a context changed in place reads as
 * changed, and one that differs is read in the same render, so a new prop never
 * shows a stale value for a frame.
 */
export function useEvaluated<T, A, B = undefined>(
  sdk: Featurevisor,
  identity: string,
  context: Context,
  build: (sdk: Featurevisor, first: A, second: B) => Evaluated<T>,
  first: A,
  second?: B,
): T {
  const value = React.useMemo(
    () => new HookValue(sdk, build(sdk, first, second as B), context),
    [sdk, identity],
  );
  value.context = context;

  return useSyncExternalStore
    ? useSyncExternalStore(value.listen, value.read, value.readOnServer)
    : useSource(value);
}

/** Whether to stop at each feature, for useEveryFlag and useSomeFlag. */
export function flagUntil(
  sdk: Featurevisor,
  featureKeys: readonly string[],
  context: Context,
  stopAt: boolean,
): boolean {
  for (let index = 0; index < featureKeys.length; index++) {
    const featureKey = featureKeys[index];

    // A key listed again was already evaluated and did not stop the loop.
    if (featureKeys.indexOf(featureKey) !== index) continue;
    if (sdk.isEnabled(featureKey, context) === stopAt) return stopAt;
  }

  return !stopAt;
}
