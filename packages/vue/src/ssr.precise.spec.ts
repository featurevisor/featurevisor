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
  const Component = defineComponent({
    setup() {
      const checkout = useFlag("checkout", { userId: "user-1" });
      const banner = useVariable("banner");
      return () => h("p", `${checkout.value}:${banner.value}`);
    },
  });

  for (let request = 0; request < 3; request++) {
    const app = createSSRApp(Component);
    setupApp(app, f);
    expect(await renderToString(app)).toBe("<p>true:Welkom</p>");
  }

  expect(on).not.toHaveBeenCalled();
});
