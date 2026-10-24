import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createFeaturevisor, type Featurevisor } from "@featurevisor/sdk";
import type { Context, DatafileContent, FeatureKey } from "@featurevisor/types";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useEveryFlag } from "./useEveryFlag";
import { useSomeFlag } from "./useSomeFlag";

const KEYS = ["checkout", "liveChat", "wishlist"];

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
          traffic: [
            { key: "blocked", conditions: ["blocked"], percentage: 100000, enabled: false },
            { key: "all", conditions: "*", percentage: off.includes(key) ? 0 : 100000 },
          ],
        },
      ]),
    ),
  };
}

/** An instance with a module that records each flag evaluation, in order. */
function instance(off: readonly string[] = []) {
  const evaluated: string[] = [];
  const sdk = createFeaturevisor({
    logLevel: "fatal",
    datafile: datafile("first", off),
    modules: [
      {
        name: "record",
        afterEvaluation: (evaluation) => {
          if (evaluation.type === "flag") evaluated.push(evaluation.featureKey);
          return evaluation;
        },
      },
    ],
  });
  return { sdk, evaluated };
}

let renders = 0;

function Aggregates({ keys, context }: { keys: readonly FeatureKey[]; context?: Context }) {
  renders += 1;
  const every = useEveryFlag(keys, context);
  const some = useSomeFlag(keys, context);
  return <p data-testid="aggregates">{`every:${every} some:${some}`}</p>;
}

function tree(sdk: Featurevisor, keys: readonly FeatureKey[], context?: Context) {
  return (
    <FeaturevisorProvider instance={sdk}>
      <Aggregates keys={keys} context={context} />
    </FeaturevisorProvider>
  );
}

const text = () => screen.getByTestId("aggregates").textContent;

beforeEach(() => {
  renders = 0;
});

describe("react: useEveryFlag and useSomeFlag", function () {
  test.each([
    [[], "every:true some:true"],
    [["liveChat"], "every:false some:true"],
    [["checkout", "liveChat"], "every:false some:true"],
    [KEYS, "every:false some:false"],
  ])("with %j off, returns %s", function (off, expected) {
    render(tree(instance(off).sdk, KEYS));
    expect(text()).toBe(expected);
  });

  test("passes the context to the evaluations", function () {
    const view = render(tree(instance().sdk, KEYS));
    expect(text()).toBe("every:true some:true");

    view.rerender(tree(instance().sdk, KEYS, { blocked: true }));
    expect(text()).toBe("every:false some:false");
  });

  test("count a feature missing from the datafile as disabled", function () {
    render(tree(instance().sdk, ["checkout", "missing"]));
    expect(text()).toBe("every:false some:true");
  });

  test("useEveryFlag stops evaluating at the first disabled feature", function () {
    const { sdk, evaluated } = instance(["liveChat"]);
    function Every() {
      return <p>{String(useEveryFlag(["checkout", "liveChat", "wishlist"]))}</p>;
    }
    render(
      <FeaturevisorProvider instance={sdk}>
        <Every />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("false")).toBeInTheDocument();
    expect(evaluated.length).toBeGreaterThan(0);
    expect(evaluated).not.toContain("wishlist");
    expect(evaluated.filter((key) => key === "checkout")).toHaveLength(
      evaluated.filter((key) => key === "liveChat").length,
    );
  });

  test("evaluate a key listed twice once", function () {
    const { sdk, evaluated } = instance(["wishlist"]);
    let renders = 0;
    function Repeated() {
      renders += 1;
      const every = useEveryFlag(["checkout", "checkout", "liveChat", "checkout"]);
      const some = useSomeFlag(["wishlist", "wishlist", "liveChat"]);
      return <p>{`${every}:${some}`}</p>;
    }
    render(
      <FeaturevisorProvider instance={sdk}>
        <Repeated />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("true:true")).toBeInTheDocument();
    const count = (key: string) => evaluated.filter((evaluatedKey) => evaluatedKey === key).length;
    expect(count("checkout")).toBe(renders);
    expect(count("wishlist")).toBe(renders);
    // Once for each hook.
    expect(count("liveChat")).toBe(2 * renders);
  });

  test("useSomeFlag stops evaluating at the first enabled feature", function () {
    const { sdk, evaluated } = instance(["checkout"]);
    function Some() {
      return <p>{String(useSomeFlag(["checkout", "liveChat", "wishlist"]))}</p>;
    }
    render(
      <FeaturevisorProvider instance={sdk}>
        <Some />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("true")).toBeInTheDocument();
    expect(evaluated.length).toBeGreaterThan(0);
    expect(evaluated).not.toContain("wishlist");
  });

  test("react to a change in a feature they stopped before", function () {
    const { sdk } = instance(["checkout"]);
    render(tree(sdk, ["checkout", "liveChat"]));
    expect(text()).toBe("every:false some:true");

    // liveChat was not evaluated by useEveryFlag, but is still subscribed to.
    act(() => sdk.setDatafile(datafile("first", ["checkout", "liveChat"])));
    expect(text()).toBe("every:false some:false");

    act(() => sdk.setDatafile(datafile("first")));
    expect(text()).toBe("every:true some:true");
  });

  test("re-render on context and sticky changes, and not for unlisted features", function () {
    const { sdk } = instance();
    render(tree(sdk, ["checkout", "liveChat"]));

    const before = renders;
    act(() => sdk.setDatafile(datafile("first", ["wishlist"])));
    expect(renders).toBe(before);

    act(() => sdk.setStickyFeatures({ checkout: { enabled: false } }));
    expect(text()).toBe("every:false some:true");
    act(() => sdk.setContext({ blocked: true }));
    expect(text()).toBe("every:false some:false");
    act(() => {
      sdk.setContext({ blocked: false });
      sdk.setStickyFeatures({}, true);
    });
    expect(text()).toBe("every:true some:true");
  });

  test("follow Array semantics for an empty list built at runtime", function () {
    const { sdk } = instance();
    const keys: FeatureKey[] = [];
    render(tree(sdk, keys));
    expect(text()).toBe("every:true some:false");
  });

  test("subscribe once each for an inline list, and remove their listeners on unmount", async function () {
    const { sdk } = instance();
    const original = sdk.on.bind(sdk);
    const cleanups: jest.Mock[] = [];
    const on = jest.spyOn(sdk, "on").mockImplementation((event, callback) => {
      const cleanup = jest.fn(original(event, callback));
      cleanups.push(cleanup);
      return cleanup;
    });

    const view = render(tree(sdk, ["checkout", "liveChat"]));
    view.rerender(tree(sdk, ["checkout", "liveChat"]));
    view.rerender(tree(sdk, ["checkout", "liveChat"], { userId: "user-1" }));
    // Four each, and four for the change tracker.
    expect(on).toHaveBeenCalledTimes(12);

    view.unmount();
    // The change tracker stops a microtask after the last hook on an instance leaves.
    await Promise.resolve();
    cleanups.forEach((cleanup) => expect(cleanup).toHaveBeenCalledTimes(1));
  });

  test("reject a literal empty list at compile time", function () {
    function Types() {
      // @ts-expect-error a literal empty list is rejected
      const every = useEveryFlag([]);
      // @ts-expect-error a literal empty list is rejected
      const some = useSomeFlag([]);
      const keys: readonly FeatureKey[] = ["checkout"];
      const runtime: boolean = useEveryFlag(keys) && useSomeFlag(keys);
      return <p data-testid="types">{`${every} ${some} ${runtime}`}</p>;
    }

    render(
      <FeaturevisorProvider instance={instance().sdk}>
        <Types />
      </FeaturevisorProvider>,
    );
    expect(screen.getByTestId("types")).toHaveTextContent("true false true");
  });
});
