import type { DatafileContent, Feature } from "@featurevisor/types";

import {
  addDatafileDependencyChanges,
  createDatafileDependencyIndex as indexStoredDatafile,
} from "./dependencies";
import { normalizeDatafile } from "./normalize";

function createDatafileDependencyIndex(datafile: DatafileContent) {
  return indexStoredDatafile(normalizeDatafile(datafile));
}

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    bucketBy: "userId",
    traffic: [],
    ...overrides,
  };
}

function dictionary<TValue>(entries: Array<[string, TValue]>): Record<string, TValue> {
  const result = Object.create(null) as Record<string, TValue>;
  for (const [key, value] of entries) result[key] = value;
  return result;
}

describe("datafile dependency index", () => {
  it("deduplicates interleaved source forms per entity without scanning previous fanout", () => {
    const variables: DatafileContent["variables"] = {};
    for (let index = 0; index < 1000; index++)
      variables[`config${index}`] = {
        type: "object",
        compose: [
          { key: "a", feature: "source" },
          { key: "b", variable: "settings" },
          { key: "c", feature: "source", variation: true },
          { key: "d", feature: "other" },
          { key: "e", feature: "source", variable: "label" },
          { key: "f", variable: "settings" },
        ],
      };
    const scan = jest.spyOn(Array.prototype, "indexOf");
    let index;
    try {
      index = createDatafileDependencyIndex({
        schemaVersion: "2",
        revision: "fanout",
        segments: {},
        features: {},
        variables,
      });
      expect(scan).not.toHaveBeenCalled();
    } finally {
      scan.mockRestore();
    }
    expect(index.featureVariables.source).toEqual(Object.keys(variables));
    expect(index.variableVariables.settings).toEqual(Object.keys(variables));
    expect(index.featureVariables.other).toEqual(Object.keys(variables));
  });
  it("indexes every feature and global variable dependency source", () => {
    const datafile: DatafileContent = {
      schemaVersion: "2",
      revision: "dependencies",
      segments: {},
      features: {
        checkout: feature({
          requiredFeatures: ["canonical"],
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
                    requiredFeatures: "pricing",
                    value: "traffic",
                  },
                ],
              },
            },
            {
              key: "malformed",
              conditions: undefined,
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
      variableFeatures: {},
      variableVariables: {},
      segmentSegments: {},
      featureSegments: {},
      variableSegments: {},
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

  it("indexes recursive required variables at roots and overrides", () => {
    const index = createDatafileDependencyIndex({
      schemaVersion: "2",
      revision: "required-variables",
      segments: {},
      features: {
        checkout: feature({
          conditions: [
            { variable: "country", operator: "equals", value: "nl" },
            {
              and: [
                {
                  feature: "account",
                  variable: "plan",
                  path: ["name"],
                  operator: "equals",
                  value: "pro",
                },
                {
                  not: [{ variable: "blocked", operator: "equals", value: true }],
                },
              ],
            },
          ],
          traffic: [
            {
              key: "all",
              segments: "*",
              percentage: 100000,
              variableOverrides: {
                message: [
                  {
                    key: "locale",
                    conditions: [{ variable: "locale", operator: "equals", value: "nl" }],
                    value: "Hallo",
                  },
                ],
              },
            },
          ],
        }),
        account: feature(),
      },
      variables: {
        greeting: {
          type: "string",
          defaultValue: "Hello",
          conditions: [
            { feature: "checkout", variable: "message", operator: "equals", value: "Hallo" },
            { variable: "country", operator: "equals", value: "nl" },
          ],
          overrideProgram: [
            {
              key: "nested",
              conditions: [{ variable: "currency", operator: "equals", value: "EUR" }],
              operations: [],
              onMatch: 1,
              onMiss: 1,
            },
          ],
        },
      },
    });

    expect(index.variableFeatures).toEqual({
      country: ["checkout"],
      blocked: ["checkout"],
      locale: ["checkout"],
    });
    expect(index.featureDependents.account).toEqual(["checkout"]);
    expect(index.featureVariables.checkout).toEqual(["greeting"]);
    expect(index.variableVariables).toEqual({
      country: ["greeting"],
      currency: ["greeting"],
    });
  });

  it("propagates mixed feature and variable dependencies in both directions", () => {
    const index = createDatafileDependencyIndex({
      schemaVersion: "2",
      revision: "mixed",
      segments: {},
      features: {
        checkout: feature({
          conditions: [{ variable: "currency", operator: "equals", value: "EUR" }],
        }),
        receipt: feature({ requiredFeatures: ["checkout"] }),
      },
      variables: {
        currency: { type: "string", defaultValue: "EUR" },
        summary: {
          type: "string",
          defaultValue: "",
          conditions: [
            { feature: "receipt", variable: "title", operator: "equals", value: "Receipt" },
          ],
        },
        final: {
          type: "string",
          defaultValue: "",
          conditions: [{ variable: "summary", operator: "equals", value: "" }],
        },
      },
    });
    const features: string[] = [];
    const variables = ["currency"];

    addDatafileDependencyChanges(features, variables, [], index);

    expect(features).toEqual(["checkout", "receipt"]);
    expect(variables).toEqual(["currency", "summary", "final"]);
  });

  it("keeps same-named feature and global variable identities separate", () => {
    const index = createDatafileDependencyIndex({
      schemaVersion: "2",
      revision: "namespaces",
      segments: {},
      features: {
        shared: feature(),
        fromFeature: feature({ requiredFeatures: ["shared"] }),
        fromVariable: feature({
          conditions: [{ variable: "shared", operator: "equals", value: true }],
        }),
      },
      variables: { shared: { type: "boolean", defaultValue: false } },
    });
    const featureChanges = ["shared"];
    const variableChanges: string[] = [];
    addDatafileDependencyChanges(featureChanges, variableChanges, [], index);
    expect(featureChanges).toEqual(["shared", "fromFeature"]);
    expect(variableChanges).toEqual([]);

    addDatafileDependencyChanges([], variableChanges, [], index);
    expect(variableChanges).toEqual([]);
    const changedVariables = ["shared"];
    const changedFeatures: string[] = [];
    addDatafileDependencyChanges(changedFeatures, changedVariables, [], index);
    expect(changedFeatures).toEqual(["fromVariable"]);
  });

  it("can merge propagation from old and new indexes for removed dependency paths", () => {
    const oldIndex = createDatafileDependencyIndex({
      schemaVersion: "2",
      revision: "old",
      segments: {},
      features: {
        checkout: feature({
          conditions: [{ variable: "country", operator: "equals", value: "nl" }],
        }),
      },
      variables: { country: { type: "string", defaultValue: "nl" } },
    });
    const newIndex = createDatafileDependencyIndex({
      schemaVersion: "2",
      revision: "new",
      segments: {},
      features: { checkout: feature() },
      variables: { country: { type: "string", defaultValue: "de" } },
    });
    const features: string[] = [];
    const variables = ["country"];

    addDatafileDependencyChanges(features, variables, [], oldIndex);
    addDatafileDependencyChanges(features, variables, [], newIndex);

    expect(features).toEqual(["checkout"]);
  });

  it.each(["toString", "constructor", "hasOwnProperty", "__proto__"])(
    "indexes the literal dependency key %s without reading or mutating prototypes",
    (key) => {
      const featureKey = `feature-${key}`;
      const variableKey = `variable-${key}`;
      const index = createDatafileDependencyIndex({
        schemaVersion: "2",
        revision: key,
        segments: dictionary([[key, { conditions: "*" }]]),
        features: dictionary([
          [key, feature()],
          [
            featureKey,
            feature({
              requiredFeatures: [key],
              conditions: [{ variable: key, operator: "notNull" }],
              traffic: [{ key: "segment", segments: key, percentage: 100000 }],
            }),
          ],
        ]),
        variables: dictionary([
          [key, { type: "string", defaultValue: "source" }],
          [
            variableKey,
            {
              type: "string",
              defaultValue: "dependent",
              requiredFeatures: [key],
              conditions: [{ variable: key, operator: "notNull" }],
              overrides: [{ key: "segment", segments: key, value: "matched" }],
            },
          ],
        ]),
      });

      expect(index.segmentFeatures[key]).toEqual([featureKey]);
      expect(index.featureDependents[key]).toEqual([featureKey]);
      expect(index.variableFeatures[key]).toEqual([featureKey]);
      expect(index.segmentVariables[key]).toEqual([variableKey]);
      expect(index.featureVariables[key]).toEqual([variableKey]);
      expect(index.variableVariables[key]).toEqual([variableKey]);
      expect(Object.getPrototypeOf(index.segmentFeatures)).toBeNull();

      const features = [key];
      const variables = [key];
      addDatafileDependencyChanges(features, variables, [key], index);
      expect(features).toEqual([key, featureKey]);
      expect(variables).toEqual([key, variableKey]);
      expect(Object.prototype).not.toHaveProperty(featureKey);
      expect(Object.prototype).not.toHaveProperty(variableKey);
    },
  );
});
