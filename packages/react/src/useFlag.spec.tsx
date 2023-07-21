import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useFlag } from "./useFlag";
import { createInstance } from "@featurevisor/sdk";

function getNewInstance(enabled = true) {
  const sdk = createInstance({
    datafile: {
      schemaVersion: "1",
      revision: "1.0",
      features: [
        {
          key: "test",
          bucketBy: "userId",
          traffic: [
            {
              key: "1",
              segments: "*",
              percentage: enabled ? 100000 : 0,
              allocation: [],
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

describe("react: useFlag", function () {
  test("should be a function", function () {
    expect(useFlag).toBeInstanceOf(Function);
  });

  test("should check if feature is enabled", function () {
    function TestComponent() {
      const isEnabled = useFlag("test", { userId: "1" });

      return isEnabled ? <p>True</p> : <p>False</p>;
    }

    render(
      <FeaturevisorProvider sdk={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("True")).toBeInTheDocument();
  });

  test("should check if feature is disabled", function () {
    function TestComponent() {
      const isEnabled = useFlag("test", { userId: "1" });

      return isEnabled ? <p>True</p> : <p>False</p>;
    }

    render(
      <FeaturevisorProvider sdk={getNewInstance(false)}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("False")).toBeInTheDocument();
  });
});
