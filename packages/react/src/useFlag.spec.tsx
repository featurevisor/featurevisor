import * as React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useFlag } from "./useFlag";
import { createInstance } from "@featurevisor/sdk";

function getNewDatafile(enabled = true) {
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
            percentage: enabled ? 100000 : 0,
            allocation: [],
          },
        ],
        hash: Math.random().toString(10).substring(2, 15),
      },
    },
    segments: {},
  };
}

function getNewInstance(enabled = true) {
  const sdk = createInstance({
    datafile: getNewDatafile(enabled),
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
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("True")).toBeInTheDocument();
    expect(screen.queryByText("False")).not.toBeInTheDocument();
  });

  test("should check if feature is disabled", function () {
    function TestComponent() {
      const isEnabled = useFlag("test", { userId: "1" });

      return isEnabled ? <p>True</p> : <p>False</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance(false)}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("False")).toBeInTheDocument();
    expect(screen.queryByText("True")).not.toBeInTheDocument();
  });

  test("should check if feature evaluation is reactive", async function () {
    function TestComponent() {
      const isEnabled = useFlag("test", { userId: "1" });

      return isEnabled ? <p>True</p> : <p>False</p>;
    }

    const f = getNewInstance(true);

    render(
      <FeaturevisorProvider instance={f}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("True")).toBeInTheDocument();
    expect(screen.queryByText("False")).not.toBeInTheDocument();

    // set new datafile
    await act(async () => {
      const newDatafile = getNewDatafile(false); // true => false
      f.setDatafile(newDatafile);
    });

    await waitFor(() => {
      expect(screen.getByText("False")).toBeInTheDocument();
      expect(screen.queryByText("True")).not.toBeInTheDocument();
    });
  });
});
