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
