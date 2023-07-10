import { createApp } from "vue";
import { createInstance } from "@featurevisor/sdk";
import { mount } from "@vue/test-utils";

import { setupApp, PROVIDER_NAME } from "./setupApp";
import { useSdk } from "./useSdk";

describe("vue: index", function () {
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

    const TestComponent = {
      inject: [PROVIDER_NAME],
      data: function () {
        const revision = this[PROVIDER_NAME].getRevision();

        return {
          revision,
        };
      },
      template: `<div>
        <p data-test="p">TestComponent here</p>
        <p data-test="revision">{{ revision }}</p>
      </div>`,
    };

    const App = {
      components: { TestComponent },
      template: `<div><TestComponent /></div>`,
      provide: {
        [PROVIDER_NAME]: sdk,
      },
    };

    const app = createApp(App);
    setupApp(app, sdk);

    const wrapper = mount(App);
    expect(wrapper.exists()).toEqual(true);

    const pText = await wrapper.get(`[data-test="p"]`).text();
    expect(pText).toEqual("TestComponent here");

    const revisionText = await wrapper.get(`[data-test="revision"]`).text();
    expect(revisionText).toEqual("1.0");
  });

  // @TODO: add more tests that utilizes Composition API
});
