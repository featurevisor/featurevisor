import { createFeaturevisor } from "@featurevisor/sdk";

import { onFeatureChange } from "./onFeatureChange";

function datafileForTestFeature(hash = "h1") {
  return {
    schemaVersion: "2" as const,
    revision: "1.0",
    segments: {},
    features: {
      test: {
        key: "test",
        bucketBy: "userId" as const,
        traffic: [
          {
            key: "1",
            segments: "*" as const,
            percentage: 100000,
            allocation: [],
          },
        ],
        hash,
      },
    },
  };
}

function datafileWithTwoFeatures(testHash = "t1", otherHash = "o1") {
  return {
    schemaVersion: "2" as const,
    revision: "1.0",
    segments: {},
    features: {
      test: {
        key: "test",
        bucketBy: "userId" as const,
        traffic: [
          {
            key: "1",
            segments: "*" as const,
            percentage: 100000,
            allocation: [],
          },
        ],
        hash: testHash,
      },
      other: {
        key: "other",
        bucketBy: "userId" as const,
        traffic: [
          {
            key: "1",
            segments: "*" as const,
            percentage: 100000,
            allocation: [],
          },
        ],
        hash: otherHash,
      },
    },
  };
}

describe("react: onFeatureChange", function () {
  test("should invoke callback on context_set", function () {
    const sdk = createFeaturevisor({ datafile: datafileForTestFeature() });
    let calls = 0;
    const unsubscribe = onFeatureChange(sdk, "test", () => {
      calls += 1;
    });

    sdk.setContext({ tenant: "a" });
    expect(calls).toBe(1);

    sdk.setContext({ tenant: "b" });
    expect(calls).toBe(2);

    unsubscribe();
    sdk.setContext({ tenant: "c" });
    expect(calls).toBe(2);
  });

  test("should invoke callback on datafile_set when that feature is affected", function () {
    const sdk = createFeaturevisor({ datafile: datafileForTestFeature("a") });
    let calls = 0;
    onFeatureChange(sdk, "test", () => {
      calls += 1;
    });

    sdk.setDatafile(datafileForTestFeature("b"));
    expect(calls).toBe(1);
  });

  test("should not invoke callback on datafile_set when only a different feature changed", function () {
    const sdk = createFeaturevisor({ datafile: datafileWithTwoFeatures("t1", "o1") });
    let calls = 0;
    onFeatureChange(sdk, "test", () => {
      calls += 1;
    });

    sdk.setDatafile(datafileWithTwoFeatures("t1", "o2"));
    expect(calls).toBe(0);
  });

  test("should invoke callback on sticky_set when that feature is listed", function () {
    const sdk = createFeaturevisor({ datafile: datafileForTestFeature() });
    let calls = 0;
    onFeatureChange(sdk, "test", () => {
      calls += 1;
    });

    sdk.setSticky({
      test: { enabled: true },
    });
    expect(calls).toBe(1);
  });

  test("should not invoke callback on sticky_set when another feature is listed", function () {
    const sdk = createFeaturevisor({ datafile: datafileWithTwoFeatures() });
    let calls = 0;
    onFeatureChange(sdk, "test", () => {
      calls += 1;
    });

    sdk.setSticky({
      other: { enabled: true },
    });
    expect(calls).toBe(0);
  });

  test("unsubscribe should remove all listeners", function () {
    const sdk = createFeaturevisor({ datafile: datafileForTestFeature("1") });
    let calls = 0;
    const off = onFeatureChange(sdk, "test", () => {
      calls += 1;
    });

    off();

    sdk.setContext({ x: 1 });
    sdk.setDatafile(datafileForTestFeature("2"));
    sdk.setSticky({ test: { enabled: false } }, true);

    expect(calls).toBe(0);
  });
});
