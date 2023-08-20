import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useStatus } from "./useStatus";
import { createInstance } from "@featurevisor/sdk";

function getNewInstance() {
  const sdk = createInstance({
    datafile: {
      schemaVersion: "1",
      revision: "1.0",
      features: [
        {
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
      ],
      attributes: [],
      segments: [],
    },
  });

  return sdk;
}

describe("react: useStatus", function () {
  test("should be a function", function () {
    expect(useStatus).toBeInstanceOf(Function);
  });

  test("should return the variation", function () {
    function TestComponent() {
      const { isReady } = useStatus();

      return isReady ? <p>Ready</p> : <p>Loading...</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
});
