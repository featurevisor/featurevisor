import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createFeaturevisor, type Featurevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useEveryFlag } from "./useEveryFlag";
import { useFlag } from "./useFlag";
import { useFlags } from "./useFlags";
import { useRevision } from "./useRevision";
import { useSomeFlag } from "./useSomeFlag";
import { useVariable } from "./useVariable";
import { useVariation } from "./useVariation";

/** checkout has a variation and a variable, and is off for a blocked context. */
function datafile(revision = "first"): DatafileContent {
  return {
    schemaVersion: "4",
    revision,
    segments: {
      blocked: { conditions: [{ attribute: "blocked", operator: "equals", value: true }] },
    },
    features: {
      checkout: {
        hash: `${revision}-checkout`,
        bucketBy: "userId",
        variations: [{ value: "treatment", weight: 100 }],
        variablesSchema: { label: { type: "string", defaultValue: "Buy" } },
        traffic: [
          { key: "blocked", conditions: ["blocked"], percentage: 100000, enabled: false },
          {
            key: "all",
            conditions: "*",
            percentage: 100000,
            allocation: [{ variation: "treatment", range: [0, 100000] }],
          },
        ],
      },
      liveChat: {
        hash: `${revision}-liveChat`,
        bucketBy: "userId",
        traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
      },
    },
    variables: {
      supportEmail: { hash: "supportEmail", type: "string", defaultValue: "help@example.com" },
    },
  };
}

function instance() {
  const evaluated: string[] = [];
  const sdk = createFeaturevisor({
    logLevel: "fatal",
    datafile: datafile(),
    modules: [
      {
        name: "record",
        afterEvaluation: (evaluation) => {
          evaluated.push(evaluation.type);
          return evaluation;
        },
      },
    ],
  });
  return { sdk, evaluated };
}

/** Records every listener attached, and whether it was removed. */
function observe(sdk: Featurevisor) {
  const original = sdk.on.bind(sdk);
  const cleanups: jest.Mock[] = [];
  const on = jest.spyOn(sdk, "on").mockImplementation((event, callback) => {
    const cleanup = jest.fn(original(event, callback));
    cleanups.push(cleanup);
    return cleanup;
  });
  return { on, active: () => cleanups.filter((fn) => !fn.mock.calls.length) };
}

const HOOKS: Record<string, () => unknown> = {
  useFlag: () => useFlag("checkout"),
  useFlags: () => useFlags(["checkout", "liveChat"]),
  useEveryFlag: () => useEveryFlag(["checkout", "liveChat"]),
  useSomeFlag: () => useSomeFlag(["checkout", "liveChat"]),
  useVariation: () => useVariation("checkout"),
  "useVariable for a feature": () => useVariable("checkout", "label"),
  "useVariable for a global variable": () => useVariable("supportEmail"),
  useRevision: () => useRevision(),
};

describe("react: renders after subscribing", function () {
  test.each(Object.keys(HOOKS))(
    "%s renders its component once on mount, evaluating as one render does",
    function (name) {
      const { sdk, evaluated } = instance();
      let renders = 0;
      function Probe({ round }: { round: number }) {
        renders += 1;
        HOOKS[name]();
        return <p>{round}</p>;
      }

      const view = render(
        <FeaturevisorProvider instance={sdk}>
          <Probe round={1} />
        </FeaturevisorProvider>,
      );
      expect(renders).toBe(1);
      const onMount = evaluated.length;

      view.rerender(
        <FeaturevisorProvider instance={sdk}>
          <Probe round={2} />
        </FeaturevisorProvider>,
      );
      expect(renders).toBe(2);
      expect(evaluated.length).toBe(2 * onMount);
    },
  );

  test("a component mounted beside subscribed ones renders once", function () {
    const { sdk } = instance();
    let renders = 0;
    function Later() {
      renders += 1;
      useFlags(["checkout", "liveChat"]);
      return null;
    }
    function First() {
      useFlag("checkout");
      return null;
    }

    const view = render(
      <FeaturevisorProvider instance={sdk}>
        <First />
      </FeaturevisorProvider>,
    );
    view.rerender(
      <FeaturevisorProvider instance={sdk}>
        <First />
        <Later />
      </FeaturevisorProvider>,
    );
    expect(renders).toBe(1);
  });

  test("still renders again for a change made between rendering and subscribing", function () {
    const { sdk } = instance();
    function Reader() {
      const checkout = useFlag("checkout");
      React.useLayoutEffect(() => {
        sdk.setContext({ blocked: true });
      }, []);
      return <p data-testid="checkout">{String(checkout)}</p>;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <Reader />
      </FeaturevisorProvider>,
    );
    expect(screen.getByTestId("checkout")).toHaveTextContent("false");
  });

  test("catches a change made while the last subscribed hook leaves and a new one arrives", function () {
    // One commit unmounts the only subscribed hook and mounts another, after a
    // component whose mount effect sets the context. The count stops when the
    // old hook leaves, before the new one subscribes, and must not miss it.
    const { sdk } = instance();
    function Old() {
      useFlag("checkout");
      return null;
    }
    function SetBlocked() {
      React.useEffect(() => {
        sdk.setContext({ blocked: true });
      }, []);
      return null;
    }
    function New() {
      const checkout = useFlag("checkout");
      return <p data-testid="new">{String(checkout)}</p>;
    }

    const view = render(
      <FeaturevisorProvider instance={sdk}>
        <Old />
      </FeaturevisorProvider>,
    );
    view.rerender(
      <FeaturevisorProvider instance={sdk}>
        <SetBlocked />
        <New />
      </FeaturevisorProvider>,
    );
    expect(screen.getByTestId("new")).toHaveTextContent("false");
  });

  test("counts with one set of listeners per instance, removed after the last hook", async function () {
    const { sdk } = instance();
    const events = observe(sdk);
    function Reader({ featureKey }: { featureKey: string }) {
      useFlag(featureKey);
      return null;
    }

    const view = render(
      <FeaturevisorProvider instance={sdk}>
        <Reader featureKey="checkout" />
        <Reader featureKey="liveChat" />
        <Reader featureKey="checkout" />
      </FeaturevisorProvider>,
    );
    // Four for each hook, and four for the count.
    expect(events.on).toHaveBeenCalledTimes(3 * 4 + 4);
    expect(events.active()).toHaveLength(3 * 4 + 4);

    view.unmount();
    // The count stops a microtask after the last hook leaves.
    expect(events.active()).toHaveLength(4);
    await Promise.resolve();
    expect(events.active()).toHaveLength(0);

    // Events after unmounting render nothing and attach nothing.
    act(() => {
      sdk.setContext({ blocked: true });
      sdk.setDatafile(datafile("second"));
    });
    expect(events.on).toHaveBeenCalledTimes(3 * 4 + 4);
  });

  test("keeps values current in StrictMode", function () {
    const { sdk } = instance();
    function Reader() {
      const checkout = useFlag("checkout");
      return <p data-testid="checkout">{String(checkout)}</p>;
    }

    render(
      <React.StrictMode>
        <FeaturevisorProvider instance={sdk}>
          <Reader />
        </FeaturevisorProvider>
      </React.StrictMode>,
    );
    expect(screen.getByTestId("checkout")).toHaveTextContent("true");

    act(() => sdk.setContext({ blocked: true }));
    expect(screen.getByTestId("checkout")).toHaveTextContent("false");
  });

  test.each(Object.keys(HOOKS))(
    "%s renders as often as a component without hooks on mount in StrictMode",
    function (name) {
      // StrictMode cleans every effect up and sets it up again. That must not
      // stop the count in between, which would render every hook again.
      const { sdk } = instance();
      const renders = { probe: 0, control: 0 };
      function Probe() {
        renders.probe += 1;
        HOOKS[name]();
        return null;
      }
      function Control() {
        renders.control += 1;
        React.useState(0);
        return null;
      }

      render(
        <React.StrictMode>
          <FeaturevisorProvider instance={sdk}>
            <Probe />
            <Control />
          </FeaturevisorProvider>
        </React.StrictMode>,
      );
      expect(renders.probe).toBe(renders.control);
    },
  );

  test("renders once when the only hook on an instance changes its key", function () {
    const { sdk } = instance();
    const events = observe(sdk);
    let renders = 0;
    function Reader({ featureKey }: { featureKey: string }) {
      renders += 1;
      useFlag(featureKey);
      return null;
    }
    const tree = (featureKey: string) => (
      <FeaturevisorProvider instance={sdk}>
        <Reader featureKey={featureKey} />
      </FeaturevisorProvider>
    );

    const view = render(tree("checkout"));
    view.rerender(tree("liveChat"));
    expect(renders).toBe(2);
    // The count keeps its listeners while the hook resubscribes.
    expect(events.on).toHaveBeenCalledTimes(2 * 4 + 4);
  });
});
