import {
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  ref,
  type App,
  type Plugin,
  type Ref,
} from "vue";
import { renderToString } from "vue/server-renderer";
import { mount } from "@vue/test-utils";
import type { Featurevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

import { setupApp } from "./setupApp";
import { useEveryFlag } from "./useEveryFlag";
import { useFlag } from "./useFlag";
import { useFlags } from "./useFlags";
import { useSomeFlag } from "./useSomeFlag";
import { useVariable } from "./useVariable";
import { useVariation } from "./useVariation";

const { createFeaturevisor } = jest.requireActual(
  "../../sdk/src",
) as typeof import("@featurevisor/sdk");

/**
 * checkout and liveChat need the gate variable and are off for a blocked
 * context. checkout has a variation and a label variable. supportEmail is a
 * global variable that needs checkout, with a Dutch override.
 */
function datafile(label = "first", off: readonly string[] = [], email = "help"): DatafileContent {
  const feature = (key: string) => ({
    hash: `${label}-${key}-${off.indexOf(key) > -1}`,
    bucketBy: "userId",
    conditions: [{ variable: "gate", operator: "equals", value: true }],
    traffic: [
      { key: "blocked", conditions: ["blocked"], percentage: 100000, enabled: false },
      {
        key: "all",
        conditions: "*",
        percentage: off.indexOf(key) > -1 ? 0 : 100000,
        ...(key === "checkout"
          ? { allocation: [{ variation: `${label}-variation`, range: [0, 100000] }] }
          : {}),
      },
    ],
  });
  return {
    schemaVersion: "4",
    revision: `${label}-${off.join("+")}-${email}`,
    segments: {
      blocked: { conditions: [{ attribute: "blocked", operator: "equals", value: true }] },
      netherlands: { conditions: [{ attribute: "country", operator: "equals", value: "nl" }] },
    },
    features: {
      checkout: {
        ...feature("checkout"),
        variations: [{ value: `${label}-variation`, weight: 100 }],
        variablesSchema: { label: { type: "string", defaultValue: `${label} label` } },
      },
      liveChat: feature("liveChat"),
      other: { hash: `${label}-other`, bucketBy: "userId", traffic: [] },
    },
    variables: {
      gate: { hash: "gate", type: "boolean", defaultValue: true },
      supportEmail: {
        hash: email,
        type: "string",
        defaultValue: email,
        disabledValue: "none",
        conditions: { feature: "checkout" },
        overrides: [{ key: "nl", conditions: "netherlands", value: `${email}-nl` }],
      },
      unrelated: { hash: label, type: "string", defaultValue: label },
    },
  } as unknown as DatafileContent;
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
          evaluated.push(`${evaluation.type}:${evaluation.featureKey || evaluation.variableKey}`);
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

function featurevisorPlugin(sdk: Featurevisor): Plugin {
  return {
    install(app: App) {
      setupApp(app, sdk);
    },
  };
}

/** Mounts a component rendering one composable's value, counting renders. */
function mountValue(sdk: Featurevisor, read: () => Readonly<Ref<unknown>>) {
  let renders = 0;
  const wrapper = mount(
    defineComponent({
      setup() {
        const value = read();
        return () => {
          renders += 1;
          return h("p", JSON.stringify(value.value));
        };
      },
    }),
    { global: { plugins: [featurevisorPlugin(sdk)] } },
  );
  return {
    wrapper,
    value: () => JSON.parse(wrapper.text()),
    renders: () => renders,
  };
}

const COMPOSABLES: Record<string, () => Readonly<Ref<unknown>>> = {
  useFlag: () => useFlag("checkout"),
  useFlags: () => useFlags(["checkout", "liveChat"])[0],
  useEveryFlag: () => useEveryFlag(["checkout", "liveChat"]),
  useSomeFlag: () => useSomeFlag(["checkout", "liveChat"]),
  useVariation: () => useVariation("checkout"),
  "useVariable for a feature": () => useVariable("checkout", "label"),
  "useVariable for a global variable": () => useVariable("supportEmail"),
};

describe("vue: values follow the instance", () => {
  describe.each(Object.keys(COMPOSABLES))("%s", (name) => {
    const read = COMPOSABLES[name];

    it("updates for a datafile that changes its feature or variable, and not for others", async () => {
      const { sdk, evaluated } = instance();
      const view = mountValue(sdk, read);
      const initial = view.value();

      // Switching both features off changes every one of these values.
      sdk.setDatafile(datafile("second", ["checkout", "liveChat"]));
      await nextTick();
      const changed = view.value();
      expect(changed).not.toEqual(initial);

      const settled = view.renders();
      const evaluations = evaluated.length;
      sdk.setDatafile({
        schemaVersion: "4",
        revision: "unrelated",
        segments: {},
        features: { other: { hash: "changed", bucketBy: "userId", traffic: [] } },
        variables: { unrelated: { hash: "changed", type: "string", defaultValue: "changed" } },
      } as unknown as DatafileContent);
      await nextTick();
      // Neither a render nor an evaluation, which a tracking module would see.
      expect(view.renders()).toBe(settled);
      expect(evaluated).toHaveLength(evaluations);
      expect(view.value()).toEqual(changed);
      view.wrapper.unmount();
    });

    it("updates for context, sticky feature and sticky variable changes", async () => {
      const { sdk } = instance();
      const view = mountValue(sdk, read);
      const initial = view.value();

      sdk.setContext({ blocked: true });
      await nextTick();
      const blocked = view.value();
      expect(blocked).not.toEqual(initial);
      sdk.setContext({ blocked: false });
      await nextTick();
      expect(view.value()).toEqual(initial);

      sdk.setStickyVariables({ gate: false, supportEmail: "sticky" });
      await nextTick();
      expect(view.value()).not.toEqual(initial);
      sdk.setStickyVariables({}, true);
      await nextTick();
      expect(view.value()).toEqual(initial);

      sdk.setStickyFeatures({
        checkout: { enabled: false },
        liveChat: { enabled: false },
      });
      await nextTick();
      expect(view.value()).not.toEqual(initial);
      sdk.setStickyFeatures({}, true);
      await nextTick();
      expect(view.value()).toEqual(initial);
      view.wrapper.unmount();
    });
  });

  it("reads the new datafile's values, not only that something changed", async () => {
    const { sdk } = instance();
    const label = mountValue(sdk, () => useVariable("checkout", "label"));
    const variation = mountValue(sdk, () => useVariation("checkout"));
    const email = mountValue(sdk, () => useVariable("supportEmail"));
    expect([label.value(), variation.value(), email.value()]).toEqual([
      "first label",
      "first-variation",
      "help",
    ]);

    sdk.setDatafile(datafile("second", [], "support"));
    await nextTick();
    expect([label.value(), variation.value(), email.value()]).toEqual([
      "second label",
      "second-variation",
      "support",
    ]);

    // supportEmail needs checkout, so switching checkout off updates it too.
    sdk.setDatafile(datafile("second", ["checkout"], "support"));
    await nextTick();
    expect(email.value()).toBe("none");
  });
});

describe("vue: reactive context", () => {
  it("follows a ref, including a change inside it", async () => {
    const { sdk } = instance();
    const context = ref({ country: "de", blocked: false });
    const flag = mountValue(sdk, () => useFlag("checkout", context));
    const email = mountValue(sdk, () => useVariable("supportEmail", context));
    expect([flag.value(), email.value()]).toEqual([true, "help"]);

    context.value.country = "nl";
    await nextTick();
    expect(email.value()).toBe("help-nl");

    context.value = { country: "de", blocked: true };
    await nextTick();
    expect([flag.value(), email.value()]).toEqual([false, "none"]);
  });

  it("follows a getter that reads props", async () => {
    const { sdk } = instance();
    const Child = defineComponent({
      props: { blocked: { type: Boolean, required: true } },
      setup(props) {
        const context = () => ({ blocked: props.blocked });
        const [checkout] = useFlags(["checkout"], context);
        const every = useEveryFlag(["checkout", "liveChat"], context);
        return () => h("p", `${checkout.value}:${every.value}`);
      },
    });
    const blocked = ref(false);
    const wrapper = mount(
      defineComponent({ setup: () => () => h(Child, { blocked: blocked.value }) }),
      { global: { plugins: [featurevisorPlugin(sdk)] } },
    );
    expect(wrapper.text()).toBe("true:true");

    blocked.value = true;
    await nextTick();
    expect(wrapper.text()).toBe("false:false");
  });

  it("keeps a plain object as given, merged over the instance context", async () => {
    const { sdk } = instance();
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    const context = { blocked: true };
    const flag = mountValue(sdk, () => useFlag("checkout", context));
    expect(flag.value()).toBe(false);
    expect(isEnabled).toHaveBeenCalledWith("checkout", context);
  });
});

describe("vue: subscriptions", () => {
  it("attach when mounted, with one set of counting listeners per instance, and leave on unmount", () => {
    const { sdk } = instance();
    const events = observe(sdk);
    const first = mountValue(sdk, () => useFlag("checkout"));
    const second = mountValue(sdk, () => useVariable("supportEmail"));

    // Four for each composable, and four for the change count.
    expect(events.on).toHaveBeenCalledTimes(2 * 4 + 4);
    expect(events.active()).toHaveLength(2 * 4 + 4);

    first.wrapper.unmount();
    expect(events.active()).toHaveLength(4 + 4);
    second.wrapper.unmount();
    expect(events.active()).toHaveLength(0);
  });

  it("do not attach during server rendering", async () => {
    const { sdk } = instance();
    const events = observe(sdk);
    const Component = defineComponent({
      setup() {
        const checkout = useFlag("checkout");
        const email = useVariable("supportEmail");
        return () => h("p", `${checkout.value}:${email.value}`);
      },
    });

    for (let request = 0; request < 3; request++) {
      const app = createSSRApp(Component);
      setupApp(app, sdk);
      expect(await renderToString(app)).toBe("<p>true:help</p>");
    }

    // Only the change count's one set, however many requests render.
    expect(events.on).toHaveBeenCalledTimes(4);
  });

  it("catch a change made between setup and mounting", async () => {
    const { sdk } = instance();
    // A child mounts before its parent, so its change lands before the parent subscribes.
    const Child = defineComponent({
      mounted() {
        sdk.setContext({ blocked: true });
      },
      render: () => null,
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          const checkout = useFlag("checkout");
          return () => h("div", [h("p", String(checkout.value)), h(Child)]);
        },
      }),
      { global: { plugins: [featurevisorPlugin(sdk)] } },
    );
    await nextTick();
    expect(wrapper.find("p").text()).toBe("false");
  });

  it("catch a change made while the last subscribed composable leaves and a new one arrives", async () => {
    // One update swaps the only subscribed composable for another, beside a
    // component whose mounted hook sets the context. The new one must show the
    // change, however Vue orders the unmount and mount hooks.
    const { sdk } = instance();
    const Old = defineComponent({
      setup() {
        const checkout = useFlag("checkout");
        return () => h("p", String(checkout.value));
      },
    });
    const SetBlocked = defineComponent({
      mounted() {
        sdk.setContext({ blocked: true });
      },
      render: () => null,
    });
    const New = defineComponent({
      setup() {
        const checkout = useFlag("checkout");
        return () => h("p", { class: "new" }, String(checkout.value));
      },
    });
    const swapped = ref(false);
    const wrapper = mount(
      defineComponent({
        setup: () => () => h("div", swapped.value ? [h(SetBlocked), h(New)] : [h(Old)]),
      }),
      { global: { plugins: [featurevisorPlugin(sdk)] } },
    );

    swapped.value = true;
    await nextTick();
    await nextTick();
    expect(wrapper.find(".new").text()).toBe("false");
  });

  it("evaluate again only when something they read changes, not on every render", async () => {
    const { sdk, evaluated } = instance();
    const unrelated = ref(0);
    const wrapper = mount(
      defineComponent({
        setup() {
          const checkout = useFlag("checkout");
          return () => h("p", `${checkout.value}:${unrelated.value}`);
        },
      }),
      { global: { plugins: [featurevisorPlugin(sdk)] } },
    );
    const onMount = evaluated.length;
    expect(onMount).toBeGreaterThan(0);

    unrelated.value++;
    await nextTick();
    unrelated.value++;
    await nextTick();
    expect(wrapper.text()).toBe("true:2");
    expect(evaluated).toHaveLength(onMount);
  });
});
