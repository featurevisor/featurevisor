import { defineComponent, h, isRef, nextTick, type App, type Plugin, type Ref } from "vue";
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
  let revision: Readonly<Ref<string>> | undefined;
  let renders = 0;
  const wrapper = mount(
    defineComponent({
      setup() {
        const current = useRevision();
        revision = current;
        return () => {
          renders += 1;
          return h("small", current.value);
        };
      },
    }),
    { global: { plugins: [featurevisorPlugin(sdk)] } },
  );
  return { wrapper, revision: revision as Readonly<Ref<string>>, renders: () => renders };
}

describe("vue: useRevision", () => {
  it("returns a readonly ref of the instance's datafile revision", () => {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: datafile("first") });
    const { wrapper, revision } = mountRevision(sdk);

    expect(isRef(revision)).toBe(true);
    expectExactType<IsExact<typeof revision, Readonly<Ref<string>>>>(true);
    expect(revision.value).toBe("first");
    expect(wrapper.text()).toBe("first");
  });

  it("holds unknown before a datafile is set, then follows the first one", async () => {
    const sdk = createFeaturevisor({ logLevel: "fatal" });
    const { wrapper } = mountRevision(sdk);
    expect(wrapper.text()).toBe("unknown");

    sdk.setDatafile(datafile("first"));
    await nextTick();
    expect(wrapper.text()).toBe("first");
  });

  it("updates for a new revision only, not for context, sticky or same revision changes", async () => {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: datafile("first") });
    const { wrapper, renders } = mountRevision(sdk);
    const before = renders();

    sdk.setDatafile(datafile("first"));
    sdk.setContext({ userId: "user-2" });
    sdk.setStickyFeatures({ checkout: { enabled: false } });
    await nextTick();
    expect(renders()).toBe(before);

    sdk.setDatafile(datafile("second"));
    await nextTick();
    expect(wrapper.text()).toBe("second");
    expect(renders()).toBe(before + 1);
  });
});
