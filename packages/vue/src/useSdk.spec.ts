import { createApp } from "vue";
import { createInstance } from "@featurevisor/sdk";
import { mount } from "@vue/test-utils";

import { setupApp } from "./setupApp";
import { useSdk } from "./useSdk";

describe("vue: setupApp & useSdk", function () {
  it("can set up sdk in app and then inject the sdk instance", async function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "1",
        revision: "1.0",
        features: [
          {
            key: "test",
            defaultVariation: false,
            bucketBy: "userId",
            variations: [{ value: true }, { value: false }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: true, range: [0, 100000] },
                  { variation: false, range: [0, 0] },
                ],
              },
            ],
          },
        ],
        attributes: [],
        segments: [],
      },
    });

    const app = createApp({
      template: `<div><TestComponent /><p data-test="p">hi</p></div>`,
    });
    setupApp(app, sdk);

    app.component("TestComponent", {
      template: `<div><p data-test="p">TestComponent here</p></div>`,
    });

    const wrapper = mount(app);
    expect(wrapper.exists()).toEqual(true);

    console.log({ wrapper });

    const pText = await wrapper.get(`[data-test="p"]`);
    console.log({ pText });

    // const injectedSdk = useSdk();
    // console.log({ injectedSdk });
    // expect(injectedSdk.getRevision()).toEqual("1.0");
  });
});
