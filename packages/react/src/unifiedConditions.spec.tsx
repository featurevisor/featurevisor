import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { createFeaturevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";
import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { useFlag } from "./useFlag";
import { useVariable } from "./useVariable";

test("updates mounted hooks after consecutive segment only patches change cached edges", () => {
  const f = createFeaturevisor({
    logLevel: "fatal",
    context: { country: "nl", userId: "test-user" },
    datafile: {
      schemaVersion: "4",
      revision: "initial",
      segments: {
        source: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
        eligible: { conditions: { attribute: "country", operator: "equals", value: "de" } },
      },
      features: {
        checkout: {
          hash: "same",
          bucketBy: "userId",
          conditions: "eligible",
          traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
        },
      },
      variables: {
        label: {
          hash: "same",
          type: "string",
          defaultValue: "Allowed",
          disabledValue: "Blocked",
          conditions: "eligible",
        },
      },
    },
  });
  let renders = 0;
  function Reader() {
    renders++;
    return <p>{`${useFlag("checkout")}:${useVariable("label")}`}</p>;
  }
  render(
    <FeaturevisorProvider instance={f}>
      <Reader />
    </FeaturevisorProvider>,
  );
  expect(screen.getByText("false:Blocked")).toBeInTheDocument();
  const patch = (segments: DatafileContent["segments"]) => {
    act(() => {
      f.setDatafile({ schemaVersion: "4", revision: "patch", segments, features: {} });
    });
  };
  act(() => {
    f.setDatafile({
      schemaVersion: "4",
      revision: "cache-index",
      segments: {},
      features: { unrelated: { hash: "new", bucketBy: "userId", traffic: [] } },
    });
  });
  patch({ eligible: { conditions: "source" } });
  expect(screen.getByText("true:Allowed")).toBeInTheDocument();
  patch({ source: { conditions: { attribute: "country", operator: "equals", value: "us" } } });
  expect(screen.getByText("false:Blocked")).toBeInTheDocument();
  patch({ eligible: { conditions: "*" } });
  expect(screen.getByText("true:Allowed")).toBeInTheDocument();
  const beforeUnrelatedChange = renders;
  patch({ source: { conditions: { attribute: "country", operator: "equals", value: "nl" } } });
  expect(renders).toBe(beforeUnrelatedChange);
  void f.close();
});

test.each([false, true])(
  "updates hooks through a segment when its feature changes, replacement: %s",
  (replace) => {
    const source = (enabled: boolean) => ({
      hash: String(enabled),
      bucketBy: "userId",
      traffic: [{ key: "all", conditions: "*", percentage: enabled ? 100000 : 0 }],
    });
    const datafile = {
      schemaVersion: "4",
      revision: "one",
      segments: { eligible: { conditions: { feature: "source" } } },
      features: {
        source: source(false),
        checkout: {
          hash: "same",
          bucketBy: "userId",
          traffic: [{ key: "all", conditions: "eligible", percentage: 100000 }],
        },
      },
      variables: {
        label: {
          hash: "same",
          type: "string" as const,
          defaultValue: "Allowed",
          disabledValue: "Blocked",
          conditions: "eligible",
        },
      },
    };
    const f = createFeaturevisor({ datafile, logLevel: "fatal" });
    function Reader() {
      return <p>{`${useFlag("checkout")}:${useVariable("label")}`}</p>;
    }
    render(
      <FeaturevisorProvider instance={f}>
        <Reader />
      </FeaturevisorProvider>,
    );
    expect(screen.getByText("false:Blocked")).toBeInTheDocument();
    act(() => {
      f.setDatafile(
        replace
          ? { ...datafile, features: { ...datafile.features, source: source(true) } }
          : {
              schemaVersion: "4",
              revision: "two",
              segments: {},
              features: { source: source(true) },
            },
        replace,
      );
    });
    expect(screen.getByText("true:Allowed")).toBeInTheDocument();
  },
);
