import type { ExistingState, ParsedFeature } from "@featurevisor/types";

import { Datasource } from "./datasource";

describe("persisted state contract", () => {
  it("projects all entries for every adapter without mutating caller state", async () => {
    const state = {
      obsolete: true,
      features: {
        unselected: {
          hash: "keep",
          ranges: [[50001, 100000]],
          variations: [{ value: "control", weight: 100, obsolete: true }],
          traffic: [
            {
              key: "stable",
              percentage: 50000,
              obsolete: true,
              allocation: [
                { variation: "control", range: [0, 50000] as [number, number], obsolete: true },
              ],
            },
          ],
        },
        removedDefinition: { ranges: [[0, 100000]], traffic: [] },
      },
    };
    const before = structuredClone(state);
    const writeState = jest.fn(async () => undefined);
    await Datasource.prototype.writeState.call(
      { adapter: { writeState } },
      false,
      state as ExistingState,
    );
    expect(writeState).toHaveBeenCalledWith(false, {
      features: {
        unselected: {
          hash: "keep",
          variations: [{ value: "control", weight: 100 }],
          traffic: [
            {
              key: "stable",
              percentage: 50000,
              allocation: [{ variation: "control", range: [0, 50000] }],
            },
          ],
        },
        removedDefinition: { traffic: [] },
      },
    });
    expect(state).toEqual(before);
  });
});

function createDatasource(features: Record<string, Partial<ParsedFeature>>) {
  return {
    listFeatures: async () => Object.keys(features),
    featureExists: jest.fn(async (key: string) =>
      Object.prototype.hasOwnProperty.call(features, key),
    ),
    readFeature: jest.fn(async (key: string) => features[key]),
  };
}

describe("core: datasource required features", () => {
  it("returns every feature once for shared dependency branches", async () => {
    const datasource = createDatasource({
      checkout: { conditions: [{ feature: "pricing" }, { feature: "shipping" }] },
      pricing: { conditions: [{ feature: "currency" }] },
      shipping: { conditions: [{ feature: "currency" }] },
      currency: {},
    });

    const result = await Datasource.prototype.getRequiredFeaturesChain.call(datasource, "checkout");

    expect(Array.from(result)).toEqual(["checkout", "pricing", "currency", "shipping"]);
    expect(
      datasource.readFeature.mock.calls.filter(([key]: [string]) => key === "currency"),
    ).toHaveLength(1);
  });

  it("reports nested circular dependencies with their exact path", async () => {
    const datasource = createDatasource({
      checkout: { conditions: [{ feature: "pricing" }] },
      pricing: { conditions: [{ feature: "shipping" }] },
      shipping: { conditions: [{ feature: "pricing" }] },
    });

    await expect(
      Datasource.prototype.getRequiredFeaturesChain.call(datasource, "checkout"),
    ).rejects.toThrow(
      'feature "pricing" conditions[0] -> feature "shipping" conditions[0] -> feature "pricing"',
    );
  });

  it("reports a missing root feature", async () => {
    const datasource = createDatasource({});

    await expect(
      Datasource.prototype.getRequiredFeaturesChain.call(datasource, "missing"),
    ).rejects.toThrow("Feature not found: missing");
  });

  it("reports a missing required feature", async () => {
    const datasource = createDatasource({
      checkout: { conditions: [{ feature: "missing" }] },
    });

    await expect(
      Datasource.prototype.getRequiredFeaturesChain.call(datasource, "checkout"),
    ).rejects.toThrow('required feature "missing" not found');
  });

  it("reports missing structural dependencies under NOT", async () => {
    const datasource = createDatasource({
      checkout: { conditions: { not: [{ feature: "missing" }] } },
    });
    await expect(
      Datasource.prototype.getRequiredFeaturesChain.call(datasource, "checkout"),
    ).rejects.toThrow('required feature "missing" not found');
  });

  it("follows required features that specify a variation", async () => {
    const datasource = createDatasource({
      checkout: {
        conditions: [{ feature: "pricing", variation: "treatment" }],
      },
      pricing: {},
    });

    const result = await Datasource.prototype.getRequiredFeaturesChain.call(datasource, "checkout");

    expect(Array.from(result)).toEqual(["checkout", "pricing"]);
  });

  it("follows canonical requiredFeatures including the direct string shorthand", async () => {
    const datasource = createDatasource({
      checkout: { conditions: { feature: "pricing" } },
      pricing: { conditions: [{ feature: "currency", enabled: false }] },
      currency: {},
    });

    const result = await Datasource.prototype.getRequiredFeaturesChain.call(datasource, "checkout");

    expect(Array.from(result)).toEqual(["checkout", "pricing", "currency"]);
  });

  it("rejects legacy required instead of silently dropping its dependency", async () => {
    const datasource = createDatasource({
      checkout: { required: ["pricing"] } as unknown as Partial<ParsedFeature>,
      pricing: {},
    });
    await expect(
      Datasource.prototype.getRequiredFeaturesChain.call(datasource, "checkout"),
    ).rejects.toThrow(/Legacy feature `required` was removed.*Use `conditions`/);
  });

  it("includes requirements from rule and variation variable overrides", async () => {
    const datasource = createDatasource({
      checkout: {
        rules: {
          production: [
            {
              key: "all",
              conditions: "*",
              percentage: 100,
              variableOverrides: {
                message: [{ conditions: { feature: "pricing" }, value: "rule" }],
              },
            },
          ],
        },
        variations: [
          {
            value: "treatment",
            variableOverrides: {
              message: [
                {
                  conditions: [{ feature: "shipping", enabled: false }],
                  value: "variation",
                },
              ],
            },
          },
        ],
      },
      pricing: { conditions: { feature: "currency" } },
      currency: {},
      shipping: {},
    });

    const result = await Datasource.prototype.getRequiredFeaturesChain.call(datasource, "checkout");

    expect(Array.from(result)).toEqual(["checkout", "pricing", "currency", "shipping"]);
  });

  it("allows non-recursive override requirement cycles", async () => {
    const datasource = createDatasource({
      first: {
        variations: [
          {
            value: "control",
            variableOverrides: { value: [{ conditions: { feature: "second" }, value: "first" }] },
          },
        ],
      },
      second: {
        variations: [
          {
            value: "control",
            variableOverrides: { value: [{ conditions: { feature: "first" }, value: "second" }] },
          },
        ],
      },
    });

    const result = await Datasource.prototype.getRequiredFeaturesChain.call(datasource, "first");
    expect(Array.from(result)).toEqual(["first", "second"]);
  });

  it("includes requirements from every level of a global variable override tree", async () => {
    const datasource = {
      listVariables: async () => ["settings"],
      listFeatures: async () => [
        "root",
        "root-child",
        "country-feature",
        "country-feature-child",
        "city-feature",
        "city-feature-child",
      ],
      readFeature: async (key: string) =>
        key.endsWith("-child") ? {} : { conditions: { feature: `${key}-child` } },
      variableExists: jest.fn(async () => true),
      readVariable: jest.fn(async () => ({
        defaultValue: "default",
        conditions: { feature: "root" },
        overrides: {
          production: [
            {
              key: "country",
              conditions: [{ feature: "country-feature" }],

              value: "country",
              overrides: [
                {
                  key: "city",
                  conditions: [{ feature: "city-feature" }],

                  value: "city",
                },
              ],
            },
          ],
        },
      })),
    };

    const result = await Datasource.prototype.getRequiredFeaturesChainForVariable.call(
      datasource,
      "settings",
    );

    expect(Array.from(result)).toEqual([
      "root",
      "root-child",
      "country-feature",
      "country-feature-child",
      "city-feature",
      "city-feature-child",
    ]);
  });
});
