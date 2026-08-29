import { createFeaturevisor } from "@featurevisor/sdk";

import { onVariableChange } from "./onVariableChange";

describe("react: onVariableChange", () => {
  test("invokes the callback when a segment dependency changes in a partial datafile", () => {
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: {
        schemaVersion: "2",
        revision: "1",
        segments: { audience: { conditions: "*" } },
        features: {},
        variables: {
          message: {
            hash: "message",
            type: "string",
            defaultValue: "default",
            overrides: [{ key: "audience", segments: "audience", value: "matched" }],
          },
        },
      },
    });
    let calls = 0;
    const unsubscribe = onVariableChange(sdk, "message", () => {
      calls += 1;
    });

    sdk.setDatafile({
      schemaVersion: "2",
      revision: "2",
      segments: {
        audience: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
      },
      features: {},
    });

    expect(calls).toBe(1);
    unsubscribe();
  });

  test("uses propagated feature dependencies without reacting to unrelated features", () => {
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: {
        schemaVersion: "2",
        revision: "1",
        segments: {},
        features: {
          prerequisite: { hash: "old", bucketBy: "userId", traffic: [] },
          unrelated: { hash: "old", bucketBy: "userId", traffic: [] },
        },
        variables: {
          message: {
            hash: "message",
            type: "string",
            defaultValue: "default",
            requiredFeatures: ["prerequisite"],
          },
        },
      },
    });
    let calls = 0;
    onVariableChange(sdk, "message", () => {
      calls += 1;
    });

    sdk.setDatafile({
      schemaVersion: "2",
      revision: "2",
      segments: {},
      features: {
        unrelated: { hash: "new", bucketBy: "userId", traffic: [] },
      },
    });
    expect(calls).toBe(0);

    sdk.setDatafile({
      schemaVersion: "2",
      revision: "3",
      segments: {},
      features: {
        prerequisite: { hash: "new", bucketBy: "userId", traffic: [] },
      },
    });
    expect(calls).toBe(1);
  });

  test("filters direct updates, follows shared state, and unsubscribes from every event", () => {
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: {
        schemaVersion: "2",
        revision: "1",
        segments: {},
        features: {},
        variables: {
          message: { hash: "message-1", type: "string", defaultValue: "message" },
          unrelated: { hash: "unrelated-1", type: "string", defaultValue: "unrelated" },
        },
      },
    });
    const callback = jest.fn();
    const unsubscribe = onVariableChange(sdk, "message", callback);

    sdk.setStickyVariables({ unrelated: "changed" });
    sdk.setDatafile({
      schemaVersion: "2",
      revision: "2",
      segments: {},
      features: {},
      variables: {
        unrelated: { hash: "unrelated-2", type: "string", defaultValue: "changed" },
      },
    });
    expect(callback).not.toHaveBeenCalled();

    sdk.setContext({ country: "nl" });
    sdk.setStickyVariables({ message: "sticky" });
    sdk.setStickyFeatures({});
    sdk.setStickyFeatures({ checkout: { enabled: true } });
    sdk.setDatafile({
      schemaVersion: "2",
      revision: "3",
      segments: {},
      features: {},
      variables: {
        message: { hash: "message-2", type: "string", defaultValue: "changed" },
      },
    });
    expect(callback).toHaveBeenCalledTimes(4);

    unsubscribe();
    sdk.setContext({ country: "de" });
    sdk.setStickyVariables({ message: "after-unsubscribe" });
    expect(callback).toHaveBeenCalledTimes(4);
  });
});
