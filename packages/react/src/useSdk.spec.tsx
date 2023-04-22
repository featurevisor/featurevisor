import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useSdk } from "./useSdk";
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
                { variation: true, percentage: 100000 },
                { variation: false, percentage: 0 },
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

describe("react: useSdk", function () {
  test("should be a function", function () {
    expect(useSdk).toBeInstanceOf(Function);
  });

  test("should return the sdk", function () {
    function TestComponent() {
      const sdk = useSdk();

      expect(typeof sdk.isReady).toEqual("function");

      return <p>Test</p>;
    }

    render(
      <FeaturevisorProvider sdk={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("Test")).toBeInTheDocument();
  });
});
