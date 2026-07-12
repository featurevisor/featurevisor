import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useSdk } from "./useSdk";
import { createFeaturevisor } from "@featurevisor/sdk";

function getNewInstance() {
  const sdk = createFeaturevisor({
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

describe("react: useSdk", function () {
  test("should be a function", function () {
    expect(useSdk).toBeInstanceOf(Function);
  });

  test("should return the sdk", function () {
    const instance = getNewInstance();
    let sdk;

    function TestComponent() {
      sdk = useSdk();

      return <p>Test</p>;
    }

    render(
      <FeaturevisorProvider instance={instance}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("Test")).toBeInTheDocument();

    expect(sdk).toBeDefined();
    expect(sdk).toBe(instance);
  });

  test("should return the same reference as the provider instance on each render", function () {
    const instance = getNewInstance();
    const refs: unknown[] = [];

    function TestComponent() {
      refs.push(useSdk());
      return <p>ok</p>;
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

    expect(refs[0]).toBe(instance);
    expect(refs[1]).toBe(instance);
  });

  test("should be undefined when used outside FeaturevisorProvider", function () {
    let sdk: ReturnType<typeof useSdk> | undefined;

    function Orphan() {
      sdk = useSdk();
      return <p>orphan</p>;
    }

    render(<Orphan />);

    expect(sdk).toBeUndefined();
  });
});
