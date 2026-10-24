import * as React from "react";
import { act, render, screen } from "@testing-library/react";

import { createFeaturevisor, type Featurevisor } from "@featurevisor/sdk";
import type { Context, DatafileContent, VariableValue } from "@featurevisor/types";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useVariable } from "./useVariable";

function programDatafile(array = false, attribute = "country", grant = "read"): DatafileContent {
  return {
    schemaVersion: "2",
    revision: grant,
    segments: {},
    features: {
      policy: {
        hash: `feature-${grant}`,
        bucketBy: "userId",
        conditions: [{ variable: "gate", operator: "equals", value: true }],
        traffic: [{ key: "all", segments: "*", percentage: 100000 }],
        variablesSchema: {
          grants: { type: "json", defaultValue: { grants: [`feature-${grant}`] } },
          alternate: { type: "json", defaultValue: ["alternate"] },
        },
      },
    },
    variables: {
      gate: { hash: "gate-true", type: "boolean", defaultValue: true },
      policy: {
        hash: `policy-${grant}`,
        type: "json",
        defaultValue: array ? [] : { grants: [] },
        disabledValue: array ? ["blocked"] : { grants: ["blocked"] },
        conditions: [{ variable: "gate", operator: "equals", value: true }],
        overrideProgram: [
          {
            key: "grant",
            keyPath: ["grant"],
            conditions: { attribute, operator: "equals", value: "nl" },
            operations: [{ op: "append", path: array ? [] : ["grants"], value: grant }],
            onMatch: 1,
            onMiss: 1,
          },
        ],
      },
    },
  };
}

function expectValue(value: unknown) {
  expect(screen.getByTestId("value").textContent).toBe(JSON.stringify(value));
}

// Stop a regression deterministically instead of letting an effect loop hang Jest.
function renderGuard() {
  let renders = 0;
  return jest.fn(() => {
    if (++renders > 40) throw new Error("useVariable did not settle");
  });
}

function observeSubscriptions(sdk: Featurevisor) {
  const original = sdk.on.bind(sdk);
  const cleanups: jest.Mock[] = [];
  const on = jest.spyOn(sdk, "on").mockImplementation((event, callback) => {
    const cleanup = jest.fn(original(event, callback));
    cleanups.push(cleanup);
    return cleanup;
  });
  return { on, cleanups };
}

describe("react: useVariable evaluation and subscriptions", () => {
  test("resolves the SDK source rather than a potentially stale package build", () => {
    expect(createFeaturevisor).toBe(jest.requireActual("../../sdk/src").createFeaturevisor);
  });

  describe.each([false, true])("StrictMode: %s", (strict) => {
    test.each([
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ])("settles runtime arrays: %s with nested inline context: %s", (array, nested) => {
      const sdk = createFeaturevisor({
        logLevel: "fatal",
        datafile: programDatafile(array, nested ? "account.country" : "country"),
      });
      const context = nested ? { account: { country: "nl" } } : { country: "nl" };
      const first = sdk.getVariable("policy", context);
      expect(first).toEqual(array ? ["read"] : { grants: ["read"] });
      expect(sdk.getVariable("policy", context)).not.toBe(first);
      const on = jest.spyOn(sdk, "on");
      const guard = renderGuard();

      function Reader({ country }: { country: string }) {
        guard();
        const value = useVariable(
          "policy",
          nested ? { userId: "123", account: { country } } : { userId: "123", country },
        );
        return <span data-testid="value">{JSON.stringify(value)}</span>;
      }
      const tree = (country = "nl") => {
        const content = (
          <FeaturevisorProvider instance={sdk}>
            <Reader country={country} />
          </FeaturevisorProvider>
        );
        return strict ? <React.StrictMode>{content}</React.StrictMode> : content;
      };
      const view = render(tree());
      expectValue(array ? ["read"] : { grants: ["read"] });
      const subscriptions = on.mock.calls.length;
      const renders = guard.mock.calls.length;

      view.rerender(tree());
      view.rerender(tree());
      expectValue(array ? ["read"] : { grants: ["read"] });
      expect(guard.mock.calls.length - renders).toBeLessThanOrEqual(4);
      expect(on).toHaveBeenCalledTimes(subscriptions);

      view.rerender(tree("de"));
      expectValue(array ? [] : { grants: [] });
      view.rerender(tree("nl"));
      expectValue(array ? ["read"] : { grants: ["read"] });
      expect(on).toHaveBeenCalledTimes(subscriptions);

      act(() => sdk.setStickyVariables({ policy: array ? ["sticky"] : { grants: ["sticky"] } }));
      expectValue(array ? ["sticky"] : { grants: ["sticky"] });
      act(() => sdk.setStickyVariables({}, true));
      expectValue(array ? ["read"] : { grants: ["read"] });
      act(() =>
        sdk.setDatafile(programDatafile(array, nested ? "account.country" : "country", "write")),
      );
      expectValue(array ? ["write"] : { grants: ["write"] });

      view.unmount();
      const finalRenders = guard.mock.calls.length;
      act(() => sdk.setContext({ country: "de" }));
      expect(guard).toHaveBeenCalledTimes(finalRenders);
      on.mockRestore();
    });
  });

  test("reads mutations to an existing nested context and uses the latest context on events", () => {
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: programDatafile(false, "account.country"),
    });
    const context = { userId: "123", account: { country: "nl" } };
    function Reader() {
      return <span data-testid="value">{JSON.stringify(useVariable("policy", context))}</span>;
    }
    const tree = () => (
      <FeaturevisorProvider instance={sdk}>
        <Reader />
      </FeaturevisorProvider>
    );
    const view = render(tree());
    expectValue({ grants: ["read"] });
    context.account.country = "de";
    view.rerender(tree());
    expectValue({ grants: [] });
    context.account.country = "nl";
    act(() => sdk.setDatafile(programDatafile(false, "account.country", "write")));
    expectValue({ grants: ["write"] });
  });

  test("follows dependency hashes and sticky prerequisites without subscribing to unrelated updates", () => {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: programDatafile() });
    const guard = renderGuard();
    function Reader() {
      guard();
      return (
        <span data-testid="value">{JSON.stringify(useVariable("policy", { country: "nl" }))}</span>
      );
    }
    render(
      <FeaturevisorProvider instance={sdk}>
        <Reader />
      </FeaturevisorProvider>,
    );
    expectValue({ grants: ["read"] });
    const renders = guard.mock.calls.length;
    act(() =>
      sdk.setDatafile({
        schemaVersion: "2",
        revision: "unrelated",
        segments: {},
        features: {},
        variables: { unrelated: { hash: "new", type: "boolean", defaultValue: false } },
      }),
    );
    expect(guard).toHaveBeenCalledTimes(renders);
    act(() =>
      sdk.setDatafile({
        schemaVersion: "2",
        revision: "gate",
        segments: {},
        features: {},
        variables: { gate: { hash: "gate-false", type: "boolean", defaultValue: false } },
      }),
    );
    expectValue({ grants: ["blocked"] });
    act(() => sdk.setStickyVariables({ gate: true }));
    expectValue({ grants: ["read"] });
    act(() => sdk.setStickyVariables({}, true));
    expectValue({ grants: ["blocked"] });
  });

  test("switches feature and global subscriptions, variable keys and provider instances with cleanup", async () => {
    const first = createFeaturevisor({
      logLevel: "fatal",
      datafile: programDatafile(),
      context: { country: "nl" },
    });
    const second = createFeaturevisor({
      logLevel: "fatal",
      datafile: programDatafile(false, "country", "second"),
      context: { country: "nl" },
    });
    const firstSubscriptions = observeSubscriptions(first);
    const secondSubscriptions = observeSubscriptions(second);
    const guard = renderGuard();
    function Reader({ featureVariable, keyName }: { featureVariable?: string; keyName: string }) {
      guard();
      const value = useVariable(keyName, featureVariable, { userId: "123" });
      return <span data-testid="value">{JSON.stringify(value)}</span>;
    }
    const tree = (sdk = first, featureVariable?: string, keyName = "policy") => (
      <React.StrictMode>
        <FeaturevisorProvider instance={sdk}>
          <Reader featureVariable={featureVariable} keyName={keyName} />
        </FeaturevisorProvider>
      </React.StrictMode>
    );
    const view = render(tree());
    expectValue({ grants: ["read"] });
    // StrictMode must leave just one set of four active listeners, plus the
    // change tracker's four.
    const active = () =>
      firstSubscriptions.cleanups.filter((cleanup) => cleanup.mock.calls.length === 0);
    expect(active()).toHaveLength(8);
    const globalCleanups = active();
    view.rerender(tree(first, "grants"));
    expectValue({ grants: ["feature-read"] });
    // The hook swaps the global variable's four listeners for the feature's,
    // while the change tracker keeps its four through the resubscription.
    const called = (cleanup: jest.Mock) => cleanup.mock.calls.length;
    expect(globalCleanups.map(called).sort()).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(active()).toHaveLength(8);

    const subscriptions = firstSubscriptions.on.mock.calls.length;
    view.rerender(tree(first, "alternate"));
    expectValue(["alternate"]);
    expect(firstSubscriptions.on).toHaveBeenCalledTimes(subscriptions);
    act(() =>
      first.setStickyFeatures({ policy: { enabled: true, variables: { alternate: ["sticky"] } } }),
    );
    expectValue(["sticky"]);
    act(() => first.setStickyFeatures({}, true));
    expectValue(["alternate"]);

    view.rerender(tree(first, "grants", "missing"));
    expectValue(null);
    view.rerender(tree(first, "grants"));
    expectValue({ grants: ["feature-read"] });
    const renders = guard.mock.calls.length;
    act(() =>
      first.setDatafile({
        schemaVersion: "2",
        revision: "global-only",
        segments: {},
        features: {},
        variables: { policy: { hash: "global-only", type: "json", defaultValue: ["global-only"] } },
      }),
    );
    expect(guard).toHaveBeenCalledTimes(renders);
    act(() => first.setDatafile(programDatafile(false, "country", "updated")));
    expectValue({ grants: ["feature-updated"] });

    view.rerender(tree(second));
    expectValue({ grants: ["second"] });
    // The change tracker stops a microtask after the last hook on an instance leaves.
    await Promise.resolve();
    firstSubscriptions.cleanups.forEach((cleanup) => expect(cleanup).toHaveBeenCalledTimes(1));
    const afterSwap = guard.mock.calls.length;
    act(() => first.setContext({ country: "de" }));
    expect(guard).toHaveBeenCalledTimes(afterSwap);
    act(() => second.setContext({ country: "de" }));
    expectValue({ grants: [] });
    view.rerender(tree(second, undefined, "gate"));
    expectValue(true);
    view.unmount();
    await Promise.resolve();
    secondSubscriptions.cleanups.forEach((cleanup) => expect(cleanup).toHaveBeenCalledTimes(1));
    firstSubscriptions.on.mockRestore();
    secondSubscriptions.on.mockRestore();
  });

  test("updates feature variables when only a prerequisite hash or sticky value changes", () => {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: programDatafile() });
    function Reader() {
      return (
        <span data-testid="value">
          {JSON.stringify(useVariable("policy", "grants", { userId: "123" }))}
        </span>
      );
    }
    render(
      <FeaturevisorProvider instance={sdk}>
        <Reader />
      </FeaturevisorProvider>,
    );
    expectValue({ grants: ["feature-read"] });
    act(() =>
      sdk.setDatafile({
        schemaVersion: "2",
        revision: "gate",
        segments: {},
        features: {},
        variables: { gate: { hash: "gate-false", type: "boolean", defaultValue: false } },
      }),
    );
    expectValue(null);
    act(() => sdk.setStickyVariables({ gate: true }));
    expectValue({ grants: ["feature-read"] });
    act(() => sdk.setStickyVariables({}, true));
    expectValue(null);
  });

  test.each([false, true])(
    "reevaluates module values and context without serialization (feature: %s)",
    async (feature) => {
      const sdk = createFeaturevisor({ logLevel: "fatal", datafile: programDatafile() });
      const guard = renderGuard();
      const date = new Date("2026-01-01T00:00:00Z");
      const context: Context = { date, number: -0, explicit: undefined };
      context.self = context;
      const received: Context[] = [];
      sdk.addModule({
        name: "context",
        afterEvaluation: (evaluation, options) => {
          if (evaluation.variableKey !== (feature ? "grants" : "policy")) return evaluation;
          received.push(options.context);
          return {
            ...evaluation,
            variableValue: {
              date: options.context.date instanceof Date,
              negativeZero: Object.is(options.context.number, -0),
              explicit: Object.prototype.hasOwnProperty.call(options.context, "explicit"),
            },
          };
        },
      });
      function Reader({ callContext }: { callContext: Context }) {
        guard();
        const value = feature
          ? useVariable("policy", "grants", callContext)
          : useVariable("policy", callContext);
        return <span data-testid="value">{JSON.stringify(value)}</span>;
      }
      const tree = (callContext = context) => (
        <FeaturevisorProvider instance={sdk}>
          <Reader callContext={callContext} />
        </FeaturevisorProvider>
      );
      const view = render(tree());
      expectValue({ date: true, negativeZero: true, explicit: true });
      expect(received[received.length - 1].date).toBe(date);
      expect(received[received.length - 1].self).toBe(context);
      view.rerender(tree({ date: date.toISOString(), number: 0 }));
      expectValue({ date: false, negativeZero: false, explicit: false });

      await act(async () => {
        await sdk.removeModule("context");
      });
      view.rerender(tree());
      expectValue(feature ? { grants: ["feature-read"] } : { grants: [] });
      sdk.addModule({
        name: "replacement",
        afterEvaluation: (evaluation) =>
          evaluation.variableKey === (feature ? "grants" : "policy")
            ? { ...evaluation, variableValue: ["module"] }
            : evaluation,
      });
      view.rerender(tree());
      expectValue(["module"]);
    },
  );

  test.each([false, true])(
    "never invokes a function returned by a module (feature: %s)",
    (feature) => {
      const first = jest.fn(() => "must not run");
      const second = jest.fn(() => "must not run either");
      let result = first;
      const sdk = createFeaturevisor({
        logLevel: "fatal",
        datafile: programDatafile(),
        modules: [
          {
            afterEvaluation: (evaluation) =>
              evaluation.variableKey === (feature ? "grants" : "policy")
                ? { ...evaluation, variableValue: result as unknown as VariableValue }
                : evaluation,
          },
        ],
      });
      let observed: (() => string) | null = null;
      function Reader() {
        observed = feature
          ? useVariable<() => string>("policy", "grants", { userId: "123" })
          : useVariable<() => string>("policy", { userId: "123" });
        return null;
      }
      const tree = () => (
        <React.StrictMode>
          <FeaturevisorProvider instance={sdk}>
            <Reader />
          </FeaturevisorProvider>
        </React.StrictMode>
      );
      const view = render(tree());
      expect(observed).toBe(first);
      result = second;
      act(() => sdk.setContext({ country: "nl" }));
      expect(observed).toBe(second);
      view.rerender(tree());
      expect(observed).toBe(second);
      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();
    },
  );

  test.each([false, true])(
    "catches SDK updates between rendering and subscribing (feature: %s)",
    (feature) => {
      const sdk = createFeaturevisor({ logLevel: "fatal", datafile: programDatafile() });
      function Reader() {
        const value = feature
          ? useVariable("policy", "grants", { userId: "123" })
          : useVariable("policy", { country: "nl" });
        React.useLayoutEffect(() => {
          sdk.setDatafile(programDatafile(false, "country", "between"));
        }, []);
        return <span data-testid="value">{JSON.stringify(value)}</span>;
      }
      render(
        <FeaturevisorProvider instance={sdk}>
          <Reader />
        </FeaturevisorProvider>,
      );
      expectValue({ grants: [feature ? "feature-between" : "between"] });
    },
  );

  test.each([false, true])(
    "keeps child state isolated while following parent datafiles and modules (feature: %s)",
    async (feature) => {
      const parent = createFeaturevisor({ logLevel: "fatal", datafile: programDatafile() });
      const child = parent.spawn({ country: "nl" });
      const sibling = parent.spawn({ country: "de" });
      const guard = renderGuard();
      function Reader() {
        guard();
        const value = feature
          ? useVariable("policy", "grants", { userId: "123" })
          : useVariable("policy", { userId: "123" });
        return <span data-testid="value">{JSON.stringify(value)}</span>;
      }
      // The provider currently types only primary instances; children implement
      // the getter and subscription surface consumed by this hook as well.
      const tree = () => (
        <FeaturevisorProvider instance={child as unknown as Featurevisor}>
          <Reader />
        </FeaturevisorProvider>
      );
      const view = render(tree());
      expectValue({ grants: [feature ? "feature-read" : "read"] });
      const renders = guard.mock.calls.length;
      act(() => parent.setStickyVariables({ policy: { grants: ["parent"] } }));
      act(() => sibling.setStickyVariables({ policy: { grants: ["sibling"] } }));
      act(() => parent.setStickyFeatures({ policy: { enabled: false } }));
      act(() => sibling.setStickyFeatures({ policy: { enabled: false } }));
      expect(guard).toHaveBeenCalledTimes(renders);
      act(() => child.setContext({ country: "de" }));
      expectValue({ grants: feature ? ["feature-read"] : [] });
      act(() => child.setContext({ country: "nl" }));
      act(() => {
        if (feature)
          child.setStickyFeatures({
            policy: { enabled: true, variables: { grants: { grants: ["child"] } } },
          });
        else child.setStickyVariables({ policy: { grants: ["child"] } });
      });
      expectValue({ grants: ["child"] });
      act(() => {
        child.setStickyFeatures({}, true);
        child.setStickyVariables({}, true);
      });
      expectValue({ grants: [feature ? "feature-read" : "read"] });
      act(() => parent.setDatafile(programDatafile(false, "country", "parent-update")));
      expectValue({ grants: [feature ? "feature-parent-update" : "parent-update"] });
      parent.addModule({
        name: "child-module",
        afterEvaluation: (evaluation) =>
          evaluation.variableKey === (feature ? "grants" : "policy")
            ? { ...evaluation, variableValue: { grants: ["module"] } }
            : evaluation,
      });
      view.rerender(tree());
      expectValue({ grants: ["module"] });
      await act(async () => {
        await parent.removeModule("child-module");
      });
      act(() => child.setContext({ country: "nl" }));
      expectValue({ grants: [feature ? "feature-parent-update" : "parent-update"] });
      view.unmount();
      child.close();
      sibling.close();
    },
  );
});
