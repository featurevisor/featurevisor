import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useVariable } from "./useVariable";
import { createInstance } from "@featurevisor/sdk";

function getNewInstance() {
  const sdk = createInstance({
    datafile: {
      schemaVersion: "1",
      revision: "1.0",
      features: [
        {
          key: "test",
          defaultVariation: "control",
          bucketBy: "userId",
          variations: [{ value: "control" }, { value: "b" }, { value: "c" }],
          traffic: [
            {
              key: "1",
              segments: "*",
              percentage: 100000,
              allocation: [
                { variation: "control", percentage: 33000 },
                { variation: "b", percentage: 33000 },
                { variation: "c", percentage: 34000 },
              ],
            },
          ],
          variablesSchema: [
            { key: "color", type: "string", defaultValue: "red" },
            {
              key: "hero",
              type: "object",
              defaultValue: {
                title: "Hero Title",
                subtitle: "Hero Subtitle",
                alignment: "center",
              },
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
      <FeaturevisorProvider sdk={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("Red")).toBeInTheDocument();
  });
});
