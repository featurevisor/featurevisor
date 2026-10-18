import * as React from "react";
import { act, render } from "@testing-library/react";
import { createFeaturevisor, type Featurevisor } from "@featurevisor/sdk";
import type { Context, DatafileContent } from "@featurevisor/types";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useFlag } from "./useFlag";
import { useVariation } from "./useVariation";
import { useVariable } from "./useVariable";

function datafile(label = "first", enabled = true): DatafileContent {
  return {
    schemaVersion: "2",
    revision: label,
    segments: {
      blocked: { conditions: [{ attribute: "account.blocked", operator: "equals", value: true }] },
    },
    features: Object.fromEntries(
      ["policy", "alternate"].map((key) => [
        key,
        {
          hash: `${label}-${key}-${enabled}`,
          bucketBy: "userId",
          conditions: [{ variable: "gate", operator: "equals", value: true }],
          variations: [{ value: `${label}-${key}`, weight: 100 }],
          variablesSchema: {
            value: { type: "json", defaultValue: { label: `${label}-${key}` } },
            other: { type: "json", defaultValue: { label: "other" } },
          },
          traffic: [
            { key: "blocked", segments: ["blocked"], percentage: 100000, enabled: false },
            {
              key: "all",
              segments: "*",
              percentage: 100000,
              enabled,
              allocation: [{ variation: `${label}-${key}`, range: [0, 100000] }],
            },
          ],
        },
      ]),
    ),
    variables: {
      gate: { hash: "gate", type: "boolean", defaultValue: true },
      policy: {
        hash: label,
        type: "json",
        defaultValue: { labels: [] },
        disabledValue: { labels: ["blocked"] },
        requiredFeatures: ["policy"],
        overrideProgram: [
          {
            key: "label",
            keyPath: ["label"],
            conditions: "*",
            operations: [{ op: "append", path: ["labels"], value: label }],
            onMatch: 1,
            onMiss: 1,
          },
        ],
      },
    },
  };
}

function instance(label = "first", enabled = true) {
  return createFeaturevisor({ logLevel: "fatal", datafile: datafile(label, enabled) });
}

interface Snapshot {
  flag: boolean;
  variation: string | null;
  feature: { label: string } | null;
  global: { labels: string[] } | null;
}

function expected(label = "first", key = "policy", enabled = true): Snapshot {
  return {
    flag: enabled,
    variation: enabled ? `${label}-${key}` : null,
    feature: enabled ? { label: `${label}-${key}` } : null,
    global: { labels: enabled ? [label] : ["blocked"] },
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

describe.each([false, true])("committed hook snapshots, StrictMode: %s", (strict) => {
  function harness(sdk: Featurevisor) {
    const snapshots: Snapshot[] = [];
    let renders = 0;
    function Reader({
      featureKey,
      variableKey,
      context,
      duringLayout,
    }: {
      featureKey: string;
      variableKey: string;
      context: Context;
      duringLayout?: () => void;
    }) {
      if (++renders > 120) throw new Error("Evaluation hooks did not settle");
      const snapshot = {
        flag: useFlag(featureKey, context),
        variation: useVariation<string>(featureKey, context),
        feature: useVariable<{ label: string }>(featureKey, variableKey, context),
        global: useVariable<{ labels: string[] }>("policy", context),
      };
      // Record only committed values, including the commit before passive effects.
      React.useLayoutEffect(() => {
        snapshots.push(snapshot);
      });
      React.useLayoutEffect(() => duringLayout?.(), [duringLayout]);
      return null;
    }
    const tree = (
      current = sdk,
      featureKey = "policy",
      context: Context = { userId: "123" },
      duringLayout?: () => void,
      variableKey = "value",
    ) => {
      const content = (
        <FeaturevisorProvider instance={current}>
          <Reader {...{ featureKey, variableKey, context, duringLayout }} />
        </FeaturevisorProvider>
      );
      return strict ? <React.StrictMode>{content}</React.StrictMode> : content;
    };
    function check(operation: () => void, value: Snapshot) {
      snapshots.length = 0;
      const before = renders;
      operation();
      expect(snapshots.length).toBeGreaterThan(0);
      snapshots.forEach((snapshot) => expect(snapshot).toEqual(value));
      expect(renders - before).toBeLessThanOrEqual(8);
    }
    return { snapshots, tree, check, renders: () => renders };
  }

  test("commits current provider, feature key, variable key and context without mixed values", () => {
    const first = instance();
    const second = instance("second", false);
    const firstEvents = observe(first);
    const secondEvents = observe(second);
    const h = harness(first);
    const view = render(h.tree());
    h.snapshots.forEach((snapshot) => expect(snapshot).toEqual(expected()));
    expect(firstEvents.active()).toHaveLength(16);

    h.check(() => view.rerender(h.tree(second)), expected("second", "policy", false));
    expect(firstEvents.active()).toHaveLength(0);
    expect(secondEvents.active()).toHaveLength(16);
    h.check(() => view.rerender(h.tree(first)), expected());
    h.check(() => view.rerender(h.tree(first, "alternate")), expected("first", "alternate"));
    h.check(() => view.rerender(h.tree(first, "missing")), {
      ...expected(),
      flag: false,
      variation: null,
      feature: null,
    });
    h.check(() => view.rerender(h.tree(first)), expected());

    const subscriptions = firstEvents.on.mock.calls.length;
    const context = { userId: "123", account: { blocked: true } };
    h.check(
      () => view.rerender(h.tree(first, "policy", context)),
      expected("first", "policy", false),
    );
    context.account.blocked = false;
    h.check(() => view.rerender(h.tree(first, "policy", context)), expected());
    h.check(() => view.rerender(h.tree(first, "policy", context, undefined, "other")), {
      ...expected(),
      feature: { label: "other" },
    });
    h.check(() => view.rerender(h.tree()), expected());
    h.check(() => view.rerender(h.tree()), expected());
    expect(firstEvents.on).toHaveBeenCalledTimes(subscriptions);

    const beforeOldEvent = h.renders();
    act(() => second.setContext({ account: { blocked: true } }));
    expect(h.renders()).toBe(beforeOldEvent);
    view.unmount();
    [...firstEvents.cleanups, ...secondEvents.cleanups].forEach((fn) =>
      expect(fn).toHaveBeenCalledTimes(1),
    );
    const beforeUnmountedEvent = h.renders();
    act(() => first.setDatafile(datafile("unmounted")));
    expect(h.renders()).toBe(beforeUnmountedEvent);
  });

  test("commits consistent values for context, datafile and both sticky event types", () => {
    const sdk = instance();
    const h = harness(sdk);
    render(h.tree());
    h.check(
      () => act(() => sdk.setContext({ account: { blocked: true } })),
      expected("first", "policy", false),
    );
    h.check(() => act(() => sdk.setContext({ account: { blocked: false } })), expected());
    h.check(() => act(() => sdk.setDatafile(datafile("updated"))), expected("updated"));
    h.check(
      () => act(() => sdk.setStickyVariables({ gate: false })),
      expected("updated", "policy", false),
    );
    h.check(() => act(() => sdk.setStickyVariables({}, true)), expected("updated"));
    h.check(
      () => act(() => sdk.setStickyFeatures({ policy: { enabled: false } })),
      expected("updated", "policy", false),
    );
    h.check(() => act(() => sdk.setStickyFeatures({}, true)), expected("updated"));
    h.check(
      () =>
        act(() =>
          sdk.setStickyFeatures({
            policy: {
              enabled: true,
              variation: "pinned",
              variables: { value: { label: "pinned" } },
            },
          }),
        ),
      {
        ...expected("updated"),
        variation: "pinned",
        feature: { label: "pinned" },
      },
    );
    h.check(() => act(() => sdk.setStickyVariables({ policy: { labels: ["pinned"] } })), {
      flag: true,
      variation: "pinned",
      feature: { label: "pinned" },
      global: { labels: ["pinned"] },
    });
  });

  test.each(["flag", "variation", "feature", "global"] as const)(
    "catches changes during subscription setup for %s without another hook refreshing it",
    (kind) => {
      const sdk = instance();
      const original = sdk.on.bind(sdk);
      jest.spyOn(sdk, "on").mockImplementationOnce((event, callback) => {
        sdk.setStickyVariables({ gate: false });
        return original(event, callback);
      });
      const commits: unknown[] = [];
      const hooks = {
        flag: () => useFlag("policy"),
        variation: () => useVariation("policy"),
        feature: () => useVariable("policy", "value"),
        global: () => useVariable("policy"),
      };
      const useValue = hooks[kind];
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
      expect(commits[0]).toEqual(expected()[kind]);
      expect(commits[commits.length - 1]).toEqual(expected("first", "policy", false)[kind]);
      commits.length = 0;
      act(() => sdk.setStickyVariables({}, true));
      expect(commits.length).toBeGreaterThan(0);
      commits.forEach((value) => expect(value).toEqual(expected()[kind]));
    },
  );

  describe.each(["context", "datafile", "sticky features", "sticky variables"])(
    "missed %s event",
    (event) => {
      test.each(["mount", "provider", "feature"])(
        "catches SDK changes in layout effects before subscribing on %s",
        (change) => {
          const first = instance();
          const second = instance("second");
          const h = harness(first);
          const target = change === "provider" ? second : first;
          const key = change === "feature" ? "alternate" : "policy";
          let changed = false;
          const duringLayout = () => {
            if (changed) return;
            changed = true;
            if (event === "context") target.setContext({ account: { blocked: true } });
            else if (event === "datafile") target.setDatafile(datafile("between", false));
            else if (event === "sticky features")
              target.setStickyFeatures({
                policy: { enabled: false },
                alternate: { enabled: false },
              });
            else target.setStickyVariables({ gate: false });
          };
          const view = render(
            change === "mount" ? h.tree(target, key, {}, duringLayout) : h.tree(),
          );
          if (change !== "mount") {
            h.snapshots.length = 0;
            view.rerender(h.tree(target, key, {}, duringLayout));
          }
          const label = change === "provider" ? "second" : "first";
          const updated = expected(event === "datafile" ? "between" : label, key, false);
          expect(h.snapshots[0]).toEqual(expected(label, key));
          expect(h.snapshots[h.snapshots.length - 1]).toEqual(updated);
          h.snapshots.forEach((snapshot) =>
            expect([expected(label, key), updated]).toContainEqual(snapshot),
          );
          h.check(
            () =>
              act(() => {
                target.setContext({ account: { blocked: false } });
                target.setStickyFeatures({}, true);
                target.setStickyVariables({}, true);
                target.setDatafile(datafile(label));
              }),
            expected(label, key),
          );
        },
      );
    },
  );
});
