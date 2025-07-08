import * as React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

import { createInstance } from "@featurevisor/sdk";
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
  const sdk = createInstance({
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

  test("should return the variable reactively", function () {
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

    // set new datafile
    act(() => {
      const newDatafile = getNewDatafile("blue"); // red => blue
      f.setDatafile(newDatafile);
    });

    waitFor(() => {
      expect(screen.getByText("Some other colour")).toBeInTheDocument();
    });
  });
});
