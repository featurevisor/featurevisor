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

  test("should return the variation reactively", function () {
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

    // set new datafile
    act(() => {
      const newDatafile: DatafileContent = getNewDatafile("treatment"); // control => treatment
      f.setDatafile(newDatafile);
    });

    waitFor(() => {
      expect(screen.getByText("False")).toBeInTheDocument();
      expect(screen.queryByText("True")).not.toBeInTheDocument();
    });
  });
});
