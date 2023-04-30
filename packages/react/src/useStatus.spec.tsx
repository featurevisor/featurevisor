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
          defaultVariation: false,
          bucketBy: "userId",
          variations: [{ value: true }, { value: false }],
          traffic: [
            {
              key: "1",
              segments: "*",
              percentage: 100000,
              allocation: [
                { variation: true, range: { start: 0, end: 100000 } },
                { variation: false, range: { start: 0, end: 0 } },
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
      <FeaturevisorProvider sdk={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
});
