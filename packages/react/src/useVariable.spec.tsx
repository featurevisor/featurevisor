import * as React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

import { createFeaturevisor } from "@featurevisor/sdk";
import { DatafileContent } from "@featurevisor/types";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useVariable } from "./useVariable";

function getNewDatafile(colorValue = "red"): DatafileContent {
  return {
    schemaVersion: "2",
    revision: "1.0",
    features: {
      test: {
        key: "test",
        bucketBy: "userId",
        traffic: [
          {
            key: "1",
            segments: "*",
            percentage: 100000,
          },
        ],
        variablesSchema: {
          color: { type: "string", defaultValue: colorValue },
          hero: {
            type: "object",
            defaultValue: {
              title: "Hero Title",
              subtitle: "Hero Subtitle",
              alignment: "center",
            },
          },
        },
        hash: Math.random().toString(10).substring(2, 15),
      },
    },
    segments: {},
  };
}

function getNewInstance() {
  const sdk = createFeaturevisor({
    datafile: getNewDatafile(),
  });

  return sdk;
}

describe("react: useVariable", function () {
  test("should be a function", function () {
    expect(useVariable).toBeInstanceOf(Function);
  });

  test("should return the variable", function () {
    function TestComponent() {
      const variable = useVariable("test", "color", { userId: "1" });

      return variable === "red" ? <p>Red</p> : <p>Transparent</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("Red")).toBeInTheDocument();
  });

  test("should return the variable reactively", async function () {
    function TestComponent() {
      const variable = useVariable("test", "color", { userId: "1" });

      return variable === "red" ? <p>Red</p> : <p>Some other colour</p>;
    }

    const f = getNewInstance();

    render(
      <FeaturevisorProvider instance={f}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("Red")).toBeInTheDocument();

    await act(async () => {
      const newDatafile = getNewDatafile("blue");
      f.setDatafile(newDatafile);
    });

    await waitFor(() => {
      expect(screen.getByText("Some other colour")).toBeInTheDocument();
    });
  });

  test("should read different variable keys when the key prop changes", async function () {
    function TestComponent({ name }: { name: "color" | "size" }) {
      const value = useVariable("test", name, { userId: "1" });

      return <p data-testid="var">{String(value)}</p>;
    }

    const sdk = createFeaturevisor({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
            key: "test",
            bucketBy: "userId",
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
              },
            ],
            variablesSchema: {
              color: { type: "string", defaultValue: "red" },
              size: { type: "integer", defaultValue: 42 },
            },
            hash: "multi-var-1",
          },
        },
        segments: {},
      },
    });

    const { rerender } = render(
      <FeaturevisorProvider instance={sdk}>
        <TestComponent name="color" />
      </FeaturevisorProvider>,
    );

    expect(screen.getByTestId("var")).toHaveTextContent("red");

    rerender(
      <FeaturevisorProvider instance={sdk}>
        <TestComponent name="size" />
      </FeaturevisorProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("var")).toHaveTextContent("42");
    });
  });

  test("should expose object variables from the schema", function () {
    function TestComponent() {
      const hero = useVariable("test", "hero", { userId: "1" }) as {
        title: string;
      } | null;

      return <p data-testid="hero">{hero?.title ?? "none"}</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByTestId("hero")).toHaveTextContent("Hero Title");
  });

  test("should update when setSticky provides a variable override", async function () {
    const sdk = createFeaturevisor({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
            key: "test",
            bucketBy: "userId",
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
              },
            ],
            variablesSchema: {
              color: { type: "string", defaultValue: "red" },
            },
            hash: "var-sticky-1",
          },
        },
        segments: {},
      },
    });

    function TestComponent() {
      const color = useVariable("test", "color", { userId: "1" });

      return <p data-testid="c">{String(color)}</p>;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByTestId("c")).toHaveTextContent("red");

    await act(async () => {
      sdk.setSticky({
        test: {
          enabled: true,
          variables: { color: "green" },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("c")).toHaveTextContent("green");
    });
  });

  test("should default context and react to SDK context for merged evaluation", async function () {
    const sdk = createFeaturevisor({
      datafile: {
        schemaVersion: "2",
        revision: "1.0",
        features: {
          test: {
            key: "test",
            bucketBy: "userId",
            variations: [{ value: "control" }, { value: "treatment" }],
            variablesSchema: {
              color: { type: "string", defaultValue: "gray" },
            },
            traffic: [
              {
                key: "2",
                segments: ["beta"],
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 100000] as [number, number] },
                  { variation: "treatment", range: [0, 0] as [number, number] },
                ],
                variables: { color: "yellow" },
              },
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 100000] as [number, number] },
                  { variation: "treatment", range: [0, 0] as [number, number] },
                ],
                variables: { color: "red" },
              },
            ],
            hash: "var-ctx-merge-1",
          },
        },
        segments: {
          beta: {
            key: "beta",
            conditions: JSON.stringify([
              { attribute: "cohort", operator: "equals", value: "beta" },
            ]),
          },
        },
      },
    });

    function TestComponent() {
      const color = useVariable("test", "color", { userId: "1" });

      return <p data-testid="merge">{String(color)}</p>;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByTestId("merge")).toHaveTextContent("red");

    await act(async () => {
      sdk.setContext({ cohort: "beta" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("merge")).toHaveTextContent("yellow");
    });
  });
});
