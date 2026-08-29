import type { DatafileContent, Feature } from "@featurevisor/types";

import { addDatafileDependencyChanges, createDatafileDependencyIndex } from "./dependencies";

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    bucketBy: "userId",
    traffic: [],
    ...overrides,
  };
}

describe("datafile dependency index", () => {
  it("indexes every feature and global variable dependency source", () => {
    const datafile: DatafileContent = {
      schemaVersion: "2",
      revision: "dependencies",
      segments: {},
      features: {
        checkout: feature({
          requiredFeatures: ["canonical"],
          required: ["legacy"],
          force: [{ segments: "forced", enabled: true }],
          traffic: [
            {
              key: "targeted",
              segments: JSON.stringify({ and: ["mobile", { or: ["desktop", "*"] }] }),
              percentage: 100000,
              variableOverrides: {
                message: [
                  {
                    key: "traffic",
                    segments: { not: ["beta"] },
                    requiredFeatures: ["pricing"],
                    value: "traffic",
                  },
                ],
              },
            },
            {
              key: "malformed",
              segments: "{not-json",
              percentage: 0,
            },
          ],
          variations: [
            {
              value: "treatment",
              variableOverrides: {
                message: [
                  {
                    key: "variation",
                    segments: ["variation", "mobile"],
                    requiredFeatures: [{ feature: "shipping", enabled: false }],
                    value: "variation",
                  },
                ],
              },
            },
          ],
        }),
        consumer: feature({ requiredFeatures: ["checkout"] }),
        canonical: feature(),
        legacy: feature(),
        pricing: feature(),
        shipping: feature(),
      },
      variables: {
        settings: {
          type: "string",
          defaultValue: "default",
          requiredFeatures: ["consumer"],
          overrides: [
            {
              key: "targeted",
              segments: JSON.stringify(["global", "*"]),
              requiredFeatures: [{ feature: "account", variation: "pro" }],
              value: "targeted",
            },
          ],
        },
      },
    };

    expect(createDatafileDependencyIndex(datafile)).toEqual({
      segmentFeatures: {
        forced: ["checkout"],
        mobile: ["checkout"],
        desktop: ["checkout"],
        beta: ["checkout"],
        variation: ["checkout"],
      },
      featureDependents: {
        canonical: ["checkout"],
        pricing: ["checkout"],
        shipping: ["checkout"],
        checkout: ["consumer"],
      },
      segmentVariables: {
        global: ["settings"],
      },
      featureVariables: {
        consumer: ["settings"],
        account: ["settings"],
      },
    });
  });

  it("propagates changes transitively without duplicates and terminates cycles", () => {
    const index = createDatafileDependencyIndex({
      schemaVersion: "2",
      revision: "cycles",
      segments: {},
      features: {
        first: feature({
          requiredFeatures: ["second"],
          traffic: [{ key: "mobile", segments: "mobile", percentage: 100000 }],
        }),
        second: feature({ requiredFeatures: ["first"] }),
        third: feature({ requiredFeatures: ["second"] }),
      },
      variables: {
        result: {
          type: "boolean",
          defaultValue: false,
          requiredFeatures: ["third", "first"],
        },
      },
    });
    const features = ["first"];
    const variables = ["result"];

    addDatafileDependencyChanges(features, variables, ["mobile", "mobile"], index);

    expect(features).toEqual(["first", "second", "third"]);
    expect(variables).toEqual(["result"]);
  });
});
