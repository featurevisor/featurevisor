/**
 * @jest-environment node
 */
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createFeaturevisor } from "@featurevisor/sdk";

import { setupApp } from "./setupApp";
import { useFlag } from "./useFlag";
import { useVariable } from "./useVariable";

test("server rendering attaches nothing to a shared instance", async () => {
  const f = createFeaturevisor({
    logLevel: "fatal",
    context: { country: "nl" },
    datafile: {
      schemaVersion: "4",
      revision: "1",
      segments: {
        dutch: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
      },
      features: {
        checkout: {
          hash: "c",
          bucketBy: "userId",
          traffic: [{ key: "dutch", conditions: "dutch", percentage: 100000 }],
          variablesSchema: {
            settings: { type: "object", defaultValue: { methods: ["card"] } },
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
    },
  });
  const on = jest.spyOn(f, "on");
  // The engine adds its module when first made, so no call means no value on it.
  const addModule = jest.spyOn(f, "addModule");
  const Component = defineComponent({
    setup() {
      const checkout = useFlag("checkout", { userId: "user-1" });
      const banner = useVariable("banner");
      const settings = useVariable<{ methods: string[] }>("checkout", "settings", {
        userId: "user-1",
      });
      return () => {
        // A component changing what it was given reaches neither the SDK nor the next request.
        settings.value?.methods.push("changed");
        return h("p", `${checkout.value}:${banner.value}:${settings.value?.methods.length}`);
      };
    },
  });

  for (let request = 0; request < 3; request++) {
    const app = createSSRApp(Component);
    setupApp(app, f);
    expect(await renderToString(app)).toBe("<p>true:Welkom:2</p>");
  }

  expect(on).not.toHaveBeenCalled();
  expect(addModule).not.toHaveBeenCalled();
  expect(f.getVariable("checkout", "settings", { userId: "user-1" })).toEqual({
    methods: ["card"],
  });
});
