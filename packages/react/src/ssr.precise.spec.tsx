/**
 * @jest-environment node
 */
import * as React from "react";
import { renderToString } from "react-dom/server";
import { createFeaturevisor, type Evaluation } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

import { FeaturevisorProvider, useFlag, useFlags, useVariable } from "./index";

const datafile: DatafileContent = {
  schemaVersion: "4",
  revision: "1",
  segments: {},
  features: {
    checkout: {
      hash: "c",
      bucketBy: "userId",
      traffic: [{ key: "everyone", conditions: "*", percentage: 100000 }],
      variablesSchema: {
        settings: { type: "object", defaultValue: { currency: "EUR", methods: ["card"] } },
      },
    },
  },
};

test("server rendering evaluates each hook once, listens to nothing and hands out copies", () => {
  const evaluations: string[] = [];
  const f = createFeaturevisor({
    datafile,
    logLevel: "fatal",
    context: { userId: "user-1" },
    modules: [
      {
        name: "counting",
        afterEvaluation: (evaluation: Evaluation) => {
          evaluations.push(evaluation.featureKey || "?");
          return evaluation;
        },
      },
    ],
  });
  const on = jest.spyOn(f, "on");
  const returned: unknown[] = [];

  function Checkout() {
    const enabled = useFlag("checkout");
    const [again] = useFlags(["checkout"]);
    const settings = useVariable<{ methods: string[] }>("checkout", "settings");
    returned.push(settings);
    settings?.methods.push("changed");

    return (
      <p>
        {String(enabled)} {String(again)} {settings?.methods.length}
      </p>
    );
  }

  for (let request = 0; request < 2; request++) {
    expect(
      renderToString(
        <FeaturevisorProvider instance={f}>
          <Checkout />
        </FeaturevisorProvider>,
      ),
    ).toBe("<p>true<!-- --> <!-- -->true<!-- --> <!-- -->2</p>");
  }

  expect(evaluations).toHaveLength(6);
  expect(on).not.toHaveBeenCalled();
  // A component changing what it was given reaches neither the SDK nor the next request.
  expect(returned[0]).not.toBe(returned[1]);
  expect(f.getVariable("checkout", "settings")).toEqual({ currency: "EUR", methods: ["card"] });
});
