import { useEffect, useReducer } from "react";
import type { Featurevisor } from "@featurevisor/sdk";

interface Tracker {
  changes: number;
  subscribers: number;
  detach?: () => void;
}

const EVENTS = [
  "datafile_set",
  "context_set",
  "sticky_features_set",
  "sticky_variables_set",
] as const;
const trackers = new WeakMap<Featurevisor, Tracker>();

/**
 * Counts the instance's datafile, context and sticky changes, with one set of
 * listeners per instance. Reading the count starts it, and attaching is
 * idempotent, so reading while rendering is safe.
 */
function track(sdk: Featurevisor): Tracker {
  let tracker = trackers.get(sdk);
  if (!tracker) trackers.set(sdk, (tracker = { changes: 0, subscribers: 0 }));

  const current = tracker;
  if (!current.detach) {
    const unsubscribers = EVENTS.map((event) =>
      sdk.on(event, () => {
        current.changes++;
      }),
    );
    current.detach = () => {
      current.detach = undefined;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }

  return current;
}

/**
 * Stops the count once no hook on the instance is subscribed. It waits a
 * microtask, because StrictMode and Activity clean an effect up and set it up
 * again at once, and stopping in between would count as a change and render
 * every hook again. The listeners keep counting until it stops.
 */
function release(tracker: Tracker): void {
  if (--tracker.subscribers > 0) return;

  Promise.resolve().then(() => {
    if (tracker.subscribers === 0 && tracker.detach) {
      tracker.detach();
      tracker.changes++;
    }
  });
}

/**
 * Subscribes in an effect and renders again only if the SDK changed after
 * rendering and before subscribing, which the count read while rendering shows.
 * The count runs while any hook on the instance is subscribed. When the last
 * one leaves, it stops, and the stop counts as a change, so a count read before
 * it never matches one read after it.
 *
 * Only `inputs` trigger the effect. Contexts and fresh evaluation results must
 * not cause subscription churn or enter React state. Without `subscribe` there
 * is nothing to evaluate, so nothing to follow.
 */
export function useSubscription(
  sdk: Featurevisor,
  subscribe: ((refresh: () => void) => () => void) | undefined,
  inputs: readonly unknown[],
): void {
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const rendered = subscribe ? track(sdk).changes : 0;

  useEffect(() => {
    if (!subscribe) return;

    const unsubscribe = subscribe(refresh);
    const tracker = track(sdk);
    tracker.subscribers++;
    if (tracker.changes !== rendered) refresh();

    return () => {
      unsubscribe();
      release(tracker);
    };
  }, [sdk, ...inputs]);
}
