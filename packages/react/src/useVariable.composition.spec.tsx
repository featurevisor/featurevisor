import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { createFeaturevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
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

describe("react: useVariable composition", () => {
  describe.each([false, true])("override program replacement=%s", (replacement) => {
    test.each<OverrideDependency>(["segment", "feature", "global"])(
      "reacts to an override only %s prerequisite without a composition hash change",
      (dependency) => {
        const sdk = createFeaturevisor({
          logLevel: "fatal",
          datafile: overrideDatafile(dependency, replacement, false),
        });
        let renders = 0;
        function Reader() {
          if (++renders > 40) throw new Error("Composition override hook did not settle");
          return (
            <span data-testid="override">
              {JSON.stringify(useVariable("nestedConfig", { userId: "123" }))}
            </span>
          );
        }
        const view = render(
          <React.StrictMode>
            <FeaturevisorProvider instance={sdk}>
              <Reader />
            </FeaturevisorProvider>
          </React.StrictMode>,
        );
        const base = { enabled: true, layout: null, label: "red", delivery: "standard" };
        const expectValue = (value: unknown) =>
          expect(JSON.parse(screen.getByTestId("override").textContent!)).toEqual({ view: value });
        expectValue(base);
        const events: string[][] = [];
        const unsubscribe = sdk.on("datafile_set", ({ variables }) => events.push(variables));
        for (const matches of [true, false]) {
          const before = renders;
          const updated = overrideDatafile(dependency, replacement, matches);
          // Partial updates omit both compositions and every compose source.
          act(() =>
            sdk.setDatafile({
              schemaVersion: "2",
              revision: `override-${matches}`,
              segments: dependency === "segment" ? updated.segments : {},
              features:
                dependency === "feature" ? { overrideGate: updated.features.overrideGate } : {},
              variables:
                dependency === "global"
                  ? { overridePolicy: updated.variables!.overridePolicy }
                  : {},
            }),
          );
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
          act(() =>
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
            }),
          );
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

  test.each(["feature", "global", "sticky"])("reacts to a source %s update", (update) => {
    const sdk = createFeaturevisor({ logLevel: "fatal", datafile: compositionDatafile() });
    let renders = 0;
    function Reader() {
      if (++renders > 40) throw new Error("Composition hook did not settle");
      const value = useVariable("nestedConfig", { userId: "123" });
      return <span data-testid="composition">{JSON.stringify(value)}</span>;
    }
    const view = render(
      <React.StrictMode>
        <FeaturevisorProvider instance={sdk}>
          <Reader />
        </FeaturevisorProvider>
      </React.StrictMode>,
    );
    const expectConfig = (label: string, delivery: string, layout: string | null = null) => {
      expect(JSON.parse(screen.getByTestId("composition").textContent!)).toEqual({
        view: { enabled: true, layout, label, delivery },
      });
    };
    expectConfig("red", "standard");
    const events: string[][] = [];
    const unsubscribe = sdk.on("datafile_set", ({ variables }) => events.push(variables));
    if (update === "sticky") {
      act(() =>
        sdk.setStickyFeatures({
          checkout: { enabled: true, variation: "sticky-layout", variables: { label: "sticky" } },
        }),
      );
      expectConfig("sticky", "standard", "sticky-layout");
      act(() => sdk.setStickyFeatures({}, true));
      expectConfig("red", "standard");
    } else {
      const updated = compositionDatafile("blue", "express");
      act(() =>
        sdk.setDatafile({
          schemaVersion: "2",
          revision: "partial",
          segments: {},
          features: update === "feature" ? updated.features : {},
          variables: update === "global" ? { delivery: updated.variables!.delivery } : {},
        }),
      );
      expectConfig(
        update === "feature" ? "blue" : "red",
        update === "global" ? "express" : "standard",
      );
      expect(events[0]).toEqual(expect.arrayContaining(["config", "nestedConfig"]));
    }
    const settledRenders = renders;
    act(() =>
      sdk.setDatafile({
        schemaVersion: "2",
        revision: "unrelated",
        segments: {},
        features: {},
        variables: { unrelated: { type: "boolean", defaultValue: true, hash: "new" } },
      }),
    );
    expect(renders).toBe(settledRenders);
    view.unmount();
    act(() => sdk.setStickyFeatures({ checkout: { enabled: false } }));
    expect(renders).toBe(settledRenders);
    unsubscribe();
  });
});
