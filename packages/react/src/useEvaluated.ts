import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";
import type { Context } from "@featurevisor/types";
import { createValue, type Source, type ValueOptions } from "@featurevisor/signals";
import { useSource } from "@featurevisor/signals/react";

import { UpdatesContext } from "./updates.js";

/** Whether the provider asked for the behaviour from before. */
export function useEveryUpdate(): boolean {
  return React.useContext(UpdatesContext) === "every";
}

/**
 * The latest context a hook rendered with, as it was given, so the SDK and its
 * modules receive the same object they always did. The source compares it by
 * value with the one its last answer was for, so an inline context asks nothing
 * again, a context changed in place reads as changed, and one that differs is
 * read in the same render, so a new prop never shows a stale value for a frame.
 */
function useContextGetter(context: Context): () => Context {
  const latest = React.useRef(context);
  latest.current = context;

  const getter = React.useRef<(() => Context) | undefined>(undefined);
  if (!getter.current) getter.current = () => latest.current;

  return getter.current;
}

/**
 * A hook's value from its own source on the instance's engine. The component
 * renders again only when the value changes, and the SDK evaluates again only
 * when something the last answer read has changed. Each value keeps its own
 * copy of what the SDK returned, so a component that changes a returned value
 * in place changes nothing the SDK or any other component holds. `identity`
 * names what the source evaluates, so a new key makes a new source.
 */
export function useEvaluated<T>(
  sdk: Featurevisor,
  identity: string,
  context: Context,
  compute: (context: Context) => T,
  options: ValueOptions<T> & { constant?: boolean } = {},
): T {
  const readContext = useContextGetter(context);
  const source = React.useMemo(
    () =>
      options.constant
        ? constant(compute(readContext()))
        : createValue(sdk, compute, readContext, { ...options, copy: true }),
    [sdk, identity],
  );

  return useSource(source);
}

const listenToNothing = () => () => {};

/** A value nothing can change, such as the answer for an empty list of keys, which listens to nothing. */
function constant<T>(value: T): Source<T> {
  return { read: () => value, listen: listenToNothing };
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
