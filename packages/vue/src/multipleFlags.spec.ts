import { defineComponent, h, isRef, nextTick, type App, type Plugin } from "vue";
import { mount } from "@vue/test-utils";
import type { Featurevisor } from "@featurevisor/sdk";
import type { DatafileContent, FeatureKey } from "@featurevisor/types";

import { setupApp } from "./setupApp";
import { useFlag } from "./useFlag";
import { useFlags } from "./useFlags";
import { useEveryFlag } from "./useEveryFlag";
import { useSomeFlag } from "./useSomeFlag";

const { createFeaturevisor } = jest.requireActual(
  "../../sdk/src",
) as typeof import("@featurevisor/sdk");

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsExact<TActual, TExpected> =
  IsAny<TActual> extends true
    ? IsAny<TExpected>
    : IsAny<TExpected> extends true
      ? false
      : [TActual] extends [TExpected]
        ? [TExpected] extends [TActual]
          ? true
          : false
        : false;

function expectExactType<T extends true>(value: T): void {
  expect(value).toBe(true);
}

const KEYS = ["checkout", "liveChat", "wishlist"];

/** Each feature is on for everyone unless listed in off or the context is blocked. */
function datafile(label = "first", off: readonly string[] = []): DatafileContent {
  const traffic = (key: string) => [
    { key: "blocked", conditions: ["blocked"], percentage: 100000, enabled: false },
    { key: "all", conditions: "*", percentage: off.indexOf(key) > -1 ? 0 : 100000 },
  ];
  return {
    schemaVersion: "4",
    revision: label,
    segments: {
      blocked: { conditions: [{ attribute: "blocked", operator: "equals", value: true }] },
    },
    features: KEYS.reduce<Record<string, unknown>>((features, key) => {
      features[key] = {
        hash: `${label}-${key}-${off.indexOf(key) > -1}`,
        bucketBy: "userId",
        traffic: traffic(key),
      };
      return features;
    }, {}) as DatafileContent["features"],
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
          if (evaluation.type === "flag" && evaluation.featureKey) {
            evaluated.push(evaluation.featureKey);
          }
          return evaluation;
        },
      },
    ],
  });
  return { sdk, evaluated };
}

function featurevisorPlugin(sdk: Featurevisor): Plugin {
  return {
    install(app: App) {
      setupApp(app, sdk);
    },
  };
}

/** Runs read inside a component's setup and returns what it read. */
function inSetup<T>(read: () => T, sdk?: Featurevisor): T {
  let result: T | undefined;
  mount(
    defineComponent({
      setup() {
        result = read();
        return () => h("div");
      },
    }),
    { global: sdk ? { plugins: [featurevisorPlugin(sdk)] } : undefined },
  );
  return result as T;
}

describe("vue: useEveryFlag and useSomeFlag with a key listed twice", () => {
  it("evaluates it once", () => {
    const { sdk, evaluated } = instance(["wishlist"]);
    expect(inSetup(() => useEveryFlag(["checkout", "checkout", "liveChat", "checkout"]), sdk)).toBe(
      true,
    );
    expect(evaluated).toEqual(["checkout", "liveChat"]);

    evaluated.length = 0;
    expect(inSetup(() => useSomeFlag(["wishlist", "wishlist", "liveChat"]), sdk)).toBe(true);
    expect(evaluated).toEqual(["wishlist", "liveChat"]);
  });
});

describe("vue: useFlags", () => {
  it("returns one boolean per key, in the order of the keys", () => {
    const { sdk } = instance(["wishlist"]);
    expect(inSetup(() => useFlags(["checkout", "liveChat", "wishlist"]), sdk)).toEqual([
      true,
      true,
      false,
    ]);
    expect(inSetup(() => useFlags(["wishlist", "liveChat", "checkout"]), sdk)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("takes a list of any length", () => {
    const { sdk } = instance(["liveChat"]);
    expect(inSetup(() => useFlags(["checkout"]), sdk)).toEqual([true]);
    expect(
      inSetup(() => useFlags(["checkout", "liveChat", "wishlist", "liveChat", "checkout"]), sdk),
    ).toEqual([true, false, true, false, true]);
  });

  it("passes the context to every evaluation, and an empty context by default", () => {
    const { sdk } = instance();
    const isEnabled = jest.spyOn(sdk, "isEnabled");

    expect(inSetup(() => useFlags(KEYS), sdk)).toEqual([true, true, true]);
    expect(isEnabled).toHaveBeenCalledWith("checkout", {});

    const context = { blocked: true };
    expect(inSetup(() => useFlags(KEYS, context), sdk)).toEqual([false, false, false]);
    expect(isEnabled).toHaveBeenCalledWith("wishlist", context);
  });

  it("returns false for a feature missing from the datafile", () => {
    expect(inSetup(() => useFlags(["checkout", "missing"]), instance().sdk)).toEqual([true, false]);
  });

  it("gives a key listed twice a value at each position, evaluating it once", () => {
    const { sdk, evaluated } = instance(["liveChat"]);
    expect(inSetup(() => useFlags(["checkout", "liveChat", "checkout"]), sdk)).toEqual([
      true,
      false,
      true,
    ]);
    expect(evaluated).toEqual(["checkout", "liveChat"]);
  });

  it("returns an empty array for an empty list", () => {
    const { sdk, evaluated } = instance();
    expect(inSetup(() => useFlags([]), sdk)).toEqual([]);
    expect(evaluated).toEqual([]);
  });

  it("returns a plain array taken when called, like useFlag", async () => {
    const { sdk } = instance();
    let flags: readonly boolean[] = [];
    let flag = false;
    const wrapper = mount(
      defineComponent({
        setup() {
          flags = useFlags(["checkout", "liveChat"]);
          flag = useFlag("checkout");
          return () => h("p", `${flag}:${flags.join(",")}`);
        },
      }),
      { global: { plugins: [featurevisorPlugin(sdk)] } },
    );
    expect(isRef(flags)).toBe(false);
    expect(Array.isArray(flags)).toBe(true);
    expect(wrapper.text()).toBe("true:true,true");

    // Neither function follows later changes. Keep values live with SDK events.
    sdk.setDatafile(datafile("first", ["checkout", "liveChat"]));
    await nextTick();
    expect(wrapper.text()).toBe("true:true,true");
    expect(inSetup(() => useFlags(["checkout", "liveChat"]), sdk)).toEqual([false, false]);
    wrapper.unmount();
  });

  it("types an inline list as an exact tuple and a runtime list as an array", () => {
    const { sdk } = instance();
    inSetup(() => {
      const inline = useFlags(["checkout", "liveChat", "wishlist"]);
      expectExactType<IsExact<typeof inline, readonly [boolean, boolean, boolean]>>(true);
      expect(inline).toEqual([true, true, true]);

      const keys: FeatureKey[] = ["checkout"];
      const runtime = useFlags(keys, { userId: "user-1" });
      expectExactType<IsExact<typeof runtime, readonly boolean[]>>(true);
      expect(runtime).toEqual([true]);

      // @ts-expect-error an inline list of two has no third value
      const [, , third] = useFlags(["checkout", "liveChat"]);
      expect(third).toBeUndefined();
      return null;
    }, sdk);
  });

  it("fails clearly when setupApp was not called", () => {
    expect(() => inSetup(() => useFlags(["checkout"]))).toThrow(
      "Featurevisor SDK is not available. Call setupApp(app, featurevisor) first.",
    );
  });
});

describe("vue: useEveryFlag and useSomeFlag", () => {
  it.each([
    [[], true, true],
    [["liveChat"], false, true],
    [["checkout", "liveChat"], false, true],
    [KEYS, false, false],
  ])("with %j off, return every %s and some %s", (off, every, some) => {
    const { sdk } = instance(off);
    expect(inSetup(() => useEveryFlag(KEYS), sdk)).toBe(every);
    expect(inSetup(() => useSomeFlag(KEYS), sdk)).toBe(some);
  });

  it("pass the context to the evaluations", () => {
    const { sdk } = instance();
    const context = { blocked: true };
    expect(inSetup(() => useEveryFlag(KEYS, context), sdk)).toBe(false);
    expect(inSetup(() => useSomeFlag(KEYS, context), sdk)).toBe(false);
  });

  it("count a feature missing from the datafile as disabled", () => {
    const { sdk } = instance();
    expect(inSetup(() => useEveryFlag(["checkout", "missing"]), sdk)).toBe(false);
    expect(inSetup(() => useSomeFlag(["missing", "checkout"]), sdk)).toBe(true);
  });

  it("useEveryFlag stops evaluating at the first disabled feature", () => {
    const { sdk, evaluated } = instance(["liveChat"]);
    expect(inSetup(() => useEveryFlag(["checkout", "liveChat", "wishlist"]), sdk)).toBe(false);
    expect(evaluated).toEqual(["checkout", "liveChat"]);
  });

  it("useSomeFlag stops evaluating at the first enabled feature", () => {
    const { sdk, evaluated } = instance(["checkout"]);
    expect(inSetup(() => useSomeFlag(["checkout", "liveChat", "wishlist"]), sdk)).toBe(true);
    expect(evaluated).toEqual(["checkout", "liveChat"]);
  });

  it("follow Array semantics for an empty list built at runtime", () => {
    const { sdk } = instance();
    const keys: FeatureKey[] = [];
    expect(inSetup(() => useEveryFlag(keys), sdk)).toBe(true);
    expect(inSetup(() => useSomeFlag(keys), sdk)).toBe(false);
  });

  it("reject a literal empty list at compile time", () => {
    const { sdk } = instance();
    inSetup(() => {
      // @ts-expect-error a literal empty list is rejected
      expect(useEveryFlag([])).toBe(true);
      // @ts-expect-error a literal empty list is rejected
      expect(useSomeFlag([])).toBe(false);
      return null;
    }, sdk);
  });

  it("fail clearly when setupApp was not called", () => {
    const error = "Featurevisor SDK is not available. Call setupApp(app, featurevisor) first.";
    expect(() => inSetup(() => useEveryFlag(["checkout"]))).toThrow(error);
    expect(() => inSetup(() => useSomeFlag(["checkout"]))).toThrow(error);
  });
});
