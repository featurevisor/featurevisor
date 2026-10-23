import { computed, onMounted, onUnmounted, shallowRef, unref, type Ref } from "vue";
import type { Featurevisor } from "@featurevisor/sdk";
import type { Context, FeatureKey, VariableKey } from "@featurevisor/types";

/**
 * The context for a read: an object, a ref holding one, or a getter such as
 * `() => ({ plan: props.plan })`. Refs and getters are followed, so the value
 * updates when what they read changes.
 */
export type ContextSource = Context | Readonly<Ref<Context>> | (() => Context);

const EMPTY_CONTEXT: Context = {};

/** Reads a context source. Inside a computed, its refs and props are tracked. */
export function readContext(source: ContextSource | undefined): Context {
  if (typeof source === "function") return source();

  return unref(source) || EMPTY_CONTEXT;
}

type Subscribe = (refresh: () => void) => () => void;

/**
 * Follows features or global variables: a datafile naming one of the keys in
 * that field, and any context or sticky change.
 */
function onKeys(
  sdk: Featurevisor,
  field: "features" | "variables",
  watchedKeys: readonly string[],
): Subscribe {
  const keys = watchedKeys.slice();

  return (refresh) => {
    const unsubscribers = [
      sdk.on("datafile_set", (details) => {
        if (details[field].some((key) => keys.indexOf(key) > -1)) refresh();
      }),
      sdk.on("context_set", refresh),
      // Sticky keys are direct changes, while dependencies can be transitive.
      // Any nonempty sticky set may affect what these keys evaluate to.
      sdk.on("sticky_features_set", ({ features }) => {
        if (features.length > 0) refresh();
      }),
      sdk.on("sticky_variables_set", ({ variables }) => {
        if (variables.length > 0) refresh();
      }),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

export function onFeatures(sdk: Featurevisor, featureKeys: readonly FeatureKey[]): Subscribe {
  return onKeys(sdk, "features", featureKeys);
}

export function onVariable(sdk: Featurevisor, variableKey: VariableKey): Subscribe {
  return onKeys(sdk, "variables", [variableKey]);
}

/** Follows datafiles that bring another revision. */
export function onRevision(sdk: Featurevisor): Subscribe {
  return (refresh) =>
    sdk.on("datafile_set", ({ revisionChanged }) => {
      if (revisionChanged) refresh();
    });
}

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
 * idempotent, so reading it in setup is safe.
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
 * A readonly ref holding `evaluate()`, evaluated again when `subscribe` reports
 * a change or when a ref or prop it reads changes. Call it in setup.
 *
 * It subscribes once the component is mounted, which never happens during
 * server rendering, so an instance shared across requests gains no listeners
 * per request, only the one set the change count attaches per instance. A
 * change between setup and mounting is caught by the instance's
 * change count. The count runs while any composable on the instance is
 * subscribed, and stopping it counts as a change, so a count read before it
 * never matches one read after it. Without `subscribe` there is nothing to
 * follow.
 */
export function useLive<T>(
  sdk: Featurevisor,
  subscribe: Subscribe | undefined,
  evaluate: () => T,
): Readonly<Ref<T>> {
  const version = shallowRef(0);
  const refresh = () => {
    version.value++;
  };

  if (subscribe) {
    const created = track(sdk).changes;
    let stop: (() => void) | undefined;

    onMounted(() => {
      const unsubscribe = subscribe(refresh);
      const tracker = track(sdk);
      tracker.subscribers++;
      stop = () => {
        unsubscribe();
        if (--tracker.subscribers === 0 && tracker.detach) {
          tracker.detach();
          tracker.changes++;
        }
      };

      if (tracker.changes !== created) refresh();
    });
    onUnmounted(() => {
      if (stop) stop();
    });
  }

  return computed(() => {
    // Reading the version makes each reported change evaluate again.
    void version.value;

    return evaluate();
  });
}
