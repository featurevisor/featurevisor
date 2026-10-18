import {
  assertFindUsageOptions,
  findAllUsageInFeatures,
  findAllUsageInSegments,
  findAllUsageInVariables,
  findUsageInProject,
  findUnusedAttributes,
  findUnusedSegments,
} from "./index";
import * as path from "path";
import { Datasource } from "../datasource";
import { getProjectConfig } from "../config";

describe("core: find usage CLI options", function () {
  test("finds mixed references through segments, roots, force, rules and overrides", async () => {
    const segments = {
      audience: { conditions: ["member", { variable: "permission", operator: "exists" }] },
      member: {
        conditions: [
          { feature: "source" },
          { attribute: "user.country", operator: "equals", value: "nl" },
        ],
      },
      unused: { conditions: "*" },
    };
    const features = {
      source: {
        bucketBy: "userId",
        variablesSchema: { limit: { type: "integer", defaultValue: 5 } },
      },
      selected: {
        bucketBy: "userId",
        conditions: "audience",
        force: [{ conditions: { variable: "forceVariable", operator: "exists" } }],
        rules: [
          {
            key: "member",
            conditions: { feature: "source", variable: "limit", operator: "equals", value: 5 },
            variableOverrides: {
              label: [
                { conditions: { variable: "overrideVariable", operator: "exists" }, value: "yes" },
              ],
            },
          },
        ],
        variablesSchema: { label: { type: "string", defaultValue: "no" } },
      },
    };
    const variables = {
      permission: { type: "boolean", defaultValue: true },
      forceVariable: { type: "boolean", defaultValue: true },
      overrideVariable: { type: "boolean", defaultValue: true },
      view: { type: "boolean", defaultValue: true, conditions: "audience" },
    };
    const deps = {
      datasource: {
        listSegments: async () => Object.keys(segments),
        readSegment: async (key) => segments[key],
        segmentExists: async (key) => Object.prototype.hasOwnProperty.call(segments, key),
        listFeatures: async () => Object.keys(features),
        readFeature: async (key) => features[key],
        listVariables: async () => Object.keys(variables),
        readVariable: async (key) => variables[key],
        listTests: async () => [],
        listScenarios: async () => [],
      },
    } as any;
    const featureUsage = await findAllUsageInFeatures(deps);
    expect(featureUsage.selected.features).toEqual(new Set(["source"]));
    expect(featureUsage.selected.variables).toEqual(
      new Set(["permission", "forceVariable", "overrideVariable"]),
    );
    expect(featureUsage.selected.segments).toEqual(new Set(["audience", "member"]));
    expect(featureUsage.selected.attributes).toEqual(new Set(["userId", "user"]));
    const segmentUsage = await findAllUsageInSegments(deps);
    expect(segmentUsage.audience).toMatchObject({
      features: new Set(["source"]),
      variables: new Set(["permission"]),
      segments: new Set(["member"]),
    });
    const variableUsage = await findAllUsageInVariables(deps);
    expect(variableUsage.view.features).toEqual(new Set(["source"]));
    expect(await findUnusedSegments(deps, featureUsage, variableUsage)).toEqual(
      new Set(["unused"]),
    );
    const log = jest.spyOn(console, "log").mockImplementation();
    try {
      for (const query of [
        { segment: "member" },
        { feature: "source" },
        { variable: "permission" },
      ])
        await findUsageInProject(deps, query);
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain('Segment "member" is used in these segments');
      expect(output).toContain('Feature "source" is used in these segments');
      expect(output).toContain("Conditions in segments");
      await expect(findUsageInProject(deps, { segment: "membr" })).rejects.toThrow(
        'Unknown segment "membr". Did you mean "member"?',
      );
      await expect(findUsageInProject(deps, { feature: "missing" })).rejects.toThrow(
        'Unknown feature "missing".',
      );
    } finally {
      log.mockRestore();
    }
  });

  test("ignores archived referrers for unused lists and labels them elsewhere", async () => {
    const attributes = {
      userId: {},
      country: {},
      plan: {},
      tier: {},
      legacy: { archived: true },
    };
    const segments = {
      netherlands: { conditions: [{ attribute: "country", operator: "equals", value: "nl" }] },
      paying: { conditions: [{ attribute: "plan", operator: "equals", value: "paid" }] },
      retired: { archived: true, conditions: "*" },
    };
    const features = {
      checkout: { bucketBy: "userId", conditions: "netherlands" },
      oldPromo: {
        archived: true,
        bucketBy: "userId",
        conditions: ["paying", { attribute: "tier", operator: "equals", value: "gold" }],
      },
    };
    const deps = {
      datasource: {
        listAttributes: async () => Object.keys(attributes),
        readAttribute: async (key) => attributes[key],
        listSegments: async () => Object.keys(segments),
        readSegment: async (key) => segments[key],
        segmentExists: async (key) => Object.prototype.hasOwnProperty.call(segments, key),
        listFeatures: async () => Object.keys(features),
        readFeature: async (key) => features[key],
        listVariables: async () => [],
        readVariable: async () => undefined,
        listTests: async () => [],
        listScenarios: async () => [],
      },
    } as any;
    const featureUsage = await findAllUsageInFeatures(deps);
    const segmentUsage = await findAllUsageInSegments(deps);

    // paying and tier are used only by an archived feature. Archived ones are never listed.
    expect(await findUnusedSegments(deps, featureUsage)).toEqual(new Set(["paying"]));
    expect(await findUnusedAttributes(deps, featureUsage, segmentUsage)).toEqual(new Set(["tier"]));

    const log = jest.spyOn(console, "log").mockImplementation();
    try {
      await findUsageInProject(deps, { segment: "paying" });
      const output = log.mock.calls
        .flat()
        .join("\n")
        .replace(/\x1b\[[0-9;]*m/g, "");
      expect(output).toContain("oldPromo (archived)");
    } finally {
      log.mockRestore();
    }
  });

  test("suggests the project namespace character for an unknown key", async () => {
    const deps = {
      projectConfig: { namespaceCharacter: "." },
      datasource: {
        listSegments: async () => ["countries.netherlands"],
        listFeatures: async () => [],
        listAttributes: async () => ["browser"],
      },
    } as any;
    const log = jest.spyOn(console, "log").mockImplementation();
    try {
      await expect(findUsageInProject(deps, { segment: "countries/netherlands" })).rejects.toThrow(
        'Unknown segment "countries/netherlands". Did you mean "countries.netherlands"? This project separates namespaces with ".".',
      );
      await expect(findUsageInProject(deps, { attribute: "device.os" })).rejects.toThrow(
        'Unknown attribute "device.os".',
      );
    } finally {
      log.mockRestore();
    }
  });
  test.each([false, ["production"]])(
    "separates direct composition and requirement users (environments: %j)",
    async (environments) => {
      const requirement = { variable: "policy", operator: "exists" };
      const variables: Record<string, any> = {
        policy: { defaultValue: { limit: 10 } },
        alias: { compose: "policy" },
        aliasChain: { compose: "alias" },
        screen: { compose: { view: { variable: "config" } } },
        config: { compose: { policy: { variable: "policy" }, again: { variable: "policy" } } },
        both: {
          compose: { policy: { variable: "policy" } },
          conditions: { not: [{ or: [requirement] }] },
        },
        gated: { defaultValue: true, conditions: requirement },
        indirectRequirement: {
          defaultValue: true,
          conditions: { variable: "gated", operator: "exists" },
        },
        featureSource: { compose: { policy: { feature: "delivery", variable: "policy" } } },
        featureRequirement: {
          defaultValue: true,
          conditions: { feature: "delivery", ...requirement },
        },
        overrideOnly: {
          defaultValue: true,
          overrides: [
            {
              conditions: "*",
              key: "outer",
              overrides: [{ key: "inner", conditions: { and: [requirement] }, value: false }],
            },
          ],
        },
      };
      if (environments)
        variables.overrideOnly.overrides = { production: variables.overrideOnly.overrides };
      const features: Record<string, any> = {
        delivery: {
          conditions: requirement,
          variablesSchema: { policy: { defaultValue: true } },
        },
        indirect: { conditions: [{ feature: "delivery" }] },
        viaComposition: { conditions: { variable: "config", operator: "exists" } },
        overrideFeature: {
          variablesSchema: { label: { defaultValue: "hello" } },
          rules: [
            {
              key: "targeted",
              conditions: "*",
              percentage: 100,
              variableOverrides: { label: [{ conditions: requirement, value: "hi" }] },
            },
          ],
        },
      };
      if (environments)
        features.overrideFeature.rules = { production: features.overrideFeature.rules };
      const datasource: any = {
        listVariables: async () => Object.keys(variables),
        readVariable: async (key: string) => variables[key],
        listFeatures: async () => Object.keys(features),
        readFeature: async (key: string) => features[key],
        listSegments: async () => [],
        getRequiredFeaturesChainForVariable: async () => new Set(),
      };
      const deps = { datasource, projectConfig: { environments } } as any;
      const usage = await findAllUsageInVariables(deps);
      expect(usage.screen.variables).toEqual(new Set(["config", "policy"]));
      const log = jest.spyOn(console, "log").mockImplementation();
      try {
        await findUsageInProject(deps, { variable: "policy" });
        const lines = log.mock.calls.map((args) => args.join(" ").replace(/\x1b\[[0-9;]*m/g, ""));
        expect(lines).toContain("  Direct references only.");
        expect(lines).toContain("  Aliased by: alias");
        expect(lines).toContain("  Composed by: both, config");
        expect(lines).toContain("  Conditions in global variables: both, gated, overrideOnly");
        expect(lines).toContain("  Conditions in features: delivery, overrideFeature");
        expect(lines).toContain(
          `    • feature overrideFeature, rule targeted (${environments ? "production" : "default"}), variable label`,
        );
        expect(lines).toContain("    • global variable overrideOnly, override inner");
        expect(lines.join("\n")).not.toMatch(
          /aliasChain|screen|indirect|featureSource|featureRequirement|viaComposition/,
        );
        log.mockClear();
        await findUsageInProject(deps, { variable: "screen" });
        const output = log.mock.calls.flat().join("\n");
        expect(output).toContain("No project references found.");
        expect(output).not.toContain("Composed by");
        expect(output).not.toContain("Required by");
      } finally {
        log.mockRestore();
      }
    },
  );

  test("composition example reports policy's direct composers but not screen", async () => {
    const rootDirectoryPath = path.resolve(__dirname, "../../../../examples/example-composition");
    const projectConfig = getProjectConfig(rootDirectoryPath);
    const datasource = new Datasource(projectConfig, rootDirectoryPath);
    const log = jest.spyOn(console, "log").mockImplementation();
    try {
      await findUsageInProject({ datasource, projectConfig, rootDirectoryPath } as any, {
        variable: "policy",
      });
      const lines = log.mock.calls.map((args) => args.join(" ").replace(/\x1b\[[0-9;]*m/g, ""));
      expect(lines.find((line) => line.startsWith("  Aliased by:"))).toMatch(/\bpolicyAlias\b/);
      expect(lines).toContain("  Composed by: config, regionalScreen");
      expect(lines).toContain("  Direct references only.");
      expect(lines.join("\n")).not.toContain("Conditions in global variables");
      expect(lines.join("\n")).not.toMatch(/\bscreen\b/);
    } finally {
      log.mockRestore();
    }
  });

  test("reports reverse requirements, override sites and test checks", async () => {
    const variables: Record<string, any> = {
      source: { defaultValue: true },
      consumer: {
        defaultValue: true,
        conditions: { variable: "source", operator: "equals", value: true },
        overrides: [
          {
            key: "nested",
            conditions: { variable: "source", operator: "equals", value: true },
            value: false,
          },
        ],
      },
    };
    const features: Record<string, any> = {
      checkout: {
        conditions: { variable: "source", operator: "equals", value: true },
        rules: [
          {
            key: "targeted",
            variableOverrides: {
              message: [
                {
                  conditions: { variable: "source", operator: "equals", value: true },
                  value: "yes",
                },
              ],
            },
          },
        ],
      },
      promotion: {
        variations: [
          {
            value: "on",
            variableOverrides: {
              message: [
                {
                  conditions: { variable: "source", operator: "equals", value: true },
                  value: "yes",
                },
              ],
            },
          },
        ],
      },
    };
    const datasource: any = {
      listFeatures: async () => Object.keys(features),
      readFeature: async (key: string) => features[key],
      listVariables: async () => Object.keys(variables),
      readVariable: async (key: string) => variables[key],
      listSegments: async () => [],
      getRequiredFeaturesChainForVariable: async () => new Set(),
      listTests: async () => [],
      listScenarios: async () => ["relationship", "relationship, follow-up"],
      readScenario: async () => ({
        checks: [{ variable: "consumer", operator: "equals", compareTo: { variable: "source" } }],
      }),
    };
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await findUsageInProject({ datasource, projectConfig: { environments: false } } as any, {
        variable: "source",
      });
      const lines = log.mock.calls.map((args) => args.join(" ").replace(/\x1b\[[0-9;]*m/g, ""));
      const output = lines.join("\n");
      expect(output).toContain("Conditions in features");
      expect(output).toContain("checkout");
      expect(output).toContain("promotion");
      expect(output).toContain("Conditions in global variables");
      expect(output).toContain("consumer");
      expect(lines).toContain("  Conditions in features: checkout, promotion");
      expect(lines).toContain("  Conditions in global variables: consumer");
      const overrideHeading = lines.indexOf("  Override conditions:");
      expect(lines.slice(overrideHeading, overrideHeading + 4)).toEqual([
        "  Override conditions:",
        "    • feature checkout, rule targeted (default), variable message",
        "    • feature promotion, variation on, variable message",
        "    • global variable consumer, override nested",
      ]);
      const checksHeading = lines.indexOf("  Test checks:");
      expect(lines.slice(checksHeading, checksHeading + 3)).toEqual([
        "  Test checks:",
        "    • relationship",
        "    • relationship, follow-up",
      ]);
    } finally {
      log.mockRestore();
    }
  });

  test("Example 1 runtimePolicy has reverse project dependencies", async () => {
    const rootDirectoryPath = path.resolve(__dirname, "../../../../examples/example-1");
    const projectConfig = getProjectConfig(rootDirectoryPath);
    const datasource = new Datasource(projectConfig, rootDirectoryPath);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await findUsageInProject({ datasource, projectConfig, rootDirectoryPath } as any, {
        variable: "runtimePolicy",
      });
      const output = log.mock.calls.map((args) => args.join(" ")).join("\n");
      expect(output).toContain("Conditions in features");
      expect(output).toContain("variableRequirementsExample");
      expect(output).toContain("variablePolicySource");
      expect(output).toContain("Conditions in global variables");
      expect(output).toContain("runtimeMessage");
      expect(output).toContain("mutationConformance");
    } finally {
      log.mockRestore();
    }
  });
  test("finds nested and negated required variable references structurally", async () => {
    const variables: Record<string, any> = {
      source: {
        defaultValue: "source",
        conditions: {
          not: [
            {
              or: [
                { variable: "nested", operator: "equals", value: true },
                {
                  feature: "policy.feature",
                  variable: "config.policy",
                  operator: "equals",
                  value: "priority",
                },
              ],
            },
          ],
        },
      },
      nested: { defaultValue: true },
      overrideDependency: { defaultValue: true },
    };
    const features: Record<string, any> = {
      "policy.feature": {
        variablesSchema: { "config.policy": { defaultValue: "standard" } },
        rules: [],
      },
    };
    variables.source.overrides = [
      {
        key: "nested",
        conditions: {
          and: [{ variable: "overrideDependency", operator: "equals", value: true }],
        },
        value: "matched",
      },
    ];
    const datasource: any = {
      listVariables: async () => Object.keys(variables),
      readVariable: async (key: string) => variables[key],
      listFeatures: async () => Object.keys(features),
      readFeature: async (key: string) => features[key],
      listSchemas: async () => [],
      getRequiredFeaturesChainForVariable: async () => new Set<string>(),
    };

    const usage = await findAllUsageInVariables({ datasource } as any);
    expect(usage.source.variables).toEqual(new Set(["nested", "overrideDependency"]));
    expect(usage.source.features).toEqual(new Set(["policy.feature"]));
  });

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
        listSegments: async () => [],
        segmentExists: async () => false,
        readVariable: async () => ({
          schema: "outer",
          conditions: [
            { feature: "checkout" },
            { feature: "account" },
            { feature: "authenticated" },
          ],
          defaultValue: { schema: "not-a-reference" },
          overrides: [
            {
              key: "targeted",
              conditions: [
                { and: ["mobile", { not: ["internal"] }] },
                { attribute: "country", operator: "equals", value: "nl" },
              ],

              value: { schema: "also-not-a-reference" },
              overrides: [
                {
                  key: "nested",
                  conditions: [
                    "premium",
                    { attribute: "city", operator: "equals", value: "amsterdam" },
                    { feature: "nested-feature" },
                  ],

                  value: { schema: "still-not-a-reference" },
                },
              ],
            },
          ],
        }),
        readSchema: async (key: string) =>
          key === "outer"
            ? { type: "object", properties: { value: { schema: "inner" } } }
            : { type: "string" },
        getRequiredFeaturesChainForVariable: async () =>
          new Set(["checkout", "account", "authenticated", "nested-feature"]),
      },
    } as any);

    expect(Array.from(usage.settings.schemas).sort()).toEqual(["inner", "outer"]);
    expect(Array.from(usage.settings.features).sort()).toEqual([
      "account",
      "authenticated",
      "checkout",
      "nested-feature",
    ]);
    expect(Array.from(usage.settings.segments).sort()).toEqual(["internal", "mobile", "premium"]);
    expect(Array.from(usage.settings.attributes).sort()).toEqual(["city", "country"]);
  });

  test.each([
    { feature: "account" },
    { or: [{ feature: "account" }, { not: [{ feature: "account" }] }] },
  ])("finds dependencies in every feature location: %j", async function (requirement) {
    const usage = await findAllUsageInFeatures({
      projectConfig: { environments: ["staging", "production"] },
      datasource: {
        listSegments: async () => [],
        segmentExists: async () => false,
        listFeatures: async () => ["checkout"],
        readFeature: async () => ({
          bucketBy: { or: ["userId", "deviceId"] },
          conditions: [requirement],
          variations: [
            {
              value: "treatment",
              variableOverrides: {
                message: [
                  {
                    conditions: [
                      "variation-segment",
                      { attribute: "locale", operator: "equals", value: "nl" },
                      { feature: "variation-dependency" },
                    ],

                    value: "variation",
                  },
                ],
              },
            },
          ],
          force: {
            staging: [
              {
                conditions: [
                  "force-segment",
                  { attribute: "staff", operator: "equals", value: true },
                ],

                enabled: true,
              },
            ],
          },
          rules: {
            production: [
              {
                key: "targeted",
                conditions: "rule-segment",
                percentage: 100,
                variableOverrides: {
                  message: [
                    {
                      conditions: [
                        "override-segment",
                        {
                          attribute: "country",
                          operator: "equals",
                          value: "de",
                        },
                        { feature: "rule-dependency" },
                      ],

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
          conditions: [{ feature: "legacy-dependency" }],
          force: [
            {
              conditions: [
                "force-segment",
                { attribute: "staff", operator: "equals", value: true },
              ],

              enabled: true,
            },
          ],
          rules: [
            {
              key: "targeted",
              conditions: "rule-segment",
              percentage: 100,
              variableOverrides: {
                message: [
                  {
                    conditions: [
                      "override-segment",
                      { attribute: "country", operator: "equals", value: "nl" },
                    ],

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
        readSegment: async () => ({ conditions: "*" }),
        segmentExists: async () => true,
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
