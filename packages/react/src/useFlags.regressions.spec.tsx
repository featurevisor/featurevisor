import * as React from "react";
import { act, render } from "@testing-library/react";
import { createFeaturevisor, type Featurevisor } from "@featurevisor/sdk";
import type { Context, DatafileContent, FeatureKey } from "@featurevisor/types";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useFlag } from "./useFlag";
import { useFlags } from "./useFlags";
import { useEveryFlag } from "./useEveryFlag";
import { useSomeFlag } from "./useSomeFlag";

const KEYS = ["checkout", "liveChat", "wishlist"];

/**
 * Every feature needs the gate variable, is off for blocked contexts, and is
 * off for everyone when listed in off.
 */
function datafile(label = "first", off: readonly string[] = []): DatafileContent {
  return {
    schemaVersion: "4",
    revision: label,
    segments: {
      blocked: { conditions: [{ attribute: "blocked", operator: "equals", value: true }] },
    },
    features: Object.fromEntries(
      KEYS.map((key) => [
        key,
        {
          hash: `${label}-${key}-${off.includes(key)}`,
          bucketBy: "userId",
          conditions: [{ variable: "gate", operator: "equals", value: true }],
          traffic: [
            { key: "blocked", conditions: ["blocked"], percentage: 100000, enabled: false },
            { key: "all", conditions: "*", percentage: off.includes(key) ? 0 : 100000 },
          ],
        },
      ]),
    ),
    variables: {
      gate: { hash: "gate", type: "boolean", defaultValue: true },
    },
  };
}

function instance(label = "first", off: readonly string[] = []) {
  return createFeaturevisor({ logLevel: "fatal", datafile: datafile(label, off) });
}

interface Snapshot {
  flag: boolean;
  flags: readonly boolean[];
  every: boolean;
  some: boolean;
}

/** What the hooks must agree with: the SDK's own answers at that moment. */
function expected(sdk: Featurevisor, keys: readonly FeatureKey[], context: Context): Snapshot {
  return {
    flag: sdk.isEnabled(keys[0], context),
    flags: keys.map((key) => sdk.isEnabled(key, context)),
    every: keys.every((key) => sdk.isEnabled(key, context)),
    some: keys.some((key) => sdk.isEnabled(key, context)),
  };
}

function observe(sdk: Featurevisor) {
  const original = sdk.on.bind(sdk);
  const cleanups: jest.Mock[] = [];
  const on = jest.spyOn(sdk, "on").mockImplementation((event, callback) => {
    const cleanup = jest.fn(original(event, callback));
    cleanups.push(cleanup);
    return cleanup;
  });
  return { on, cleanups, active: () => cleanups.filter((fn) => !fn.mock.calls.length) };
}

// Four hooks, each with one set of four listeners.
const LISTENERS = 16;
// The change tracker adds four listeners per instance while any hook is subscribed.
const TRACKER_LISTENERS = 4;

describe.each([false, true])("multiple flag hooks together, StrictMode: %s", (strict) => {
  function harness() {
    const snapshots: Snapshot[] = [];
    let renders = 0;
    function Reader({
      featureKeys,
      context,
      duringLayout,
    }: {
      featureKeys: readonly FeatureKey[];
      context: Context;
      duringLayout?: () => void;
    }) {
      if (++renders > 200) throw new Error("Multiple flag hooks did not settle");
      const snapshot: Snapshot = {
        flag: useFlag(featureKeys[0], context),
        flags: useFlags(featureKeys, context),
        every: useEveryFlag(featureKeys, context),
        some: useSomeFlag(featureKeys, context),
      };
      // Record only committed values, including the commit before passive effects.
      React.useLayoutEffect(() => {
        snapshots.push(snapshot);
      });
      React.useLayoutEffect(() => duringLayout?.(), [duringLayout]);
      return null;
    }
    const tree = (
      sdk: Featurevisor,
      featureKeys: readonly FeatureKey[] = ["checkout", "liveChat"],
      context: Context = { userId: "user-1" },
      duringLayout?: () => void,
    ) => {
      const content = (
        <FeaturevisorProvider instance={sdk}>
          <Reader {...{ featureKeys, context, duringLayout }} />
        </FeaturevisorProvider>
      );
      return strict ? <React.StrictMode>{content}</React.StrictMode> : content;
    };
    /** Every value committed during an operation is the SDK's answer after it. */
    function check(
      operation: () => void,
      sdk: Featurevisor,
      keys: readonly FeatureKey[] = ["checkout", "liveChat"],
      context: Context = { userId: "user-1" },
    ) {
      snapshots.length = 0;
      const before = renders;
      operation();
      expect(snapshots.length).toBeGreaterThan(0);
      const value = expected(sdk, keys, context);
      snapshots.forEach((snapshot) => expect(snapshot).toEqual(value));
      expect(renders - before).toBeLessThanOrEqual(16);
      return value;
    }
    return { snapshots, tree, check, renders: () => renders };
  }

  test("commits current provider, keys and context without mixed values", () => {
    const first = instance();
    const second = instance("second", ["liveChat"]);
    const firstEvents = observe(first);
    const secondEvents = observe(second);
    const h = harness();

    const view = render(h.tree(first));
    h.snapshots.forEach((snapshot) =>
      expect(snapshot).toEqual(expected(first, ["checkout", "liveChat"], { userId: "user-1" })),
    );
    expect(firstEvents.active()).toHaveLength(LISTENERS + TRACKER_LISTENERS);

    // Another provider: every hook leaves the first instance for the second.
    const onSecond = h.check(() => view.rerender(h.tree(second)), second);
    expect(onSecond.flags).toEqual([true, false]);
    expect(onSecond.every).toBe(false);
    expect(firstEvents.active()).toHaveLength(0);
    expect(secondEvents.active()).toHaveLength(LISTENERS + TRACKER_LISTENERS);

    h.check(() => view.rerender(h.tree(first)), first);

    // Other keys, a longer list, a missing key and a duplicate.
    h.check(() => view.rerender(h.tree(first, ["wishlist"])), first, ["wishlist"]);
    h.check(() => view.rerender(h.tree(first, KEYS)), first, KEYS);
    const missing = h.check(() => view.rerender(h.tree(first, ["missing", "checkout"])), first, [
      "missing",
      "checkout",
    ]);
    expect(missing.flags).toEqual([false, true]);
    expect(missing.some).toBe(true);
    h.check(() => view.rerender(h.tree(first, ["checkout", "checkout"])), first, [
      "checkout",
      "checkout",
    ]);
    h.check(() => view.rerender(h.tree(first)), first);

    // The same keys and contexts, as new arrays and objects, never resubscribe.
    const subscriptions = firstEvents.on.mock.calls.length;
    const context = { userId: "user-1", blocked: true };
    const blocked = h.check(
      () => view.rerender(h.tree(first, ["checkout", "liveChat"], context)),
      first,
      ["checkout", "liveChat"],
      context,
    );
    expect(blocked.flags).toEqual([false, false]);
    context.blocked = false;
    h.check(
      () => view.rerender(h.tree(first, ["checkout", "liveChat"], context)),
      first,
      ["checkout", "liveChat"],
      context,
    );
    h.check(() => view.rerender(h.tree(first)), first);
    h.check(() => view.rerender(h.tree(first)), first);
    expect(firstEvents.on).toHaveBeenCalledTimes(subscriptions);

    // Events on an instance no longer provided, and after unmounting, do nothing.
    const beforeOldEvent = h.renders();
    act(() => second.setContext({ blocked: true }));
    expect(h.renders()).toBe(beforeOldEvent);
    view.unmount();
    [...firstEvents.cleanups, ...secondEvents.cleanups].forEach((fn) =>
      expect(fn).toHaveBeenCalledTimes(1),
    );
    const beforeUnmountedEvent = h.renders();
    act(() => first.setDatafile(datafile("unmounted", KEYS)));
    expect(h.renders()).toBe(beforeUnmountedEvent);
  });

  test("commits consistent values for context, datafile and both sticky event types", () => {
    const sdk = instance();
    const h = harness();
    render(h.tree(sdk));

    const blocked = h.check(() => act(() => sdk.setContext({ blocked: true })), sdk);
    expect(blocked.some).toBe(false);
    h.check(() => act(() => sdk.setContext({ blocked: false })), sdk);

    h.check(() => act(() => sdk.setDatafile(datafile("updated"))), sdk);
    const liveChatOff = h.check(
      () => act(() => sdk.setDatafile(datafile("updated", ["liveChat"]))),
      sdk,
    );
    expect(liveChatOff.flags).toEqual([true, false]);
    expect(liveChatOff.every).toBe(false);
    expect(liveChatOff.some).toBe(true);
    h.check(() => act(() => sdk.setDatafile(datafile("updated"))), sdk);

    const gated = h.check(() => act(() => sdk.setStickyVariables({ gate: false })), sdk);
    expect(gated.flags).toEqual([false, false]);
    h.check(() => act(() => sdk.setStickyVariables({}, true)), sdk);

    const pinned = h.check(
      () =>
        act(() =>
          sdk.setStickyFeatures({
            checkout: { enabled: false },
            liveChat: { enabled: true },
          }),
        ),
      sdk,
    );
    expect(pinned.flag).toBe(false);
    expect(pinned.flags).toEqual([false, true]);
    h.check(() => act(() => sdk.setStickyFeatures({}, true)), sdk);
  });

  test.each(["flags", "every", "some"] as const)(
    "catches changes during subscription setup for %s without another hook refreshing it",
    (kind) => {
      const sdk = instance();
      const original = sdk.on.bind(sdk);
      let calls = 0;
      jest.spyOn(sdk, "on").mockImplementation((event, callback) => {
        // The change tracker attaches first, while rendering. Change the SDK as
        // the hook itself subscribes.
        if (++calls === TRACKER_LISTENERS + 1) sdk.setStickyVariables({ gate: false });
        return original(event, callback);
      });
      const keys = ["checkout", "liveChat"];
      const hooks = {
        flags: () => useFlags(keys),
        every: () => useEveryFlag(keys),
        some: () => useSomeFlag(keys),
      };
      const useValue = hooks[kind];
      const commits: unknown[] = [];
      function Reader() {
        const value = useValue();
        React.useLayoutEffect(() => {
          commits.push(value);
        });
        return null;
      }
      const content = (
        <FeaturevisorProvider instance={sdk}>
          <Reader />
        </FeaturevisorProvider>
      );
      render(strict ? <React.StrictMode>{content}</React.StrictMode> : content);

      const on = expected(instance(), keys, {})[kind];
      const off = expected(sdk, keys, {})[kind];
      expect(off).not.toEqual(on);
      expect(commits[0]).toEqual(on);
      expect(commits[commits.length - 1]).toEqual(off);

      commits.length = 0;
      act(() => sdk.setStickyVariables({}, true));
      expect(commits.length).toBeGreaterThan(0);
      commits.forEach((value) => expect(value).toEqual(on));
    },
  );

  describe.each(["context", "datafile", "sticky features", "sticky variables"])(
    "missed %s event",
    (event) => {
      test.each(["mount", "provider", "keys"])(
        "catches SDK changes in layout effects before subscribing on %s",
        (change) => {
          const first = instance();
          const second = instance("second");
          const h = harness();
          const target = change === "provider" ? second : first;
          const keys = change === "keys" ? ["wishlist", "liveChat"] : ["checkout", "liveChat"];
          let changed = false;
          const duringLayout = () => {
            if (changed) return;
            changed = true;
            if (event === "context") target.setContext({ blocked: true });
            else if (event === "datafile") target.setDatafile(datafile("between", KEYS));
            else if (event === "sticky features")
              target.setStickyFeatures({
                checkout: { enabled: false },
                liveChat: { enabled: false },
                wishlist: { enabled: false },
              });
            else target.setStickyVariables({ gate: false });
          };

          const before = expected(target, keys, {});
          const view = render(
            change === "mount" ? h.tree(target, keys, {}, duringLayout) : h.tree(first),
          );
          if (change !== "mount") {
            h.snapshots.length = 0;
            view.rerender(h.tree(target, keys, {}, duringLayout));
          }

          const after = expected(target, keys, {});
          expect(after.some).toBe(false);
          expect(h.snapshots[0]).toEqual(before);
          expect(h.snapshots[h.snapshots.length - 1]).toEqual(after);
          h.snapshots.forEach((snapshot) => expect([before, after]).toContainEqual(snapshot));

          h.check(
            () =>
              act(() => {
                target.setContext({ blocked: false });
                target.setStickyFeatures({}, true);
                target.setStickyVariables({}, true);
                target.setDatafile(datafile(change === "provider" ? "second" : "first"));
              }),
            target,
            keys,
            {},
          );
        },
      );
    },
  );
});
