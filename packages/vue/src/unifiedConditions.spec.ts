import { defineComponent, h, nextTick, onUnmounted, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createFeaturevisor } from "@featurevisor/sdk";
import { setupApp } from "./setupApp";
import { useFlag } from "./useFlag";
import { useVariable } from "./useVariable";
import { useSdk } from "./useSdk";

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
          const sdk = useSdk();
          const text = ref(`${useFlag("checkout")}:${useVariable("label")}`);
          onUnmounted(
            sdk.on("datafile_set", ({ features, variables }) => {
              if (features.indexOf("checkout") !== -1 || variables.indexOf("label") !== -1)
                text.value = `${sdk.isEnabled("checkout")}:${sdk.getVariable("label")}`;
            }),
          );
          return () => h("p", text.value);
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
