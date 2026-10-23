import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createFeaturevisor } from "@featurevisor/sdk";
import { setupApp } from "./setupApp";
import { useFlag } from "./useFlag";
import { useVariable } from "./useVariable";

test.each([false, true])(
  "reports dependency changes through segments to Vue consumers, replacement: %s",
  async (replace) => {
    const source = (enabled: boolean) => ({
      hash: String(enabled),
      bucketBy: "userId",
      traffic: [{ key: "all", conditions: "*", percentage: enabled ? 100000 : 0 }],
    });
    const datafile = {
      schemaVersion: "4",
      revision: "one",
      segments: { eligible: { conditions: { feature: "source" } } },
      features: {
        source: source(false),
        checkout: {
          hash: "same",
          bucketBy: "userId",
          traffic: [{ key: "all", conditions: "eligible", percentage: 100000 }],
        },
      },
      variables: {
        label: {
          hash: "same",
          type: "string" as const,
          defaultValue: "Allowed",
          disabledValue: "Blocked",
          conditions: "eligible",
        },
      },
    };
    const f = createFeaturevisor({ datafile, logLevel: "fatal" });
    const wrapper = mount(
      defineComponent({
        setup() {
          const checkout = useFlag("checkout");
          const label = useVariable("label");
          return () => h("p", `${checkout.value}:${label.value}`);
        },
      }),
      {
        global: {
          plugins: [
            {
              install(app) {
                setupApp(app, f);
              },
            },
          ],
        },
      },
    );
    expect(wrapper.text()).toBe("false:Blocked");
    f.setDatafile(
      replace
        ? { ...datafile, features: { ...datafile.features, source: source(true) } }
        : { schemaVersion: "4", revision: "two", segments: {}, features: { source: source(true) } },
      replace,
    );
    await nextTick();
    expect(wrapper.text()).toBe("true:Allowed");
    wrapper.unmount();
  },
);
