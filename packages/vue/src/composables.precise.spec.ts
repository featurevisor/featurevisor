import { defineComponent, h, nextTick, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { createFeaturevisor, type Evaluation, type Featurevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";
import { useSource } from "@featurevisor/signals/vue";

import { provideFeaturevisorScope } from "./FeaturevisorScope";
import { setupApp } from "./setupApp";
import { useEveryFlag } from "./useEveryFlag";
import { useFlag } from "./useFlag";
import { useFlags } from "./useFlags";
import { useSignals } from "./useSignals";
import { useVariable } from "./useVariable";

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
      reviews: {
        hash: "r",
        bucketBy: "userId",
        traffic: [everyone],
        variablesSchema: {
          settings: { type: "object", defaultValue: { currency: "EUR", methods: ["card"] } },
        },
      },
    },
    variables: {
      banner: {
        hash: "b",
        type: "string",
        defaultValue: "Welcome",
        overrides: [{ key: "dutch", conditions: "dutch", value: "Welkom" }],
      },
    },
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

function mountWith(f: Featurevisor, setupFn: () => () => unknown) {
  return mount(defineComponent({ setup: setupFn }), {
    global: { plugins: [{ install: (app) => setupApp(app, f) }] },
  });
}

describe("precise updates in Vue", () => {
  test("a component renders only when its own value changes", async () => {
    const { f, evaluations } = setup();
    let renders = 0;
    const wrapper = mountWith(f, () => {
      const checkout = useFlag("checkout");
      const reviews = useFlag("reviews");
      return () => {
        renders++;
        return h("p", `${checkout.value}:${reviews.value}`);
      };
    });
    expect(wrapper.text()).toBe("true:true");

    f.setContext({ plan: "pro" });
    await nextTick();
    expect(renders).toBe(1);
    expect(evaluations).toEqual({ checkout: 1, reviews: 1 });

    f.setContext({ country: "de" });
    await nextTick();
    expect(wrapper.text()).toBe("false:true");
    expect(renders).toBe(2);
    expect(evaluations).toEqual({ checkout: 2, reviews: 1 });
  });

  test("a ref in the context is followed, compared by value", async () => {
    const { f, evaluations } = setup();
    const country = ref("nl");
    const wrapper = mountWith(f, () => {
      const checkout = useFlag("checkout", () => ({ country: country.value }));
      return () => h("p", String(checkout.value));
    });
    expect(wrapper.text()).toBe("true");

    country.value = "nl";
    await nextTick();
    expect(evaluations.checkout).toBe(1);

    country.value = "de";
    await nextTick();
    expect(wrapper.text()).toBe("false");
    expect(evaluations.checkout).toBe(2);
  });

  test("scopes merge under each composable's context", async () => {
    const { f } = setup();
    const country = ref("de");
    const Child = defineComponent({
      setup() {
        const checkout = useFlag("checkout");
        return () => h("p", String(checkout.value));
      },
    });
    const wrapper = mountWith(f, () => {
      provideFeaturevisorScope(() => ({ country: country.value }));
      return () => h(Child);
    });
    expect(wrapper.text()).toBe("false");

    country.value = "nl";
    await nextTick();
    expect(wrapper.text()).toBe("true");
  });

  test("each composable keeps its own copy", () => {
    const { f } = setup();
    let first: Ref<{ methods: string[] } | null> | undefined;
    let second: Ref<{ methods: string[] } | null> | undefined;
    mountWith(f, () => {
      first = useVariable<{ methods: string[] }>("reviews", "settings");
      second = useVariable<{ methods: string[] }>("reviews", "settings");
      return () => h("p", JSON.stringify([first!.value, second!.value]));
    });

    first!.value!.methods.push("changed in place");
    expect(second!.value).toEqual({ currency: "EUR", methods: ["card"] });
    expect(f.getVariable("reviews", "settings")).toEqual({ currency: "EUR", methods: ["card"] });
  });

  test("useFlags and useEveryFlag follow only what they read", async () => {
    const { f, evaluations } = setup();
    const wrapper = mountWith(f, () => {
      const [checkout, reviews] = useFlags(["checkout", "reviews"]);
      const every = useEveryFlag(["checkout", "reviews"]);
      return () => h("p", `${checkout.value}:${reviews.value}:${every.value}`);
    });
    expect(wrapper.text()).toBe("true:true:true");
    const before = { ...evaluations };

    f.setContext({ plan: "pro" });
    await nextTick();
    expect(evaluations).toEqual(before);

    f.setContext({ country: "de" });
    await nextTick();
    expect(wrapper.text()).toBe("false:true:false");
  });

  test("useSignals gives the instance's reader, shared by every component", async () => {
    const { f } = setup();
    const readers: unknown[] = [];
    let renders = 0;
    const Banner = defineComponent({
      setup() {
        const signals = useSignals();
        readers.push(signals);
        const banner = useSource(signals.variable("banner"));
        return () => {
          renders++;
          return h("span", String(banner.value));
        };
      },
    });
    const wrapper = mountWith(f, () => () => [h(Banner), h(Banner)]);
    expect(readers).toHaveLength(2);
    expect(readers[0]).toBe(readers[1]);
    expect(wrapper.text()).toBe("WelkomWelkom");

    // banner reads country, not plan.
    f.setContext({ plan: "pro" });
    await nextTick();
    expect(renders).toBe(2);

    f.setContext({ country: "de" });
    await nextTick();
    expect(wrapper.text()).toBe("WelcomeWelcome");
    expect(renders).toBe(4);
  });
});
