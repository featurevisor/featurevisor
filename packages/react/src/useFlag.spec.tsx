import * as React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useFlag } from "./useFlag";
import { createFeaturevisor } from "@featurevisor/sdk";

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
  const sdk = createFeaturevisor({
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

  test("should work with only a feature key (default context)", function () {
    function TestComponent() {
      const isEnabled = useFlag("test");

      return isEnabled ? <p>On</p> : <p>Off</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("On")).toBeInTheDocument();
  });

  test("should update when hook context argument changes between renders", async function () {
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
                key: "2",
                segments: ["netherlands"],
                percentage: 100000,
                enabled: false,
                allocation: [],
              },
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [],
              },
            ],
            hash: "ctx-1",
          },
        },
        segments: {
          netherlands: {
            key: "netherlands",
            conditions: JSON.stringify([{ attribute: "country", operator: "equals", value: "nl" }]),
          },
        },
      },
    });

    function TestComponent({ country }: { country: string }) {
      const isEnabled = useFlag("test", { userId: "user-123", country });

      return isEnabled ? <p>Allowed</p> : <p>Blocked</p>;
    }

    const { rerender } = render(
      <FeaturevisorProvider instance={sdk}>
        <TestComponent country="de" />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("Allowed")).toBeInTheDocument();

    rerender(
      <FeaturevisorProvider instance={sdk}>
        <TestComponent country="nl" />
      </FeaturevisorProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Blocked")).toBeInTheDocument();
    });
  });

  test("should update when SDK setContext changes merged evaluation", async function () {
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
                key: "2",
                segments: ["netherlands"],
                percentage: 100000,
                enabled: false,
                allocation: [],
              },
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [],
              },
            ],
            hash: "sdk-ctx-1",
          },
        },
        segments: {
          netherlands: {
            key: "netherlands",
            conditions: JSON.stringify([{ attribute: "country", operator: "equals", value: "nl" }]),
          },
        },
      },
    });

    function TestComponent() {
      const isEnabled = useFlag("test", { userId: "user-123" });

      return isEnabled ? <p>Open</p> : <p>Closed</p>;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("Open")).toBeInTheDocument();

    await act(async () => {
      sdk.setContext({ country: "nl" });
    });

    await waitFor(() => {
      expect(screen.getByText("Closed")).toBeInTheDocument();
    });
  });

  test("should update when setSticky overrides a disabled feature", async function () {
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
                percentage: 0,
                allocation: [],
              },
            ],
            hash: "sticky-1",
          },
        },
        segments: {},
      },
    });

    function TestComponent() {
      const isEnabled = useFlag("test", { userId: "1" });

      return isEnabled ? <p>StickyOn</p> : <p>StickyOff</p>;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("StickyOff")).toBeInTheDocument();

    await act(async () => {
      sdk.setSticky({ test: { enabled: true } });
    });

    await waitFor(() => {
      expect(screen.getByText("StickyOn")).toBeInTheDocument();
    });
  });

  test("should follow datafile toggles true → false → true", async function () {
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

    await act(async () => {
      f.setDatafile(getNewDatafile(false));
    });
    await waitFor(() => {
      expect(screen.getByText("False")).toBeInTheDocument();
    });

    await act(async () => {
      f.setDatafile(getNewDatafile(true));
    });
    await waitFor(() => {
      expect(screen.getByText("True")).toBeInTheDocument();
    });
  });
});
