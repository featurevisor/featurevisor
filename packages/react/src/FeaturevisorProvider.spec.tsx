import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { createFeaturevisor } from "@featurevisor/sdk";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useFlag } from "./useFlag";
import { useSdk } from "./useSdk";

function makeInstance() {
  return createFeaturevisor({
    datafile: {
      schemaVersion: "2",
      revision: "1.0",
      segments: {},
      features: {
        banner: {
          key: "banner",
          bucketBy: "userId",
          traffic: [
            {
              key: "1",
              segments: "*",
              percentage: 100000,
              allocation: [],
            },
          ],
          hash: "p1",
        },
      },
    },
  });
}

describe("react: FeaturevisorProvider", function () {
  test("should render children", function () {
    const f = makeInstance();

    render(
      <FeaturevisorProvider instance={f}>
        <span>child</span>
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("child")).toBeInTheDocument();
  });

  test("should supply the same instance to useSdk in descendants", function () {
    const f = makeInstance();
    let seen: ReturnType<typeof useSdk> | undefined;

    function Leaf() {
      seen = useSdk();
      return <span>leaf</span>;
    }

    render(
      <FeaturevisorProvider instance={f}>
        <div>
          <Leaf />
        </div>
      </FeaturevisorProvider>,
    );

    expect(seen).toBe(f);
  });

  test("should allow hooks to evaluate features from the provided instance", function () {
    const f = makeInstance();

    function Banner() {
      const on = useFlag("banner", { userId: "u1" });
      return <p>{on ? "visible" : "hidden"}</p>;
    }

    render(
      <FeaturevisorProvider instance={f}>
        <Banner />
      </FeaturevisorProvider>,
    );

    expect(screen.getByText("visible")).toBeInTheDocument();
  });
});
