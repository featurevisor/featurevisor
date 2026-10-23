import { defineComponent, h, isRef, nextTick, type App, type Plugin } from "vue";
import { mount } from "@vue/test-utils";
import type { Featurevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

import { setupApp } from "./setupApp";
import { useRevision } from "./useRevision";

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

function datafile(revision: string): DatafileContent {
  return {
    schemaVersion: "4",
    revision,
    segments: {},
    features: {
      checkout: {
        hash: revision,
        bucketBy: "userId",
        traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
      },
    },
  };
}

function featurevisorPlugin(sdk: Featurevisor): Plugin {
  return {
    install(app: App) {
      setupApp(app, sdk);
    },
  };
}

function mountRevision(sdk: Featurevisor) {
  let revision = "";
  const wrapper = mount(
    defineComponent({
      setup() {
        revision = useRevision();
        return () => h("small", revision);
      },
    }),
    { global: { plugins: [featurevisorPlugin(sdk)] } },
  );
  return { wrapper, revision };
}

describe("vue: useRevision", () => {
  it("returns the revision of the instance's datafile", () => {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: datafile("first") });
    const { wrapper, revision } = mountRevision(sdk);

    expect(revision).toBe("first");
    expect(wrapper.text()).toBe("first");
  });

  it("returns unknown before a datafile is set", () => {
    const { revision } = mountRevision(createFeaturevisor({ logLevel: "fatal" }));
    expect(revision).toBe("unknown");
  });

  it("returns a plain string taken when called, like the other composables", async () => {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: datafile("first") });
    const { wrapper, revision } = mountRevision(sdk);
    expect(isRef(revision)).toBe(false);
    expectExactType<IsExact<typeof revision, string>>(true);

    // It does not follow later datafiles. A component created afterwards reads the new one.
    sdk.setDatafile(datafile("second"));
    await nextTick();
    expect(wrapper.text()).toBe("first");
    expect(mountRevision(sdk).revision).toBe("second");
  });
});
