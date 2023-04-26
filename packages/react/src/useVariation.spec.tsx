import * as React from "react";
import {render, screen, waitFor} from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useVariation } from "./useVariation";
import { createInstance } from "@featurevisor/sdk";

const datafile = {
  schemaVersion: "1",
  revision: "1.0",
  features: [
    {
      key: "test",
      defaultVariation: false,
      bucketBy: "userId",
      variations: [{value: true}, {value: false}],
      traffic: [
        {
          key: "1",
          segments: "*",
          percentage: 100000,
          allocation: [
            {variation: true, percentage: 100000},
            {variation: false, percentage: 0},
          ],
        },
      ],
    },
  ],
  attributes: [],
  segments: [],
}

function getNewInstance() {
  return createInstance({datafile});
}

function getNewAsyncInstance() {
  return createInstance({
    datafileUrl: "http://localhost:3000/datafile.json",
    async handleDatafileFetch() {
      return datafile
    }
  })
}

describe("react: useVariation", function () {
  test("should be a function", function () {
    expect(useVariation).toBeInstanceOf(Function);
  });

  test("should return the variation", function () {
    function TestComponent() {
      const variation = useVariation("test", { userId: "1" });

      return variation === true ? <p>True</p> : <p>False</p>;
    }

    render(
      <FeaturevisorProvider sdk={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("True")).toBeInTheDocument();
  });

  test("should suspend and then return variation", async function () {
    function TestComponent() {
      const variation = useVariation("test", {userId: "1"});

      return variation === true ? <p>True</p> : <p>False</p>;
    }

    render(
      <FeaturevisorProvider sdk={getNewAsyncInstance()} suspend>
        <React.Suspense fallback={<p>Suspended</p>}>
          <TestComponent />
        </React.Suspense>
      </FeaturevisorProvider>,
    );
    expect(screen.getByText("Suspended")).toBeInTheDocument();
    await expect(screen.findByText("True")).resolves.toBeInTheDocument();
  });
});
