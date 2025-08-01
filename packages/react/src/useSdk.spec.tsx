import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useSdk } from "./useSdk";
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

describe("react: useSdk", function () {
  test("should be a function", function () {
    expect(useSdk).toBeInstanceOf(Function);
  });

  test("should return the sdk", function () {
    let sdk;

    function TestComponent() {
      sdk = useSdk();

      return <p>Test</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("Test")).toBeInTheDocument();

    expect(sdk).toBeDefined();
  });
});
