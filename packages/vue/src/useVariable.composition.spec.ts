import { defineComponent, h, nextTick, onUnmounted, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createFeaturevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

import { setupApp } from "./setupApp";
import { useSdk } from "./useSdk";
import { useVariable } from "./useVariable";

function compositionDatafile(label = "red", delivery = "standard"): DatafileContent {
  return {
    schemaVersion: "2",
    revision: `${label}-${delivery}`,
    segments: {},
    features: {
      checkout: {
        hash: label,
        bucketBy: "userId",
        traffic: [{ key: "all", segments: "*", percentage: 100000 }],
        variablesSchema: { label: { type: "string", defaultValue: label } },
      },
    },
    variables: {
      delivery: { hash: delivery, type: "string", defaultValue: delivery },
      config: {
        hash: "unchanged-composition",
        type: "object",
        compose: [
          { key: "enabled", feature: "checkout" },
          { key: "layout", feature: "checkout", variation: true as const },
          { key: "label", feature: "checkout", variable: "label" },
          { key: "delivery", variable: "delivery" },
        ],
      },
      nestedConfig: {
        hash: "unchanged-nested-composition",
        type: "object",
        compose: [{ key: "view", variable: "config" }],
      },
    },
  };
}

type OverrideDependency = "segment" | "feature" | "global";

function overrideDatafile(
  dependency: OverrideDependency,
  replacement: boolean,
  matches: boolean,
): DatafileContent {
  const content = compositionDatafile();
  content.segments.overrideAudience = {
    conditions: {
      attribute: "userId",
      operator: "equals",
      value: dependency === "segment" && !matches ? "other" : "123",
    },
  };
  content.features.overrideGate = {
    hash: `gate-${dependency === "feature" ? matches : true}`,
    bucketBy: "userId",
    traffic:
      dependency === "feature" && !matches
        ? []
        : [{ key: "all", segments: "*", percentage: 100000 }],
  };
  content.variables!.overridePolicy = {
    hash: `policy-${dependency === "global" ? matches : true}`,
    type: "boolean",
    defaultValue: dependency === "global" ? matches : true,
  };
  content.variables!.config.overrideProgram = [
    {
      key: "eligible",
      keyPath: ["eligible"],
      segments: JSON.stringify(["overrideAudience"]),
      requiredFeatures: ["overrideGate"],
      conditions: [{ variable: "overridePolicy", operator: "equals", value: true }],
      operations: replacement
        ? [
            {
              op: "set",
              path: [],
              value: {
                enabled: false,
                layout: "replacement",
                label: "replaced",
                delivery: "express",
              },
            },
          ]
        : [{ op: "set", path: ["label"], value: "mutated" }],
      onMatch: 1,
      onMiss: 1,
    },
  ];
  return content;
}

describe("vue: useVariable composition", () => {
  describe.each([false, true])("override program replacement=%s", (replacement) => {
    test.each<OverrideDependency>(["segment", "feature", "global"])(
      "reacts to an override only %s prerequisite without a composition hash change",
      async (dependency) => {
        const sdk = createFeaturevisor({
          logLevel: "fatal",
          datafile: overrideDatafile(dependency, replacement, false),
        });
        let renders = 0;
        const view = mount(
          defineComponent({
            setup() {
              const activeSdk = useSdk();
              const revision = ref(0);
              // Match the synchronous getter consumer subscription used above.
              const unsubscribe = activeSdk.on("datafile_set", ({ variables }) => {
                if (variables.indexOf("nestedConfig") !== -1) revision.value++;
              });
              onUnmounted(unsubscribe);
              return () => {
                revision.value;
                if (++renders > 40) throw new Error("Composition override hook did not settle");
                return h("p", JSON.stringify(useVariable("nestedConfig", { userId: "123" })));
              };
            },
          }),
          { global: { plugins: [{ install: (app) => setupApp(app, sdk) }] } },
        );
        const base = { enabled: true, layout: null, label: "red", delivery: "standard" };
        const expectValue = (value: unknown) =>
          expect(JSON.parse(view.text())).toEqual({ view: value });
        expectValue(base);
        const events: string[][] = [];
        const unsubscribe = sdk.on("datafile_set", ({ variables }) => events.push(variables));
        for (const matches of [true, false]) {
          const before = renders;
          const updated = overrideDatafile(dependency, replacement, matches);
          // Partial updates omit both compositions and every compose source.
          sdk.setDatafile({
            schemaVersion: "2",
            revision: `override-${matches}`,
            segments: dependency === "segment" ? updated.segments : {},
            features:
              dependency === "feature" ? { overrideGate: updated.features.overrideGate } : {},
            variables:
              dependency === "global" ? { overridePolicy: updated.variables!.overridePolicy } : {},
          });
          await nextTick();
          expect(renders).toBeGreaterThan(before);
          expect(events[events.length - 1]).toEqual(
            expect.arrayContaining(["config", "nestedConfig"]),
          );
          const expected = matches
            ? replacement
              ? { enabled: false, layout: "replacement", label: "replaced", delivery: "express" }
              : { ...base, label: "mutated" }
            : base;
          expectValue(expected);
          const settled = renders;
          sdk.setDatafile({
            schemaVersion: "2",
            revision: `unrelated-${matches}`,
            segments: {
              unrelated: {
                conditions: { attribute: "userId", operator: "equals", value: String(matches) },
              },
            },
            features: { unrelated: { hash: String(matches), bucketBy: "userId", traffic: [] } },
            variables: {
              unrelated: { hash: String(matches), type: "boolean", defaultValue: matches },
            },
          });
          await nextTick();
          expect(renders).toBe(settled);
          expect(events[events.length - 1]).not.toEqual(expect.arrayContaining(["config"]));
          expect(events[events.length - 1]).not.toEqual(expect.arrayContaining(["nestedConfig"]));
          expectValue(expected);
        }
        view.unmount();
        unsubscribe();
        sdk.close();
      },
    );
  });

  test("uses the SDK source", () => {
    expect(createFeaturevisor).toBe(jest.requireActual("../../sdk/src").createFeaturevisor);
  });

  test.each(["feature", "global", "sticky"])("reacts to a source %s update", async (update) => {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: compositionDatafile() });
    let renders = 0;
    const view = mount(
      defineComponent({
        setup() {
          const activeSdk = useSdk();
          const revision = ref(0);
          // Vue getters are synchronous. The consumer subscribes to SDK events.
          const cleanups = [
            activeSdk.on("datafile_set", ({ variables }) => {
              if (variables.indexOf("nestedConfig") !== -1) revision.value++;
            }),
            activeSdk.on("sticky_features_set", ({ features }) => {
              if (features.length) revision.value++;
            }),
          ];
          onUnmounted(() => cleanups.forEach((cleanup) => cleanup()));
          return () => {
            revision.value;
            renders++;
            return h("p", JSON.stringify(useVariable("nestedConfig", { userId: "123" })));
          };
        },
      }),
      { global: { plugins: [{ install: (app) => setupApp(app, sdk) }] } },
    );
    const expectConfig = (label: string, delivery: string, layout: string | null = null) => {
      expect(JSON.parse(view.text())).toEqual({ view: { enabled: true, layout, label, delivery } });
    };
    expectConfig("red", "standard");
    const events: string[][] = [];
    const unsubscribe = sdk.on("datafile_set", ({ variables }) => events.push(variables));
    if (update === "sticky") {
      sdk.setStickyFeatures({
        checkout: { enabled: true, variation: "sticky-layout", variables: { label: "sticky" } },
      });
      await nextTick();
      expectConfig("sticky", "standard", "sticky-layout");
      sdk.setStickyFeatures({}, true);
      await nextTick();
      expectConfig("red", "standard");
    } else {
      const updated = compositionDatafile("blue", "express");
      sdk.setDatafile({
        schemaVersion: "2",
        revision: "partial",
        segments: {},
        features: update === "feature" ? updated.features : {},
        variables: update === "global" ? { delivery: updated.variables!.delivery } : {},
      });
      await nextTick();
      expectConfig(
        update === "feature" ? "blue" : "red",
        update === "global" ? "express" : "standard",
      );
      expect(events[0]).toEqual(expect.arrayContaining(["config", "nestedConfig"]));
    }
    const settledRenders = renders;
    sdk.setDatafile({
      schemaVersion: "2",
      revision: "unrelated",
      segments: {},
      features: {},
      variables: { unrelated: { type: "boolean", defaultValue: true, hash: "new" } },
    });
    await nextTick();
    expect(renders).toBe(settledRenders);
    view.unmount();
    sdk.setStickyFeatures({ checkout: { enabled: false } });
    await nextTick();
    expect(renders).toBe(settledRenders);
    unsubscribe();
  });
});
