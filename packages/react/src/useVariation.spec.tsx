import * as React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useVariation } from "./useVariation";
import { createInstance } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

function getNewDatafile(variationValue = "control") {
  return {
    schemaVersion: "2",
    revision: "1.0",
    features: {
      test: {
        key: "test",
        bucketBy: "userId",
        variations: [
          { value: "control", weight: variationValue === "control" ? 100 : 0 },
          { value: "treatment", weight: variationValue === "treatment" ? 100 : 0 },
        ],
        traffic: [
          {
            key: "1",
            segments: "*",
            percentage: 100000,
            allocation: [
              {
                variation: "control",
                range: [0, variationValue === "control" ? 100000 : 0] as [number, number],
              },
              {
                variation: "treatment",
                range: [variationValue === "control" ? 100000 : 0, 100000] as [number, number],
              },
            ],
          },
        ],
        hash: Math.random().toString(10).substring(2, 15),
      },
    },
    segments: {},
  };
}

function getNewInstance() {
  const sdk = createInstance({
    datafile: getNewDatafile(),
  });

  return sdk;
}

describe("react: useVariation", function () {
  test("should be a function", function () {
    expect(useVariation).toBeInstanceOf(Function);
  });

  test("should return the variation", function () {
    function TestComponent() {
      const variation = useVariation("test", { userId: "1" });

      return variation === "control" ? <p>True</p> : <p>False</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("True")).toBeInTheDocument();
  });

  test("should return the variation reactively", async function () {
    function TestComponent() {
      const variation = useVariation("test", { userId: "1" });

      return variation === "control" ? <p>True</p> : <p>False</p>;
    }

    const f = getNewInstance();

    render(
      <FeaturevisorProvider instance={f}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("True")).toBeInTheDocument();

    await act(async () => {
      const newDatafile: DatafileContent = getNewDatafile("treatment");
      f.setDatafile(newDatafile);
    });

    await waitFor(() => {
      expect(screen.getByText("False")).toBeInTheDocument();
      expect(screen.queryByText("True")).not.toBeInTheDocument();
    });
  });

  test("should default context to an empty object", function () {
    function TestComponent() {
      const variation = useVariation("test");

      return <p data-testid="v">{variation ?? "null"}</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByTestId("v")).toHaveTextContent("control");
  });

  test("should update when hook context changes", async function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
            key: "test",
            bucketBy: "userId",
            variations: [
              { value: "control", weight: 50 },
              { value: "treatment", weight: 50 },
            ],
            traffic: [
              {
                key: "2",
                segments: ["vip"],
                percentage: 100000,
                allocation: [
                  { variation: "treatment", range: [0, 100000] as [number, number] },
                  { variation: "control", range: [0, 0] as [number, number] },
                ],
              },
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 100000] as [number, number] },
                  { variation: "treatment", range: [0, 0] as [number, number] },
                ],
              },
            ],
            hash: "var-ctx-1",
          },
        },
        segments: {
          vip: {
            key: "vip",
            conditions: JSON.stringify([
              { attribute: "tier", operator: "equals", value: "gold" },
            ]),
          },
        },
      },
    });

    function TestComponent({ tier }: { tier: string }) {
      const variation = useVariation("test", { userId: "same-bucket", tier });

      return <p data-testid="var">{variation}</p>;
    }

    const { rerender } = render(
      <FeaturevisorProvider instance={sdk}>
        <TestComponent tier="standard" />
      </FeaturevisorProvider>,
    );

    expect(screen.getByTestId("var")).toHaveTextContent("control");

    rerender(
      <FeaturevisorProvider instance={sdk}>
        <TestComponent tier="gold" />
      </FeaturevisorProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("var")).toHaveTextContent("treatment");
    });
  });

  test("should update when setSticky pins a variation", async function () {
    const datafileContent: DatafileContent = {
      schemaVersion: "2",
      revision: "1.0",
      features: {
        test: {
          key: "test",
          bucketBy: "userId",
          variations: [
            { value: "control", weight: 50 },
            { value: "treatment", weight: 50 },
          ],
          traffic: [
            {
              key: "1",
              segments: "*",
              percentage: 100000,
              allocation: [
                { variation: "control", range: [0, 0] as [number, number] },
                { variation: "treatment", range: [0, 100000] as [number, number] },
              ],
            },
          ],
          hash: "var-sticky-1",
        },
      },
      segments: {},
    };

    const sdk = createInstance({ datafile: datafileContent });

    function TestComponent() {
      const variation = useVariation("test", { userId: "123" });

      return <p data-testid="sticky-var">{variation}</p>;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByTestId("sticky-var")).toHaveTextContent("treatment");

    await act(async () => {
      sdk.setSticky({
        test: {
          enabled: true,
          variation: "control",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("sticky-var")).toHaveTextContent("control");
    });
  });

  test("should round-trip control → treatment → control via datafile", async function () {
    function TestComponent() {
      const variation = useVariation("test", { userId: "1" });

      return <p data-testid="rt">{variation}</p>;
    }

    const f = getNewInstance();

    render(
      <FeaturevisorProvider instance={f}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByTestId("rt")).toHaveTextContent("control");

    await act(async () => {
      f.setDatafile(getNewDatafile("treatment"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("rt")).toHaveTextContent("treatment");
    });

    await act(async () => {
      f.setDatafile(getNewDatafile("control"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("rt")).toHaveTextContent("control");
    });
  });
});
