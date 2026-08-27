import {
  assertFindUsageOptions,
  findAllUsageInFeatures,
  findAllUsageInVariables,
  findUnusedAttributes,
  findUnusedSegments,
} from "./index";

describe("core: find usage CLI options", function () {
  test("requires exactly one usage query", function () {
    expect(() => assertFindUsageOptions({})).toThrow("Specify one usage query");
    expect(() => assertFindUsageOptions({ feature: "checkout", unusedSegments: true })).toThrow(
      "Specify only one usage query",
    );
    expect(() => assertFindUsageOptions({ segment: "mobile", authors: true })).not.toThrow();
    expect(() => assertFindUsageOptions({ variable: "settings" })).not.toThrow();
  });

  test("finds transitive schema dependencies without scanning runtime values", async function () {
    const usage = await findAllUsageInVariables({
      datasource: {
        listVariables: async () => ["settings"],
        readVariable: async () => ({
          schema: "outer",
          defaultValue: { schema: "not-a-reference" },
          overrides: [
            {
              key: "targeted",
              segments: { and: ["mobile", { not: ["internal"] }] },
              conditions: { attribute: "country", operator: "equals", value: "nl" },
              value: { schema: "also-not-a-reference" },
            },
          ],
        }),
        readSchema: async (key: string) =>
          key === "outer"
            ? { type: "object", properties: { value: { schema: "inner" } } }
            : { type: "string" },
        getRequiredFeaturesChainForVariable: async () =>
          new Set(["checkout", "account", "authenticated"]),
      },
    } as any);

    expect(Array.from(usage.settings.schemas).sort()).toEqual(["inner", "outer"]);
    expect(Array.from(usage.settings.features).sort()).toEqual([
      "account",
      "authenticated",
      "checkout",
    ]);
    expect(Array.from(usage.settings.segments).sort()).toEqual(["internal", "mobile"]);
    expect(Array.from(usage.settings.attributes)).toEqual(["country"]);
  });

  test("finds dependencies in every environment-aware feature location", async function () {
    const usage = await findAllUsageInFeatures({
      projectConfig: { environments: ["staging", "production"] },
      datasource: {
        listFeatures: async () => ["checkout"],
        readFeature: async () => ({
          bucketBy: { or: ["userId", "deviceId"] },
          requiredFeatures: ["account"],
          variations: [
            {
              value: "treatment",
              variableOverrides: {
                message: [
                  {
                    segments: "variation-segment",
                    conditions: { attribute: "locale", operator: "equals", value: "nl" },
                    requiredFeatures: "variation-dependency",
                    value: "variation",
                  },
                ],
              },
            },
          ],
          force: {
            staging: [
              {
                segments: "force-segment",
                conditions: { attribute: "staff", operator: "equals", value: true },
                enabled: true,
              },
            ],
          },
          rules: {
            production: [
              {
                key: "targeted",
                segments: "rule-segment",
                percentage: 100,
                variableOverrides: {
                  message: [
                    {
                      segments: "override-segment",
                      conditions: {
                        attribute: "country",
                        operator: "equals",
                        value: "de",
                      },
                      requiredFeatures: "rule-dependency",
                      value: "rule",
                    },
                  ],
                },
              },
            ],
          },
        }),
      },
    } as any);

    expect(Array.from(usage.checkout.features).sort()).toEqual([
      "account",
      "rule-dependency",
      "variation-dependency",
    ]);
    expect(Array.from(usage.checkout.segments).sort()).toEqual([
      "force-segment",
      "override-segment",
      "rule-segment",
      "variation-segment",
    ]);
    expect(Array.from(usage.checkout.attributes).sort()).toEqual([
      "country",
      "deviceId",
      "locale",
      "staff",
      "userId",
    ]);
  });

  test("finds dependencies in environmentless features and counts global variable usage", async () => {
    const deps = {
      projectConfig: { environments: false },
      datasource: {
        listFeatures: async () => ["checkout"],
        readFeature: async () => ({
          bucketBy: ["userId", "deviceId"],
          required: ["legacy-dependency"],
          force: [
            {
              segments: "force-segment",
              conditions: { attribute: "staff", operator: "equals", value: true },
              enabled: true,
            },
          ],
          rules: [
            {
              key: "targeted",
              segments: "rule-segment",
              percentage: 100,
              variableOverrides: {
                message: [
                  {
                    segments: "override-segment",
                    conditions: { attribute: "country", operator: "equals", value: "nl" },
                    value: "rule",
                  },
                ],
              },
            },
          ],
        }),
        listSegments: async () => [
          "force-segment",
          "rule-segment",
          "override-segment",
          "global-segment",
          "unused-segment",
        ],
        listAttributes: async () => ["userId", "deviceId", "staff", "country", "global", "unused"],
      },
    } as any;
    const featureUsage = await findAllUsageInFeatures(deps);
    const variableUsage = {
      settings: {
        features: new Set<string>(),
        segments: new Set(["global-segment"]),
        attributes: new Set(["global"]),
        schemas: new Set<string>(),
      },
    };

    expect(Array.from(featureUsage.checkout.features)).toEqual(["legacy-dependency"]);
    expect(Array.from(featureUsage.checkout.segments).sort()).toEqual([
      "force-segment",
      "override-segment",
      "rule-segment",
    ]);
    expect(Array.from(featureUsage.checkout.attributes).sort()).toEqual([
      "country",
      "deviceId",
      "staff",
      "userId",
    ]);
    await expect(findUnusedSegments(deps, featureUsage, variableUsage)).resolves.toEqual(
      new Set(["unused-segment"]),
    );
    await expect(findUnusedAttributes(deps, featureUsage, {}, variableUsage)).resolves.toEqual(
      new Set(["unused"]),
    );
  });
});
