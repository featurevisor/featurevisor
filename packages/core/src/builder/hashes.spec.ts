import type { DatafileVariable, Feature } from "@featurevisor/types";

import { generateHashForFeature, generateHashForVariable } from "./hashes";

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    bucketBy: "userId",
    traffic: [],
    ...overrides,
  };
}

describe("builder: dependency-aware hashes", () => {
  test("includes segments referenced by stringified feature expressions", () => {
    const features = {
      checkout: feature({
        traffic: [
          {
            key: "audience",
            segments: JSON.stringify({ and: ["audience"] }) as never,
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
            segments: "*",
            percentage: 100000,
            allocation: [],
            variableOverrides: {
              copy: [{ segments: "audience", value: "matched" }],
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
              copy: [{ requiredFeatures: ["second"], value: "first" }],
            },
          },
        ],
      }),
      second: feature({
        variations: [
          {
            value: "control",
            variableOverrides: {
              copy: [{ requiredFeatures: ["first"], value: "second" }],
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

  test("includes segments referenced by stringified global variable expressions", () => {
    const variables: Record<string, DatafileVariable> = {
      message: {
        type: "string",
        defaultValue: "default",
        overrides: [
          {
            key: "audience",
            segments: JSON.stringify({ or: ["audience"] }),
            value: "matched",
          },
        ],
      },
    };

    expect(generateHashForVariable("message", variables, {}, { audience: "one" })).not.toBe(
      generateHashForVariable("message", variables, {}, { audience: "two" }),
    );
  });
});
