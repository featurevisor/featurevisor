import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createFeaturevisor, type Featurevisor } from "@featurevisor/sdk";
import type { Context, DatafileContent, FeatureKey } from "@featurevisor/types";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { expectExactType, type IsExact } from "./typeAssertions.test-helper";
import { useFlags } from "./useFlags";

const KEYS = ["checkout", "liveChat", "wishlist"];

/** Three features, each on for everyone unless listed in off or the context is blocked. */
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

function instance(label?: string, off?: readonly string[]) {
  return createFeaturevisor({ logLevel: "fatal", datafile: datafile(label, off) });
}

/** Records every listener the hooks attach, and whether it was removed. */
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

// The change tracker adds four listeners per instance while any hook is subscribed.
const TRACKER_LISTENERS = 4;

let renders = 0;
const results: (readonly boolean[])[] = [];

function Flags({ keys, context }: { keys: readonly FeatureKey[]; context?: Context }) {
  renders += 1;
  const values = useFlags(keys, context);
  React.useLayoutEffect(() => {
    results.push(values);
  });
  return <p data-testid="flags">{values.map((enabled) => (enabled ? "on" : "off")).join(",")}</p>;
}

function tree(sdk: Featurevisor, keys: readonly FeatureKey[], context?: Context) {
  return (
    <FeaturevisorProvider instance={sdk}>
      <Flags keys={keys} context={context} />
    </FeaturevisorProvider>
  );
}

const text = () => screen.getByTestId("flags").textContent;

beforeEach(() => {
  renders = 0;
  results.length = 0;
});

describe("react: useFlags", function () {
  test("returns one boolean per key, in the order of the keys", function () {
    const sdk = instance("first", ["wishlist"]);
    const view = render(tree(sdk, ["checkout", "liveChat", "wishlist"]));
    expect(text()).toBe("on,on,off");

    view.rerender(tree(sdk, ["wishlist", "liveChat", "checkout"]));
    expect(text()).toBe("off,on,on");
  });

  test("takes a list of any length", function () {
    const sdk = instance("first", ["liveChat"]);
    const view = render(tree(sdk, ["checkout"]));
    expect(text()).toBe("on");

    const many = ["checkout", "liveChat", "wishlist", "checkout", "liveChat", "wishlist"];
    view.rerender(tree(sdk, many));
    expect(text()).toBe("on,off,on,on,off,on");
  });

  test("passes the context to every evaluation, and an empty context by default", function () {
    const sdk = instance();
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    const view = render(tree(sdk, KEYS));
    expect(text()).toBe("on,on,on");
    expect(isEnabled).toHaveBeenCalledWith("checkout", {});

    const context = { blocked: true };
    view.rerender(tree(sdk, KEYS, context));
    expect(text()).toBe("off,off,off");
    expect(isEnabled).toHaveBeenCalledWith("wishlist", context);
  });

  test("returns false for a feature missing from the datafile", function () {
    render(tree(instance(), ["checkout", "missing"]));
    expect(text()).toBe("on,off");
  });

  test("gives a key listed twice a value at each position, evaluating it once per render", function () {
    const sdk = instance("first", ["liveChat"]);
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    render(tree(sdk, ["checkout", "liveChat", "checkout"]));

    expect(text()).toBe("on,off,on");
    const checkoutCalls = isEnabled.mock.calls.filter(([key]) => key === "checkout");
    expect(checkoutCalls).toHaveLength(renders);
  });

  test("returns an empty array for an empty list, and subscribes to nothing", function () {
    const sdk = instance();
    const events = observe(sdk);
    render(tree(sdk, []));

    expect(text()).toBe("");
    expect(results[results.length - 1]).toEqual([]);
    expect(events.on).not.toHaveBeenCalled();

    const before = renders;
    act(() => sdk.setContext({ blocked: true }));
    expect(renders).toBe(before);
  });

  test("re-renders when a datafile changes a listed feature", function () {
    const sdk = instance();
    render(tree(sdk, ["checkout", "liveChat"]));
    expect(text()).toBe("on,on");

    act(() => sdk.setDatafile(datafile("first", ["liveChat"])));
    expect(text()).toBe("on,off");
  });

  test("does not re-render when a datafile changes only unlisted features", function () {
    const sdk = instance();
    render(tree(sdk, ["checkout", "liveChat"]));
    const before = renders;

    act(() => sdk.setDatafile(datafile("first", ["wishlist"])));
    expect(renders).toBe(before);
    expect(text()).toBe("on,on");
  });

  test("re-renders on context, sticky feature and sticky variable changes", function () {
    const sdk = instance();
    render(tree(sdk, KEYS));

    act(() => sdk.setContext({ blocked: true }));
    expect(text()).toBe("off,off,off");
    act(() => sdk.setContext({ blocked: false }));
    expect(text()).toBe("on,on,on");

    act(() => sdk.setStickyFeatures({ liveChat: { enabled: false } }));
    expect(text()).toBe("on,off,on");
    act(() => sdk.setStickyFeatures({}, true));
    expect(text()).toBe("on,on,on");

    act(() => sdk.setStickyVariables({ gate: false }));
    expect(text()).toBe("off,off,off");
    act(() => sdk.setStickyVariables({}, true));
    expect(text()).toBe("on,on,on");
  });

  test("subscribes once for an inline list, however often it renders", function () {
    const sdk = instance();
    const events = observe(sdk);
    const view = render(tree(sdk, ["checkout", "liveChat"]));
    expect(events.on).toHaveBeenCalledTimes(4 + TRACKER_LISTENERS);

    for (let i = 0; i < 5; i++) {
      view.rerender(tree(sdk, ["checkout", "liveChat"], { userId: `user-${i}` }));
    }

    expect(events.on).toHaveBeenCalledTimes(4 + TRACKER_LISTENERS);
    expect(events.active()).toHaveLength(4 + TRACKER_LISTENERS);
  });

  test("resubscribes once when the keys change", function () {
    const sdk = instance();
    const events = observe(sdk);
    const view = render(tree(sdk, ["checkout", "liveChat"]));
    const first = [...events.cleanups];

    view.rerender(tree(sdk, ["liveChat", "wishlist"]));
    // The hook's own four listeners are replaced. The change tracker keeps its
    // four through the resubscription, so it counts nothing as a change.
    expect(first.map((cleanup) => cleanup.mock.calls.length).sort()).toEqual([
      0, 0, 0, 0, 1, 1, 1, 1,
    ]);
    expect(events.on).toHaveBeenCalledTimes(2 * 4 + TRACKER_LISTENERS);
    expect(events.active()).toHaveLength(4 + TRACKER_LISTENERS);

    // The new subscription follows the new keys.
    act(() => sdk.setDatafile(datafile("first", ["wishlist"])));
    expect(text()).toBe("on,off");
  });

  test("removes its listeners on unmount", async function () {
    const sdk = instance();
    const events = observe(sdk);
    const view = render(tree(sdk, KEYS));

    view.unmount();
    // The change tracker stops a microtask after the last hook on an instance leaves.
    await Promise.resolve();
    events.cleanups.forEach((cleanup) => expect(cleanup).toHaveBeenCalledTimes(1));

    const before = renders;
    act(() => {
      sdk.setContext({ blocked: true });
      sdk.setDatafile(datafile("unmounted", KEYS));
    });
    expect(renders).toBe(before);
  });

  test("keeps the same array while the values are unchanged", function () {
    const sdk = instance();
    const view = render(tree(sdk, ["checkout", "liveChat"]));
    const initial = results[results.length - 1];

    view.rerender(tree(sdk, ["checkout", "liveChat"]));
    view.rerender(tree(sdk, ["checkout", "liveChat"], { userId: "user-2" }));
    results.forEach((result) => expect(result).toBe(initial));

    act(() => sdk.setDatafile(datafile("first", ["checkout"])));
    const changed = results[results.length - 1];
    expect(changed).not.toBe(initial);
    expect(changed).toEqual([false, true]);
  });

  test("returns an exact tuple for an inline list and an array for a runtime list", function () {
    function Types() {
      const inline = useFlags(["checkout", "liveChat", "wishlist"]);
      expectExactType<IsExact<typeof inline, readonly [boolean, boolean, boolean]>>(true);

      const one = useFlags(["checkout"], { userId: "user-1" });
      expectExactType<IsExact<typeof one, readonly [boolean]>>(true);

      const keys: FeatureKey[] = ["checkout", "liveChat"];
      const runtime = useFlags(keys);
      expectExactType<IsExact<typeof runtime, readonly boolean[]>>(true);

      // @ts-expect-error an inline list of two has no third value
      const [, , third] = useFlags(["checkout", "liveChat"]);

      return <p data-testid="types">{String([...inline, ...one, ...runtime, third])}</p>;
    }

    render(
      <FeaturevisorProvider instance={instance()}>
        <Types />
      </FeaturevisorProvider>,
    );
    expect(screen.getByTestId("types")).toHaveTextContent("true,true,true,true,true,true,");
  });
});
