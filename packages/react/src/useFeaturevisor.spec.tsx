import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { BOUND_METHODS, useFeaturevisor } from "./useFeaturevisor";
import { createInstance } from "@featurevisor/sdk";

function getNewInstance() {
  const sdk = createInstance({
    datafile: {
      schemaVersion: "2",
      revision: "1.0",
      features: {
        test: {
          key: "test",
          bucketBy: "userId",
          variations: [{ value: "control" }, { value: "treatment" }],
          traffic: [
            {
              key: "1",
              segments: "*",
              percentage: 100000,
              allocation: [
                { variation: "control", range: [0, 100000] },
                { variation: "treatment", range: [0, 0] },
              ],
            },
          ],
        },
      },
      segments: {},
    },
  });

  return sdk;
}

describe("react: useFeaturevisor", function () {
  test("should be a function", function () {
    expect(useFeaturevisor).toBeInstanceOf(Function);
  });

  test("should expose only the expected bound methods", function () {
    let keys: string[] = [];

    function TestComponent() {
      const api = useFeaturevisor();
      keys = Object.keys(api);

      return <p>Test</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(keys.sort()).toEqual([...BOUND_METHODS].sort());
  });

  test("should expose a function for each bound method name", function () {
    let api: ReturnType<typeof useFeaturevisor> | undefined;

    function TestComponent() {
      api = useFeaturevisor();

      return <p>Test</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(api).toBeDefined();
    for (const key of BOUND_METHODS) {
      expect(typeof api![key]).toBe("function");
    }
  });

  test("should allow calling destructured isEnabled without throwing", function () {
    let enabled: boolean | undefined;

    function TestComponent() {
      const { isEnabled } = useFeaturevisor();
      enabled = isEnabled("test");

      return <p>Test</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(typeof enabled).toBe("boolean");
  });

  test("should allow calling destructured getVariation without throwing", function () {
    let variation: string | null | undefined;

    function TestComponent() {
      const { getVariation } = useFeaturevisor();
      variation = getVariation("test", { userId: "u1" });

      return <p>Test</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(variation).toBe("control");
  });

  test("should keep stable method references when the sdk instance is unchanged", function () {
    const instance = getNewInstance();
    const isEnabledRefs: Array<ReturnType<typeof useFeaturevisor>["isEnabled"]> = [];

    function TestComponent() {
      const { isEnabled } = useFeaturevisor();
      isEnabledRefs.push(isEnabled);

      return <p>Test</p>;
    }

    const { rerender } = render(
      <FeaturevisorProvider instance={instance}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    rerender(
      <FeaturevisorProvider instance={instance}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(isEnabledRefs).toHaveLength(2);
    expect(isEnabledRefs[0]).toBe(isEnabledRefs[1]);
    expect(screen.getByText("Test")).toBeInTheDocument();
  });
});
