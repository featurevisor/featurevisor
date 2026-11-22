import * as React from "react";
import { act, render } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createFeaturevisor, type Evaluation, type Featurevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";
import { useSource } from "@featurevisor/signals/react";

import {
  FeaturevisorProvider,
  FeaturevisorScope,
  useEveryFlag,
  useFlag,
  useFlags,
  useSignals,
  useSomeFlag,
  useVariable,
  useVariation,
} from "./index";

const everyone = { key: "everyone", conditions: "*" as const, percentage: 100000 };

function datafile(revision = "1", overrides: Partial<DatafileContent> = {}): DatafileContent {
  return {
    schemaVersion: "4",
    revision,
    segments: {
      dutch: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
    },
    features: {
      checkout: { hash: "c", bucketBy: "userId", traffic: [{ ...everyone, conditions: "dutch" }] },
      wishlist: {
        hash: "w",
        bucketBy: "userId",
        traffic: [everyone],
        variations: [{ value: "control" }, { value: "treatment" }],
        variablesSchema: {
          settings: { type: "object", defaultValue: { currency: "EUR", methods: ["card"] } },
        },
      },
      reviews: { hash: "r", bucketBy: "userId", traffic: [everyone] },
    },
    variables: {
      banner: {
        hash: "b",
        type: "string",
        defaultValue: "Welcome",
        overrides: [{ key: "dutch", conditions: "dutch", value: "Welkom" }],
      },
    },
    ...overrides,
  };
}

function setup() {
  const evaluations: Record<string, number> = {};
  const f = createFeaturevisor({
    datafile: datafile(),
    logLevel: "fatal",
    context: { userId: "user-1", country: "nl", plan: "free" },
    modules: [
      {
        name: "counting",
        afterEvaluation: (evaluation: Evaluation, options) => {
          if (!options.dependencyOf) {
            const key = evaluation.featureKey || evaluation.variableKey || "?";
            evaluations[key] = (evaluations[key] || 0) + 1;
          }
          return evaluation;
        },
      },
    ],
  });
  return { f, evaluations };
}

function listenerCount(f: Featurevisor) {
  const original = f.on.bind(f);
  const active = new Set<object>();
  jest.spyOn(f, "on").mockImplementation((event, callback) => {
    const token = {};
    active.add(token);
    const unsubscribe = original(event, callback);
    return () => {
      active.delete(token);
      unsubscribe();
    };
  });
  return () => active.size;
}

describe("precise updates in React", () => {
  test("a component renders only when its own value changes", () => {
    const { f, evaluations } = setup();
    const renders: Record<string, number> = {};
    function Flag({ name }: { name: string }) {
      renders[name] = (renders[name] || 0) + 1;
      return <span>{String(useFlag(name))}</span>;
    }
    render(
      <FeaturevisorProvider instance={f}>
        <Flag name="checkout" />
        <Flag name="reviews" />
      </FeaturevisorProvider>,
    );
    expect(renders).toEqual({ checkout: 1, reviews: 1 });
    expect(evaluations).toEqual({ checkout: 1, reviews: 1 });

    // Neither flag reads the plan.
    act(() => f.setContext({ plan: "pro" }));
    expect(renders).toEqual({ checkout: 1, reviews: 1 });
    expect(evaluations).toEqual({ checkout: 1, reviews: 1 });

    // Only checkout reads the country, and only its answer changes.
    act(() => f.setContext({ country: "de" }));
    expect(renders).toEqual({ checkout: 2, reviews: 1 });
    expect(evaluations).toEqual({ checkout: 2, reviews: 1 });
  });

  test("a parent rendering again evaluates nothing", () => {
    const { f, evaluations } = setup();
    function Child() {
      return <span>{String(useFlag("checkout", { userId: "user-1" }))}</span>;
    }
    function Parent({ tick }: { tick: number }) {
      return (
        <div data-tick={tick}>
          <Child />
        </div>
      );
    }
    const tree = (tick: number) => (
      <FeaturevisorProvider instance={f}>
        <Parent tick={tick} />
      </FeaturevisorProvider>
    );
    const view = render(tree(1));
    view.rerender(tree(2));
    view.rerender(tree(3));

    expect(evaluations.checkout).toBe(1);
  });

  test("an inline context with the same values asks nothing, and a new one asks in the same render", () => {
    const { f, evaluations } = setup();
    const seen: boolean[] = [];
    function Reader({ country }: { country: string }) {
      const value = useFlag("checkout", { country });
      seen.push(value);
      return null;
    }
    const tree = (country: string) => (
      <FeaturevisorProvider instance={f}>
        <Reader country={country} />
      </FeaturevisorProvider>
    );
    const view = render(tree("nl"));
    view.rerender(tree("nl"));
    expect(evaluations.checkout).toBe(1);

    view.rerender(tree("de"));
    expect(seen[seen.length - 1]).toBe(false);
    expect(evaluations.checkout).toBe(2);
  });

  test("a context changed in place and passed again reads as changed", () => {
    const { f } = setup();
    const context = { country: "nl" };
    let seen: boolean | undefined;
    function Reader() {
      seen = useFlag("checkout", context);
      return null;
    }
    const tree = () => (
      <FeaturevisorProvider instance={f}>
        <Reader />
      </FeaturevisorProvider>
    );
    const view = render(tree());
    expect(seen).toBe(true);
    context.country = "de";
    view.rerender(tree());
    expect(seen).toBe(false);
  });

  test("one set of listeners per instance, whatever the number of hooks, gone a microtask after the last", async () => {
    const { f } = setup();
    const count = listenerCount(f);
    function Many() {
      useFlag("checkout");
      useFlag("reviews");
      useVariation("wishlist");
      useVariable("wishlist", "settings");
      useVariable("banner");
      useFlags(["checkout", "reviews"]);
      useEveryFlag(["checkout", "reviews"]);
      useSomeFlag(["checkout", "reviews"]);
      return null;
    }
    const view = render(
      <React.StrictMode>
        <FeaturevisorProvider instance={f}>
          <Many />
          <Many />
        </FeaturevisorProvider>
      </React.StrictMode>,
    );
    expect(count()).toBe(4);

    view.unmount();
    expect(count()).toBe(4);
    await act(async () => {
      await Promise.resolve();
    });
    expect(count()).toBe(0);
  });

  test("empty lists listen to nothing", () => {
    const { f } = setup();
    const count = listenerCount(f);
    let values: unknown[] = [];
    function Empty() {
      values = [useFlags([]), useEveryFlag([] as never), useSomeFlag([] as never)];
      return null;
    }
    render(
      <FeaturevisorProvider instance={f}>
        <Empty />
      </FeaturevisorProvider>,
    );

    expect(values).toEqual([[], true, false]);
    expect(count()).toBe(0);
  });

  test("each component keeps its own copy, stable until the value changes", () => {
    const { f } = setup();
    const seen: Array<{ currency: string; methods: string[] } | null> = [];
    function Reader({ tick }: { tick: number }) {
      const settings = useVariable<{ currency: string; methods: string[] }>("wishlist", "settings");
      seen.push(settings);
      return <span data-tick={tick} />;
    }
    const tree = (tick: number) => (
      <FeaturevisorProvider instance={f}>
        <Reader tick={tick} />
        <Reader tick={tick} />
      </FeaturevisorProvider>
    );
    const view = render(tree(1));
    const [first, second] = seen;
    expect(first).toEqual({ currency: "EUR", methods: ["card"] });
    expect(first).not.toBe(second);

    first!.methods.push("changed in place");
    view.rerender(tree(2));
    expect(seen[2]).toBe(first);
    expect(seen[3]).toBe(second);
    expect(second).toEqual({ currency: "EUR", methods: ["card"] });
    expect(f.getVariable("wishlist", "settings")).toEqual({ currency: "EUR", methods: ["card"] });
  });

  test("useFlags keeps the same array while the values stay the same", () => {
    const { f } = setup();
    const seen: readonly boolean[][] = [];
    function Reader({ tick }: { tick: number }) {
      (seen as unknown as unknown[]).push(useFlags(["checkout", "reviews"]));
      return <span data-tick={tick} />;
    }
    const tree = (tick: number) => (
      <FeaturevisorProvider instance={f}>
        <Reader tick={tick} />
      </FeaturevisorProvider>
    );
    const view = render(tree(1));
    view.rerender(tree(2));
    act(() => f.setContext({ userId: "user-2" }));
    expect(seen[1]).toBe(seen[0]);

    act(() => f.setContext({ country: "de" }));
    expect(seen[seen.length - 1]).toEqual([false, true]);
  });

  test("datafiles and sticky values reach only the hooks they change", () => {
    const { f, evaluations } = setup();
    const renders: Record<string, number> = {};
    function Flag({ name }: { name: string }) {
      renders[name] = (renders[name] || 0) + 1;
      return <span>{String(useFlag(name))}</span>;
    }
    render(
      <FeaturevisorProvider instance={f}>
        <Flag name="checkout" />
        <Flag name="reviews" />
      </FeaturevisorProvider>,
    );

    act(() => {
      f.setDatafile({
        schemaVersion: "4",
        revision: "2",
        segments: {},
        features: { reviews: { hash: "r2", bucketBy: "userId", traffic: [] } },
      });
    });
    expect(renders).toEqual({ checkout: 1, reviews: 2 });

    act(() => f.setStickyFeatures({ checkout: { enabled: false } }));
    expect(renders).toEqual({ checkout: 2, reviews: 2 });
    expect(evaluations).toEqual({ checkout: 2, reviews: 2 });
  });

  test("scopes merge under each hook's context and update what they reach", () => {
    const { f } = setup();
    let seen: boolean | undefined;
    function Reader() {
      seen = useFlag("checkout");
      return null;
    }
    const tree = (country: string) => (
      <FeaturevisorProvider instance={f}>
        <FeaturevisorScope context={{ country }}>
          <Reader />
        </FeaturevisorScope>
      </FeaturevisorProvider>
    );
    const view = render(tree("de"));
    expect(seen).toBe(false);
    view.rerender(tree("nl"));
    expect(seen).toBe(true);
  });

  test("a module's changing state reaches hooks through the context", () => {
    let outside = "first";
    const f = createFeaturevisor({
      datafile: datafile(),
      logLevel: "fatal",
      context: { userId: "user-1", country: "nl" },
      modules: [
        {
          name: "outside",
          afterEvaluation: (evaluation, options) =>
            evaluation.variableKey === "banner"
              ? { ...evaluation, variableValue: String(options.context.label ?? outside) }
              : evaluation,
        },
      ],
    });
    let seen: unknown;
    function Reader({ label }: { label?: string }) {
      seen = useVariable("banner", label ? { label } : undefined);
      return null;
    }
    const tree = (label?: string) => (
      <FeaturevisorProvider instance={f}>
        <Reader label={label} />
      </FeaturevisorProvider>
    );
    const view = render(tree());
    outside = "second";
    act(() => f.setContext({ plan: "pro" }));

    // The banner does not read the plan, so state outside the context is not seen.
    expect(seen).toBe("first");

    // The same state passed through the context is.
    view.rerender(tree("third"));
    expect(seen).toBe("third");
  });

  test("a child instance works, following every change", () => {
    const { f } = setup();
    const child = f.spawn({ country: "de" });
    let seen: boolean | undefined;
    function Reader() {
      seen = useFlag("checkout");
      return null;
    }
    render(
      <FeaturevisorProvider instance={child as unknown as Featurevisor}>
        <Reader />
      </FeaturevisorProvider>,
    );
    expect(seen).toBe(false);
    act(() => child.setContext({ country: "nl" }));
    expect(seen).toBe(true);
  });

  test("useSignals gives the instance's reader, for package hooks", () => {
    const { f } = setup();
    let renders = 0;
    function Banner() {
      renders++;
      const fv = useSignals();
      const banner = React.useMemo(() => fv.variable("banner"), [fv]);
      return <span data-testid="banner">{String(useSource(banner))}</span>;
    }
    const view = render(
      <FeaturevisorProvider instance={f}>
        <Banner />
      </FeaturevisorProvider>,
    );
    expect(view.getByTestId("banner").textContent).toBe("Welkom");

    act(() => f.setContext({ plan: "pro" }));
    expect(renders).toBe(1);
    act(() => f.setContext({ country: "de" }));
    expect(view.getByTestId("banner").textContent).toBe("Welcome");
    expect(renders).toBe(2);
  });

  test("hydrating server HTML renders each component once, with no mismatch", () => {
    const { f } = setup();
    let renders = 0;
    function Wishlist() {
      renders++;
      const settings = useVariable<{ currency: string }>("wishlist", "settings");
      return (
        <p>
          {String(useFlag("checkout"))} {settings?.currency}
        </p>
      );
    }
    const app = (
      <FeaturevisorProvider instance={f}>
        <Wishlist />
      </FeaturevisorProvider>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(app);
    renders = 0;

    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    act(() => {
      root = hydrateRoot(container, app, { onRecoverableError: (error) => errors.push(error) });
    });

    expect(errors).toEqual([]);
    expect(renders).toBe(1);
    expect(container.textContent).toBe("true EUR");
    act(() => root?.unmount());
  });

  test("renders fifty components once on a context change none of them read", () => {
    const { f } = setup();
    let renders = 0;
    const names = Array.from({ length: 50 }, (_, index) => (index % 2 ? "checkout" : "reviews"));
    function Flag({ name }: { name: string }) {
      renders++;
      useFlag(name);
      return null;
    }
    function App() {
      return (
        <FeaturevisorProvider instance={f}>
          {names.map((name, index) => (
            <Flag key={index} name={name} />
          ))}
        </FeaturevisorProvider>
      );
    }
    render(<App />);
    renders = 0;
    act(() => f.setContext({ plan: "pro" }));
    expect(renders).toBe(0);

    // A change that alters one of them renders only the components showing it.
    act(() => f.setContext({ country: "de" }));
    expect(renders).toBe(25);
  });
});
