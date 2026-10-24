import { createSSRApp, defineComponent, h, nextTick, ref, type App, type Plugin } from "vue";
import { renderToString } from "vue/server-renderer";
import { mount } from "@vue/test-utils";
import type { Featurevisor } from "@featurevisor/sdk";
import type { Context, DatafileContent } from "@featurevisor/types";

import { FeaturevisorScope, provideFeaturevisorScope } from "./FeaturevisorScope";
import { setupApp } from "./setupApp";
import { useEveryFlag } from "./useEveryFlag";
import { useFlag } from "./useFlag";
import { useFlags } from "./useFlags";
import { useRevision } from "./useRevision";
import { useSdk } from "./useSdk";
import { useSomeFlag } from "./useSomeFlag";
import { useVariable } from "./useVariable";
import { useVariation } from "./useVariation";

const { createFeaturevisor } = jest.requireActual(
  "../../sdk/src",
) as typeof import("@featurevisor/sdk");

/**
 * wishlist is on only for the paid plan, pricing gives paid accounts treatment,
 * and supportEmail has a Dutch override.
 */
function datafile(revision = "first", wishlistOn = true): DatafileContent {
  return {
    schemaVersion: "4",
    revision,
    segments: {
      paid: { conditions: [{ attribute: "plan", operator: "equals", value: "paid" }] },
      netherlands: { conditions: [{ attribute: "country", operator: "equals", value: "nl" }] },
    },
    features: {
      wishlist: {
        hash: `wishlist-${wishlistOn}`,
        bucketBy: "userId",
        traffic: [
          { key: "paid", conditions: ["paid"], percentage: wishlistOn ? 100000 : 0 },
          { key: "all", conditions: "*", percentage: 0 },
        ],
      },
      pricing: {
        hash: "pricing",
        bucketBy: "userId",
        variations: [
          { value: "control", weight: 50 },
          { value: "treatment", weight: 50 },
        ],
        traffic: [
          {
            key: "paid",
            conditions: ["paid"],
            percentage: 100000,
            allocation: [{ variation: "treatment", range: [0, 100000] }],
          },
          {
            key: "all",
            conditions: "*",
            percentage: 100000,
            allocation: [{ variation: "control", range: [0, 100000] }],
          },
        ],
      },
      buyButton: {
        hash: "buyButton",
        bucketBy: "userId",
        variablesSchema: { label: { type: "string", defaultValue: "Buy" } },
        traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
      },
    },
    variables: {
      supportEmail: {
        hash: "supportEmail",
        type: "string",
        defaultValue: "help",
        overrides: [{ key: "nl", conditions: "netherlands", value: "help-nl" }],
      },
    },
  } as unknown as DatafileContent;
}

function instance(context: Context = { userId: "user-1", country: "de" }): Featurevisor {
  return createFeaturevisor({ logLevel: "fatal", datafile: datafile(), context });
}

function featurevisorPlugin(sdk: Featurevisor): Plugin {
  return {
    install(app: App) {
      setupApp(app, sdk);
    },
  };
}

/** Every evaluating composable, written into one line of text. */
const Readers = defineComponent({
  props: { context: { type: Object, default: undefined } },
  setup(props) {
    const context = props.context as Context | undefined;
    const flag = useFlag("wishlist", context);
    const [listed] = useFlags(["wishlist"], context);
    const every = useEveryFlag(["wishlist"], context);
    const some = useSomeFlag(["wishlist"], context);
    const variation = useVariation("pricing", context);
    const email = useVariable("supportEmail", context);
    const label = useVariable("buyButton", "label", context);
    return () =>
      h(
        "p",
        { class: "readers" },
        [flag, listed, every, some, variation, email, label].map((r) => String(r.value)).join(","),
      );
  },
});

function mountIn(sdk: Featurevisor, render: () => ReturnType<typeof h>) {
  return mount(defineComponent({ setup: () => render }), {
    global: { plugins: [featurevisorPlugin(sdk)] },
  });
}

describe("vue: FeaturevisorScope", () => {
  it("gives every evaluating composable below it the scope's context", () => {
    const sdk = instance();
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    const getVariable = jest.spyOn(sdk, "getVariable");

    expect(
      mountIn(sdk, () => h(Readers))
        .find(".readers")
        .text(),
    ).toBe("false,false,false,false,control,help,Buy");

    const scoped = mountIn(sdk, () =>
      h(FeaturevisorScope, { context: { plan: "paid", country: "nl" } }, () => h(Readers)),
    );
    expect(scoped.find(".readers").text()).toBe("true,true,true,true,treatment,help-nl,Buy");
    expect(isEnabled).toHaveBeenLastCalledWith("wishlist", { plan: "paid", country: "nl" });
    expect(getVariable).toHaveBeenCalledWith("buyButton", "label", {
      plan: "paid",
      country: "nl",
    });
  });

  it("merges the instance, outer scope, inner scope and composable argument in that order", () => {
    const sdk = instance({ userId: "user-1", country: "de", plan: "free", locale: "de" });
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    const Reader = defineComponent({
      setup() {
        const flag = useFlag("wishlist", { locale: "nl-NL" });
        return () => h("p", String(flag.value));
      },
    });
    const Outer = defineComponent({
      setup() {
        provideFeaturevisorScope({ country: "nl", plan: "enterprise", locale: "en" });
        return () => h(FeaturevisorScope, { context: { plan: "paid" } }, () => h(Reader));
      },
    });

    expect(mountIn(sdk, () => h(Outer)).text()).toBe("true");
    expect(isEnabled).toHaveBeenLastCalledWith("wishlist", {
      country: "nl",
      plan: "paid",
      locale: "nl-NL",
    });
  });

  it("passes the composable's own context object through unchanged outside any scope", () => {
    const sdk = instance();
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    const context = { plan: "paid" };
    const Reader = defineComponent({
      setup() {
        const flag = useFlag("wishlist", context);
        return () => h("p", String(flag.value));
      },
    });

    mountIn(sdk, () => h(Reader));
    expect(isEnabled.mock.calls[isEnabled.mock.calls.length - 1][1]).toBe(context);
  });

  it("follows a context prop as it changes", async () => {
    const sdk = instance();
    const plan = ref("free");
    const wrapper = mountIn(sdk, () =>
      h(FeaturevisorScope, { context: { plan: plan.value } }, () => h(Readers)),
    );
    expect(wrapper.find(".readers").text()).toBe("false,false,false,false,control,help,Buy");

    plan.value = "paid";
    await nextTick();
    expect(wrapper.find(".readers").text()).toBe("true,true,true,true,treatment,help,Buy");
  });

  it("applies provideFeaturevisorScope to descendants, not to the component calling it", () => {
    const sdk = instance();
    const Parent = defineComponent({
      setup() {
        provideFeaturevisorScope({ plan: "paid" });
        const own = useFlag("wishlist");
        return () => h("div", [h("span", { class: "own" }, String(own.value)), h(Readers)]);
      },
    });

    const wrapper = mountIn(sdk, () => h(Parent));
    expect(wrapper.find(".own").text()).toBe("false");
    expect(wrapper.find(".readers").text()).toBe("true,true,true,true,treatment,help,Buy");
  });

  it("follows a getter given to provideFeaturevisorScope", async () => {
    const sdk = instance();
    const country = ref("de");
    const Parent = defineComponent({
      setup() {
        provideFeaturevisorScope(() => ({ plan: "paid", country: country.value }));
        return () => h(Readers);
      },
    });

    const wrapper = mountIn(sdk, () => h(Parent));
    expect(wrapper.find(".readers").text()).toBe("true,true,true,true,treatment,help,Buy");

    country.value = "nl";
    await nextTick();
    expect(wrapper.find(".readers").text()).toBe("true,true,true,true,treatment,help-nl,Buy");
  });

  it("still follows the instance, the datafile and sticky values inside a scope", async () => {
    const sdk = instance();
    const wrapper = mountIn(sdk, () =>
      h(FeaturevisorScope, { context: { plan: "paid" } }, () => h(Readers)),
    );
    const text = () => wrapper.find(".readers").text();

    sdk.setContext({ country: "nl" });
    await nextTick();
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");

    sdk.setContext({ plan: "free" });
    await nextTick();
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");

    sdk.setDatafile(datafile("second", false));
    await nextTick();
    expect(text()).toBe("false,false,false,false,treatment,help-nl,Buy");

    sdk.setStickyFeatures({ wishlist: { enabled: true } });
    await nextTick();
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");
  });

  it("leaves useSdk and useRevision as they are", () => {
    const sdk = instance();
    const seen: unknown[] = [];
    const Reader = defineComponent({
      setup() {
        seen.push(useSdk(), useRevision().value);
        return () => null;
      },
    });

    mountIn(sdk, () => h(FeaturevisorScope, { context: { plan: "paid" } }, () => h(Reader)));
    expect(seen).toEqual([sdk, "first"]);
  });

  it("renders a scope on the server", async () => {
    const sdk = instance();
    const app = createSSRApp({
      render: () => h(FeaturevisorScope, { context: { plan: "paid" } }, () => h(Readers)),
    });
    setupApp(app, sdk);

    // The slot renders as a fragment, which Vue marks with comments.
    expect(await renderToString(app)).toContain(
      '<p class="readers">true,true,true,true,treatment,help,Buy</p>',
    );
  });
});

/** The context the last flag read below used, as the SDK received it. */
function lastContext(isEnabled: jest.SpyInstance) {
  return isEnabled.mock.calls[isEnabled.mock.calls.length - 1][1];
}

const Probe = defineComponent({
  props: { context: { type: Object, default: undefined } },
  setup(props) {
    const flag = useFlag("wishlist", props.context as Context | undefined);
    return () => h("span", String(flag.value));
  },
});

describe("vue: nested FeaturevisorScope", () => {
  it("merges three levels, each over the one around it, under the composable's own argument", () => {
    const sdk = instance({ userId: "user-1", country: "de", plan: "free", region: "eu" });
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    const Middle = defineComponent({
      setup() {
        provideFeaturevisorScope({ plan: "paid", locale: "en" });
        return () =>
          h(FeaturevisorScope, { context: { locale: "nl-NL", team: "inner" } }, () =>
            h(Probe, { context: { team: "argument" } }),
          );
      },
    });

    mountIn(sdk, () =>
      h(FeaturevisorScope, { context: { country: "nl", plan: "enterprise", team: "outer" } }, () =>
        h(Middle),
      ),
    );
    expect(lastContext(isEnabled)).toEqual({
      country: "nl",
      plan: "paid",
      locale: "nl-NL",
      team: "argument",
    });
  });

  it("keeps sibling scopes apart while both inherit the outer one", () => {
    const sdk = instance();
    const wrapper = mountIn(sdk, () =>
      h(FeaturevisorScope, { context: { country: "nl" } }, () => [
        h("div", { class: "paid" }, [
          h(FeaturevisorScope, { context: { plan: "paid" } }, () => h(Readers)),
        ]),
        h("div", { class: "free" }, [
          h(FeaturevisorScope, { context: { plan: "free" } }, () => h(Readers)),
        ]),
      ]),
    );

    expect(wrapper.find(".paid").text()).toBe("true,true,true,true,treatment,help-nl,Buy");
    expect(wrapper.find(".free").text()).toBe("false,false,false,false,control,help-nl,Buy");
  });

  it("keeps the keys an inner scope sets when the outer one changes them, and follows the rest", async () => {
    const sdk = instance();
    const outer = ref<Context>({ plan: "free", country: "de" });
    const wrapper = mountIn(sdk, () =>
      h(FeaturevisorScope, { context: outer.value }, () =>
        h(FeaturevisorScope, { context: { plan: "paid" } }, () => h(Readers)),
      ),
    );
    const text = () => wrapper.find(".readers").text();
    expect(text()).toBe("true,true,true,true,treatment,help,Buy");

    outer.value = { plan: "enterprise", country: "de" };
    await nextTick();
    expect(text()).toBe("true,true,true,true,treatment,help,Buy");

    outer.value = { plan: "enterprise", country: "nl" };
    await nextTick();
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");
  });

  it("leaves the outer scope's own readers alone when an inner scope changes", async () => {
    const sdk = instance();
    const innerPlan = ref("free");
    let outerRenders = 0;
    const OuterReader = defineComponent({
      setup() {
        const flag = useFlag("wishlist");
        return () => {
          outerRenders += 1;
          return h("span", { class: "outer" }, String(flag.value));
        };
      },
    });
    const wrapper = mountIn(sdk, () =>
      h(FeaturevisorScope, { context: { plan: "free" } }, () => [
        h(OuterReader),
        h(FeaturevisorScope, { context: { plan: innerPlan.value } }, () => h(Readers)),
      ]),
    );
    const settled = outerRenders;

    innerPlan.value = "paid";
    await nextTick();
    expect(wrapper.find(".readers").text()).toBe("true,true,true,true,treatment,help,Buy");
    expect(wrapper.find(".outer").text()).toBe("false");
    expect(outerRenders).toBe(settled);
  });

  it("merges shallowly, so an inner object replaces the outer one", () => {
    const sdk = instance();
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    mountIn(sdk, () =>
      h(FeaturevisorScope, { context: { account: { locale: "de", seats: 10 } } }, () =>
        h(FeaturevisorScope, { context: { account: { seats: 60 } } }, () => h(Probe)),
      ),
    );
    expect(lastContext(isEnabled)).toEqual({ account: { seats: 60 } });
  });

  it("passes the outer scope through an empty inner one", () => {
    const sdk = instance();
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    mountIn(sdk, () =>
      h(FeaturevisorScope, { context: { plan: "paid", country: "nl" } }, () =>
        h(FeaturevisorScope, { context: {} }, () => h(Probe)),
      ),
    );
    expect(lastContext(isEnabled)).toEqual({ plan: "paid", country: "nl" });
  });

  it("switches values as an inner scope mounts and unmounts", async () => {
    const sdk = instance();
    const withInner = ref(false);
    const wrapper = mountIn(sdk, () =>
      h(FeaturevisorScope, { context: { country: "nl" } }, () =>
        withInner.value
          ? h(FeaturevisorScope, { context: { plan: "paid" } }, () => h(Readers))
          : h(Readers),
      ),
    );
    const text = () => wrapper.find(".readers").text();
    expect(text()).toBe("false,false,false,false,control,help-nl,Buy");

    withInner.value = true;
    await nextTick();
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");

    withInner.value = false;
    await nextTick();
    expect(text()).toBe("false,false,false,false,control,help-nl,Buy");
  });
});
