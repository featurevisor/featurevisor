import type { DatafileContent, DatafileVariable, Feature } from "@featurevisor/types";

import {
  generateHashForFeature,
  generateHashForVariable,
  getSegmentHashes,
  refreshDatafileHashes,
} from "./hashes";

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    bucketBy: "userId",
    traffic: [],
    ...overrides,
  };
}

describe("builder: dependency-aware hashes", () => {
  test("hashes dependencies in every boolean branch", () => {
    const requirements = [{ or: [{ feature: "a" }, { not: [{ feature: "b" }] }] }];
    const features = {
      a: feature(),
      b: feature(),
      root: feature({ conditions: requirements }),
    };
    const variables: Record<string, DatafileVariable> = {
      root: { type: "string", defaultValue: "default", conditions: requirements },
    };
    const beforeFeature = generateHashForFeature("root", features, {});
    const beforeVariable = generateHashForVariable("root", variables, features, {});
    features.b = feature({ bucketBy: "accountId" });
    expect(generateHashForFeature("root", features, {})).not.toBe(beforeFeature);
    expect(generateHashForVariable("root", variables, features, {})).not.toBe(beforeVariable);
  });
  test("includes segments referenced by stringified feature expressions", () => {
    const features = {
      checkout: feature({
        traffic: [
          {
            key: "audience",
            conditions: JSON.stringify({ and: ["audience"] }) as never,
            percentage: 100000,
            allocation: [],
          },
        ],
      }),
    };

    expect(generateHashForFeature("checkout", features, { audience: "one" })).not.toBe(
      generateHashForFeature("checkout", features, { audience: "two" }),
    );
  });

  test("includes segments referenced by traffic variable overrides", () => {
    const features = {
      checkout: feature({
        traffic: [
          {
            key: "all",
            conditions: "*",
            percentage: 100000,
            allocation: [],
            variableOverrides: {
              copy: [{ conditions: "audience", value: "matched" }],
            },
          },
        ],
      }),
    };

    expect(generateHashForFeature("checkout", features, { audience: "one" })).not.toBe(
      generateHashForFeature("checkout", features, { audience: "two" }),
    );
  });

  test("handles cyclic feature variable override requirements", () => {
    const features = {
      first: feature({
        variations: [
          {
            value: "control",
            variableOverrides: {
              copy: [{ conditions: [{ feature: "second" }], value: "first" }],
            },
          },
        ],
      }),
      second: feature({
        variations: [
          {
            value: "control",
            variableOverrides: {
              copy: [{ conditions: [{ feature: "first" }], value: "second" }],
            },
          },
        ],
      }),
    };

    const before = generateHashForFeature("first", features, {});
    expect(before).toEqual(expect.any(String));
    expect(generateHashForFeature("second", features, {})).toEqual(expect.any(String));

    features.second.variations![0].variableOverrides!.copy[0].value = "changed";
    expect(generateHashForFeature("first", features, {})).not.toBe(before);
  });

  test("does not reuse traversal-context results from cycles", () => {
    const features = {
      first: feature({ conditions: [{ feature: "second" }, { feature: "leaf" }] }),
      second: feature({ conditions: [{ feature: "first" }, { feature: "leaf" }] }),
      leaf: feature({ bucketBy: "accountId" }),
    };
    const buildHashes = getSegmentHashes({});

    expect(generateHashForFeature("first", features, buildHashes)).toBe(
      generateHashForFeature("first", features, {}),
    );
    expect(generateHashForFeature("second", features, buildHashes)).toBe(
      generateHashForFeature("second", features, {}),
    );
  });

  test("hashes a 24-node shared DAG within the performance guard", () => {
    const features: Record<string, Feature> = {
      node0: feature(),
      node1: feature({ bucketBy: "accountId" }),
    };
    for (let index = 2; index < 24; index++) {
      features[`node${index}`] = feature({
        conditions: [{ feature: `node${index - 1}` }, { feature: `node${index - 2}` }],
      });
    }

    const segmentHashes = getSegmentHashes({});
    const datafile: DatafileContent = {
      schemaVersion: "2",
      revision: "dag",
      features,
      segments: {},
    };
    const startedAt = Date.now();
    refreshDatafileHashes(datafile);
    const before = features.node23.hash;
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(before).toBe(generateHashForFeature("node23", features, {}));

    features.node0.bucketBy = "organizationId";
    expect(generateHashForFeature("node23", features, segmentHashes)).not.toBe(before);
    refreshDatafileHashes(datafile);
    expect(features.node23.hash).not.toBe(before);
  });

  test("never carries dependency memo entries across mutable caller graphs", () => {
    const features = { checkout: feature({ conditions: [{ feature: "gate" }] }), gate: feature() };
    const variables: Record<string, DatafileVariable> = {
      message: { type: "string", defaultValue: "hello", conditions: [{ feature: "checkout" }] },
    };
    const segments = getSegmentHashes({});
    const before = generateHashForVariable("message", variables, features, segments);
    features.gate.bucketBy = "accountId";
    expect(generateHashForVariable("message", variables, features, segments)).not.toBe(before);
  });

  test("includes segments referenced by stringified global variable expressions", () => {
    const variables: Record<string, DatafileVariable> = {
      message: {
        type: "string",
        defaultValue: "default",
        overrides: [
          {
            key: "audience",
            conditions: JSON.stringify({ or: ["audience"] }),
            value: "matched",
          },
        ],
      },
    };

    expect(generateHashForVariable("message", variables, {}, { audience: "one" })).not.toBe(
      generateHashForVariable("message", variables, {}, { audience: "two" }),
    );
  });

  test("tracks mixed required variable dependencies and terminates mixed cycles", () => {
    const features = {
      checkout: feature({
        conditions: [
          { variable: "region", operator: "equals", value: "eu" },
          { feature: "pricing" },
        ],
      }),
      pricing: feature(),
    };
    const variables: Record<string, DatafileVariable> = {
      region: {
        type: "string",
        defaultValue: "eu",
        conditions: [
          { feature: "checkout", variable: "currency", operator: "equals", value: "EUR" },
        ],
      },
    };
    const before = generateHashForFeature("checkout", features, {}, new Set(), variables);
    expect(before).toEqual(expect.any(String));
    variables.region.defaultValue = "us";
    expect(generateHashForFeature("checkout", features, {}, new Set(), variables)).not.toBe(before);
    const afterVariableChange = generateHashForFeature(
      "checkout",
      features,
      {},
      new Set(),
      variables,
    );
    features.pricing.bucketBy = "accountId";
    expect(generateHashForFeature("checkout", features, {}, new Set(), variables)).not.toBe(
      afterVariableChange,
    );
  });
});
