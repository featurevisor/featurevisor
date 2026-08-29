import type { ParsedFeature } from "@featurevisor/types";

import { Datasource } from "./datasource";

function createDatasource(features: Record<string, Partial<ParsedFeature>>) {
  return {
    featureExists: jest.fn(async (key: string) =>
      Object.prototype.hasOwnProperty.call(features, key),
    ),
    readFeature: jest.fn(async (key: string) => features[key]),
  };
}

describe("core: datasource required features", () => {
  it("returns every feature once for shared dependency branches", async () => {
    const datasource = createDatasource({
      checkout: { required: ["pricing", "shipping"] },
      pricing: { required: ["currency"] },
      shipping: { required: ["currency"] },
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
      checkout: { required: ["pricing"] },
      pricing: { required: ["shipping"] },
      shipping: { required: ["pricing"] },
    });

    await expect(
      Datasource.prototype.getRequiredFeaturesChain.call(datasource, "checkout"),
    ).rejects.toThrow("circular dependency found: pricing -> shipping -> pricing");
  });

  it("reports a missing root feature", async () => {
    const datasource = createDatasource({});

    await expect(
      Datasource.prototype.getRequiredFeaturesChain.call(datasource, "missing"),
    ).rejects.toThrow("Feature not found: missing");
  });

  it("reports a missing required feature", async () => {
    const datasource = createDatasource({
      checkout: { required: ["missing"] },
    });

    await expect(
      Datasource.prototype.getRequiredFeaturesChain.call(datasource, "checkout"),
    ).rejects.toThrow('required feature "missing" not found');
  });

  it("follows required features that specify a variation", async () => {
    const datasource = createDatasource({
      checkout: {
        required: [{ key: "pricing", variation: "treatment" }],
      },
      pricing: {},
    });

    const result = await Datasource.prototype.getRequiredFeaturesChain.call(datasource, "checkout");

    expect(Array.from(result)).toEqual(["checkout", "pricing"]);
  });

  it("follows canonical requiredFeatures including the direct string shorthand", async () => {
    const datasource = createDatasource({
      checkout: { requiredFeatures: "pricing" },
      pricing: { requiredFeatures: [{ feature: "currency", enabled: false }] },
      currency: {},
    });

    const result = await Datasource.prototype.getRequiredFeaturesChain.call(datasource, "checkout");

    expect(Array.from(result)).toEqual(["checkout", "pricing", "currency"]);
  });

  it("includes requirements from rule and variation variable overrides", async () => {
    const datasource = createDatasource({
      checkout: {
        rules: {
          production: [
            {
              key: "all",
              segments: "*",
              percentage: 100,
              variableOverrides: {
                message: [{ requiredFeatures: "pricing", value: "rule" }],
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
                  requiredFeatures: [{ feature: "shipping", enabled: false }],
                  value: "variation",
                },
              ],
            },
          },
        ],
      },
      pricing: { requiredFeatures: "currency" },
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
            variableOverrides: { value: [{ requiredFeatures: "second", value: "first" }] },
          },
        ],
      },
      second: {
        variations: [
          {
            value: "control",
            variableOverrides: { value: [{ requiredFeatures: "first", value: "second" }] },
          },
        ],
      },
    });

    const result = await Datasource.prototype.getRequiredFeaturesChain.call(datasource, "first");
    expect(Array.from(result)).toEqual(["first", "second"]);
  });

  it("includes requirements from every level of a global variable override tree", async () => {
    const datasource = {
      variableExists: jest.fn(async () => true),
      readVariable: jest.fn(async () => ({
        defaultValue: "default",
        requiredFeatures: "root",
        overrides: {
          production: [
            {
              key: "country",
              segments: "*",
              requiredFeatures: "country-feature",
              value: "country",
              overrides: [
                {
                  key: "city",
                  segments: "*",
                  requiredFeatures: "city-feature",
                  value: "city",
                },
              ],
            },
          ],
        },
      })),
      getRequiredFeaturesChain: jest.fn(async (key: string) => new Set([key, `${key}-child`])),
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
