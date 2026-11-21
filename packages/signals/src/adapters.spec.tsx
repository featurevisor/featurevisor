import * as React from "react";
import { act, render } from "@testing-library/react";
import { effect, signal } from "@preact/signals-core";
import { Signal } from "signal-polyfill";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createFeaturevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

import { createSignals } from "./index";
import { createSignals as createPreactSignals } from "./preact";
import { createSignals as createTc39Signals } from "./tc39";
import { useSource } from "./react";
import { useSource as useVueSource } from "./vue";
import { getEngine } from "./engine";

const everyone = { key: "everyone", conditions: "*" as const, percentage: 100000 };

function datafile(): DatafileContent {
  return {
    schemaVersion: "4",
    revision: "1",
    segments: {
      dutch: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
    },
    features: {
      checkout: { hash: "c", bucketBy: "userId", traffic: [{ ...everyone, conditions: "dutch" }] },
      liveChat: { hash: "l", bucketBy: "userId", traffic: [{ ...everyone, conditions: "dutch" }] },
      reviews: { hash: "r", bucketBy: "userId", traffic: [everyone] },
    },
  };
}

function instance() {
  return createFeaturevisor({
    datafile: datafile(),
    logLevel: "fatal",
    context: { userId: "user-1", country: "nl", plan: "free" },
  });
}

describe("Preact", () => {
  test("effects run only when a value changes, once per SDK change", () => {
    const f = instance();
    const fv = createPreactSignals(f);
    const checkout = fv.flag("checkout");
    const liveChat = fv.flag("liveChat");
    const reviews = fv.flag("reviews");
    const runs: string[] = [];

    const stopBoth = effect(() => {
      runs.push(`both ${checkout.value} ${liveChat.value}`);
    });
    const stopReviews = effect(() => {
      runs.push(`reviews ${reviews.value}`);
    });
    expect(runs).toEqual(["both true true", "reviews true"]);

    f.setContext({ plan: "pro" });
    expect(runs).toHaveLength(2);

    // Both flags change in one event, and the batch runs their effect once.
    f.setContext({ country: "de" });
    expect(runs).toEqual(["both true true", "reviews true", "both false false"]);

    stopBoth();
    stopReviews();
  });

  test("a context set inside an effect does not tie that effect to the values", () => {
    const f = instance();
    const productId = signal("1");
    const country = signal("nl");
    const checkout = createPreactSignals(f).flag("checkout", () => ({
      productId: productId.value,
    }));
    const seen: boolean[] = [];
    const stopWatch = effect(() => void seen.push(checkout.value));
    let runs = 0;
    const stopSync = effect(() => {
      runs++;
      f.setContext({ country: country.value });
    });

    country.value = "de";
    expect(seen).toEqual([true, false]);
    expect(runs).toBe(2);

    productId.value = "2";
    expect(runs).toBe(2);
    stopSync();
    stopWatch();
  });

  test("listens to the instance only while an effect watches", async () => {
    const f = instance();
    const checkout = createPreactSignals(f).flag("checkout");
    expect(checkout.value).toBe(true);

    const stop = effect(() => void checkout.value);
    expect(getEngine(f).attached).toBe(true);
    stop();
    await Promise.resolve();
    expect(getEngine(f).attached).toBe(false);
  });
});

describe("TC39 signals", () => {
  test("a watcher is told only when a value changes", async () => {
    const f = instance();
    const fv = createTc39Signals(f);
    const checkout = fv.flag("checkout");
    let notified = 0;
    const watcher = new Signal.subtle.Watcher(() => {
      notified++;
    });
    watcher.watch(checkout);
    expect(checkout.get()).toBe(true);

    f.setContext({ plan: "pro" });
    expect(notified).toBe(0);

    f.setContext({ country: "de" });
    expect(notified).toBe(1);
    expect(checkout.get()).toBe(false);

    watcher.unwatch(checkout);
    await Promise.resolve();
    expect(getEngine(f).attached).toBe(false);
  });

  test("a context set inside a computed, as Lit's effects run, does not tie it to the values", () => {
    const f = instance();
    const productId = new Signal.State("1");
    const country = new Signal.State("nl");
    const checkout = createTc39Signals(f).flag("checkout", () => ({ productId: productId.get() }));
    let runs = 0;
    const sync = new Signal.Computed(() => {
      runs++;
      f.setContext({ country: country.get() });
      return country.get();
    });
    const watcher = new Signal.subtle.Watcher(() => {});
    watcher.watch(checkout);
    expect(checkout.get()).toBe(true);
    expect(sync.get()).toBe("nl");

    country.set("de");
    expect(sync.get()).toBe("de");
    expect(checkout.get()).toBe(false);
    expect(runs).toBe(2);

    productId.set("2");
    expect(sync.get()).toBe("de");
    expect(runs).toBe(2);
    watcher.unwatch(checkout);
  });
});

describe("React useSource", () => {
  test("renders only when the value changes", () => {
    const f = instance();
    const checkout = createSignals(f).flag("checkout");
    let renders = 0;
    function Checkout() {
      renders++;
      return <span data-testid="value">{String(useSource(checkout))}</span>;
    }
    const view = render(<Checkout />);
    act(() => f.setContext({ plan: "pro" }));
    expect(renders).toBe(1);

    act(() => f.setContext({ country: "de" }));
    expect(view.getByTestId("value").textContent).toBe("false");
    expect(renders).toBe(2);
  });

  test("renders in one pass without useSyncExternalStore, as React 16.8 and 17 do", () => {
    jest.isolateModules(() => {
      // The same React that react-dom renders with, without useSyncExternalStore.
      jest.doMock("react", () => ({ ...React, useSyncExternalStore: undefined }));
      const { useSource: useSourceInOnePass } = require("./react") as typeof import("./react");
      const f = instance();
      const checkout = createSignals(f).flag("checkout");
      let renders = 0;
      function Checkout() {
        renders++;
        return <span data-testid="one-pass">{String(useSourceInOnePass(checkout))}</span>;
      }
      const view = render(<Checkout />);
      act(() => f.setContext({ plan: "pro" }));
      expect(renders).toBe(1);

      act(() => f.setContext({ country: "de" }));
      expect(view.getByTestId("one-pass").textContent).toBe("false");
      expect(renders).toBe(2);
      view.unmount();
    });
  });
});

describe("Vue useSource", () => {
  test("a ref that renders only when the value changes", async () => {
    const f = instance();
    const checkout = createSignals(f).flag("checkout");
    let renders = 0;
    const wrapper = mount(
      defineComponent({
        setup() {
          const value = useVueSource(checkout);
          return () => {
            renders++;
            return h("p", String(value.value));
          };
        },
      }),
    );
    f.setContext({ plan: "pro" });
    await nextTick();
    expect(renders).toBe(1);

    f.setContext({ country: "de" });
    await nextTick();
    expect(wrapper.text()).toBe("false");
    expect(renders).toBe(2);
    wrapper.unmount();
  });
});
