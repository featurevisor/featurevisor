import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { DatafileContent, Target } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";

import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { buildTargetDatafile } from "./buildProject";
import { resolveBuildEnvironments } from "./environments";
import { SchemaV2ConversionError, convertDatafileToSchemaV2, toSchemaV2 } from "./schemaV2";

// The latest v3 JavaScript SDK, the one schema "2" targets are converted for.
const { createFeaturevisor: createFeaturevisorV3 } = require("featurevisor-sdk-3");

const examples = path.resolve(__dirname, "../../../../examples");

function datafile(content: Partial<DatafileContent>): DatafileContent {
  return { schemaVersion: "4", revision: "1", segments: {}, features: {}, ...content };
}

const everyone = { key: "everyone", conditions: "*", percentage: 100000 } as const;

describe("schema 2 conversion", () => {
  it("keeps segment rules as they are and synthesizes segments for attribute parts", () => {
    const { datafile: result, issues } = convertDatafileToSchemaV2(
      datafile({
        segments: {
          netherlands: { conditions: [{ attribute: "country", operator: "equals", value: "nl" }] },
        },
        features: {
          checkout: {
            bucketBy: "userId",
            traffic: [
              { key: "dutch", conditions: "netherlands", percentage: 100000 },
              {
                key: "mixed",
                conditions: {
                  or: [
                    "netherlands",
                    { attribute: "plan", operator: "equals", value: "paid" },
                    { not: [{ attribute: "country", operator: "equals", value: "de" }] },
                  ],
                },
                percentage: 50000,
              },
              {
                key: "attributes",
                conditions: [{ attribute: "plan", operator: "equals", value: "paid" }],
                percentage: 10000,
              },
              everyone,
            ],
          },
        },
      }),
    );

    expect(issues).toEqual([]);
    expect(result.schemaVersion).toBe("2");
    const traffic = result.features.checkout.traffic as any[];
    expect(traffic.map((rule) => "conditions" in rule)).toEqual([false, false, false, false]);
    expect(traffic[0].segments).toBe("netherlands");
    expect(traffic[3].segments).toBe("*");
    expect(traffic[1].segments.or[0]).toBe("netherlands");
    const [paid, notGerman] = traffic[1].segments.or.slice(1);
    expect(result.segments[paid].conditions).toEqual({
      attribute: "plan",
      operator: "equals",
      value: "paid",
    });
    expect(result.segments[notGerman].conditions).toEqual({
      not: [{ attribute: "country", operator: "equals", value: "de" }],
    });
    // The same conditions share one synthesized segment, with a key no real segment can have.
    expect(traffic[2].segments).toBe(
      Object.keys(result.segments).find(
        (key) =>
          JSON.stringify(result.segments[key].conditions) ===
          JSON.stringify([{ attribute: "plan", operator: "equals", value: "paid" }]),
      ),
    );
    expect(Object.keys(result.segments).filter((key) => key.startsWith("~"))).toHaveLength(3);
  });

  it("writes flat requirements for root gates, overrides and variables", () => {
    const { datafile: result, issues } = convertDatafileToSchemaV2(
      datafile({
        features: {
          liveChat: { bucketBy: "userId", traffic: [everyone] },
          chatFileUpload: {
            bucketBy: "userId",
            conditions: [
              { feature: "liveChat" },
              { feature: "pricing", enabled: false },
              { and: [{ feature: "checkout", variation: "treatment" }] },
            ],
            variablesSchema: {
              limit: { type: "number" as any, defaultValue: 5 },
            },
            traffic: [
              {
                ...everyone,
                variableOverrides: {
                  limit: [
                    { key: "required", conditions: [{ feature: "liveChat" }], value: 1 },
                    {
                      key: "both",
                      conditions: [
                        { feature: "liveChat" },
                        { attribute: "plan", operator: "equals", value: "paid" },
                      ],
                      value: 2,
                    },
                    { key: "always", value: 3 } as any,
                  ],
                },
              },
            ],
          },
        },
        variables: {
          supportEmail: {
            type: "string",
            defaultValue: "a",
            conditions: { feature: "liveChat" },
            overrides: [
              { key: "dutch", conditions: "netherlands", value: "b" },
              { key: "always", value: "c" } as any,
            ],
          } as any,
          rate: { type: "number" as any, defaultValue: 1 },
        },
        segments: {
          netherlands: { conditions: [{ attribute: "country", operator: "equals", value: "nl" }] },
        },
      }),
    );

    expect(issues).toEqual([]);
    const feature = result.features.chatFileUpload as any;
    expect(feature.conditions).toBeUndefined();
    expect(feature.requiredFeatures).toEqual([
      "liveChat",
      { feature: "pricing", enabled: false },
      { feature: "checkout", variation: "treatment" },
    ]);
    expect(feature.variablesSchema.limit.type).toBe("double");
    const [required, both, always] = feature.traffic[0].variableOverrides.limit;
    expect(required).toEqual({ key: "required", value: 1, requiredFeatures: ["liveChat"] });
    expect(both).toEqual({
      key: "both",
      value: 2,
      requiredFeatures: ["liveChat"],
      conditions: { attribute: "plan", operator: "equals", value: "paid" },
    });
    // A feature variable override with no selector must still match in v3.
    expect(always).toEqual({ key: "always", value: 3, conditions: "*" });

    const variable = result.variables!.supportEmail as any;
    expect(variable.requiredFeatures).toEqual(["liveChat"]);
    expect(variable.overrides).toEqual([
      { key: "dutch", value: "b", segments: "netherlands" },
      { key: "always", value: "c" },
    ]);
    expect(result.variables!.rate.type).toBe("double");
  });

  it("writes attribute force entries as conditions and segment ones as segments", () => {
    const { datafile: result, issues } = convertDatafileToSchemaV2(
      datafile({
        segments: {
          qa: { conditions: [{ attribute: "userId", operator: "equals", value: "qa" }] },
        },
        features: {
          pricing: {
            bucketBy: "userId",
            traffic: [everyone],
            force: [
              {
                conditions: [{ attribute: "userId", operator: "equals", value: "u" }],
                enabled: true,
              },
              {
                conditions: ["qa", { attribute: "country", operator: "equals", value: "nl" }],
                enabled: false,
              },
            ] as any,
          },
        },
      }),
    );
    expect(issues).toEqual([]);
    const force = result.features.pricing.force as any[];
    expect(force[0]).toEqual({
      enabled: true,
      conditions: [{ attribute: "userId", operator: "equals", value: "u" }],
    });
    expect(force[1].conditions).toBeUndefined();
    expect(force[1].segments[0]).toBe("qa");
    expect(force[1].segments[1].startsWith("~")).toBe(true);
  });

  it("inlines segments that refer to segments and keeps empty groups false", () => {
    const { datafile: result } = convertDatafileToSchemaV2(
      datafile({
        segments: {
          nl: { conditions: [{ attribute: "country", operator: "equals", value: "nl" }] },
          paid: { conditions: { attribute: "plan", operator: "equals", value: "paid" } },
          dutchPaid: { conditions: { and: ["nl", "paid"] } },
          nobody: { conditions: { and: [] } as any },
          notNobody: { conditions: { not: [] } as any },
        },
      }),
    );
    expect(result.segments.dutchPaid.conditions).toEqual({
      and: [
        [{ attribute: "country", operator: "equals", value: "nl" }],
        { attribute: "plan", operator: "equals", value: "paid" },
      ],
    });
    // v4 treats empty groups as false, even under not. Schema 2 reads an empty or as false.
    expect(result.segments.nobody.conditions).toEqual({ or: [] });
    expect(result.segments.notNobody.conditions).toEqual({ or: [] });
  });

  it("stringifies like the v3 builder when the project does", () => {
    const { datafile: result } = convertDatafileToSchemaV2(
      datafile({
        segments: {
          nl: { conditions: '[{"attribute":"country","operator":"equals","value":"nl"}]' },
        },
        features: {
          checkout: {
            bucketBy: "userId",
            traffic: [
              { key: "a", conditions: '["nl"]', percentage: 100000 },
              { key: "b", conditions: "nl", percentage: 100000 },
            ],
          },
        },
      }),
      { stringify: true },
    );
    expect(result.segments.nl.conditions).toBe(
      '[{"attribute":"country","operator":"equals","value":"nl"}]',
    );
    expect(result.features.checkout.traffic.map((rule: any) => rule.segments)).toEqual([
      '["nl"]',
      "nl",
    ]);
  });

  it("reports everything schema 2 cannot express, without dropping it", () => {
    const { issues } = convertDatafileToSchemaV2(
      datafile({
        segments: {
          writers: {
            conditions: { attribute: "permissions", operator: "includesAny", value: ["write"] },
          },
          chatters: { conditions: [{ feature: "liveChat" }] },
        },
        features: {
          gated: {
            bucketBy: "userId",
            conditions: [
              { attribute: "country", operator: "equals", value: "nl" },
              { or: [{ feature: "a" }, { feature: "b" }] },
            ],
            traffic: [
              {
                key: "variable",
                conditions: { variable: "maintenanceMode", operator: "equals", value: false },
                percentage: 100000,
              },
              { key: "feature", conditions: [{ feature: "liveChat" }], percentage: 100000 },
            ],
            force: [{ conditions: [{ feature: "liveChat" }], enabled: true }] as any,
          },
        },
        variables: {
          composed: { compose: "other" } as any,
          accumulating: { type: "string", defaultValue: "a", overrideProgram: [] } as any,
          empty: {
            type: "string",
            defaultValue: "a",
            overrides: [
              { key: "x", conditions: { attribute: "tags", operator: "isNull" }, value: "b" },
            ],
          } as any,
        },
      }),
    );
    const found = issues.map((issue) => [
      issue.entityType,
      issue.key,
      issue.location,
      issue.reason,
    ]);
    expect(found).toEqual(
      expect.arrayContaining([
        [
          "feature",
          "gated",
          "the root gate",
          expect.stringContaining('requires feature "a" inside "or" or "not"'),
        ],
        [
          "feature",
          "gated",
          "the root gate",
          expect.stringContaining('compares attribute "country"'),
        ],
        [
          "feature",
          "gated",
          'rule "variable"',
          expect.stringContaining('reads variable "maintenanceMode"'),
        ],
        [
          "feature",
          "gated",
          'rule "feature"',
          expect.stringContaining('requires feature "liveChat"'),
        ],
        [
          "feature",
          "gated",
          "force entry 1",
          expect.stringContaining('requires feature "liveChat"'),
        ],
        ["segment", "writers", "the segment", expect.stringContaining('operator "includesAny"')],
        [
          "segment",
          "chatters",
          "the segment",
          expect.stringContaining('requires feature "liveChat"'),
        ],
        ["variable", "composed", "the variable", expect.stringContaining("composition")],
        ["variable", "accumulating", "the variable", expect.stringContaining("runtime overrides")],
        ["variable", "empty", 'override "x"', expect.stringContaining('operator "isNull"')],
      ]),
    );
    // Each feature under "or" is named, so both "a" and "b" are reported.
    expect(issues).toHaveLength(11);
  });

  it("throws every issue at once, naming the target and environment", () => {
    const source = datafile({
      features: {
        a: {
          bucketBy: "userId",
          traffic: [{ key: "r", conditions: [{ feature: "b" }], percentage: 1 }],
        },
      },
      variables: { c: { compose: "d" } as any },
    });
    let error: unknown;
    try {
      toSchemaV2(source, { targetKey: "ios-legacy", environment: "production" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SchemaV2ConversionError);
    const message = (error as Error).message;
    expect(message).toContain('Target "ios-legacy" in environment "production"');
    expect(message).toContain('feature "a", rule "r"');
    expect(message).toContain('variable "c", the variable');
    expect((error as SchemaV2ConversionError).issues).toHaveLength(2);
  });
});

/**
 * Evaluate every feature and variable for many contexts, comparing the v4
 * SDK on the v4 datafile with @featurevisor/sdk 3.8 on the converted one,
 * and with the v4 SDK reading the converted one too.
 */
function compareEvaluations(v4: DatafileContent, v2: DatafileContent, contexts: any[]) {
  const quiet = { logLevel: "fatal" as const };
  const reference = createFeaturevisor({ datafile: v4, ...quiet });
  const legacy = createFeaturevisorV3({ datafile: v2, ...quiet });
  const reread = createFeaturevisor({ datafile: v2, ...quiet });
  const read = (sdk: any, context: any) => {
    const result: Record<string, unknown> = {};
    for (const featureKey of Object.keys(v4.features)) {
      result[`${featureKey}:enabled`] = sdk.isEnabled(featureKey, context);
      result[`${featureKey}:variation`] = sdk.getVariation(featureKey, context);
      for (const variableKey of Object.keys(v4.features[featureKey].variablesSchema || {})) {
        result[`${featureKey}.${variableKey}`] = sdk.getVariable(featureKey, variableKey, context);
      }
    }
    for (const variableKey of Object.keys(v4.variables || {})) {
      result[`variable:${variableKey}`] = sdk.getVariable(variableKey, context);
    }
    return result;
  };
  let compared = 0;
  for (const context of contexts) {
    const expected = read(reference, context);
    expect({ context, values: read(legacy, context) }).toEqual({ context, values: expected });
    expect({ context, values: read(reread, context) }).toEqual({ context, values: expected });
    compared += Object.keys(expected).length;
  }
  return compared;
}

/** Contexts from every literal a project's conditions compare with, plus missing values. */
function contextsFor(datafileContent: DatafileContent, count: number, seed = 7): any[] {
  const values = new Map<string, Set<unknown>>();
  const visit = (node: any) => {
    if (typeof node === "string") {
      if (/^[\[{]/.test(node)) visit(JSON.parse(node));
      return;
    }
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (typeof node.attribute === "string") {
      const set = values.get(node.attribute) || new Set();
      for (const value of Array.isArray(node.value) ? node.value : [node.value]) set.add(value);
      values.set(node.attribute, set);
    }
    Object.values(node).forEach(visit);
  };
  visit(datafileContent);
  values.delete("userId");
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const contexts = [];
  for (let index = 0; index < count; index++) {
    const context: Record<string, unknown> = { userId: `user-${index % 97}` };
    for (const [attribute, options] of values) {
      const list = [...options, undefined];
      const value = list[Math.floor(random() * list.length)];
      if (value !== undefined) context[attribute] = value;
    }
    contexts.push(context);
  }
  return contexts;
}

describe("schema 2 datafiles evaluate the same in @featurevisor/sdk 3.8", () => {
  const roots: string[] = [];
  afterAll(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

  async function project(example: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `featurevisor-${example}-`));
    roots.push(root);
    fs.cpSync(path.join(examples, example), root, {
      recursive: true,
      filter: (source) =>
        !/node_modules|datafiles|\.featurevisor/.test(path.relative(examples, source)),
    });
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    return { projectConfig, datasource };
  }

  async function pairs(example: string, select: (target: Target & { key: string }) => boolean) {
    const { projectConfig, datasource } = await project(example);
    const result: Array<{ name: string; v4: DatafileContent; v2?: DatafileContent }> = [];
    for (const environment of resolveBuildEnvironments(projectConfig, undefined)) {
      const existingState = await datasource.readState(environment);
      for (const key of await datasource.listTargets()) {
        const target = { ...(await datasource.readTarget(key)), key };
        if (!select(target)) continue;
        const build = (schemaVersion?: "2") =>
          buildTargetDatafile({
            projectConfig,
            datasource,
            target: { ...target, schemaVersion },
            environment,
            existingState,
            revision: "1",
          });
        let v2: DatafileContent | undefined;
        try {
          v2 = await build("2");
        } catch (error) {
          if (!(error instanceof SchemaV2ConversionError)) throw error;
        }
        result.push({ name: `${key} ${environment || ""}`.trim(), v4: await build(), v2 });
      }
    }
    return result;
  }

  it("matches for the legacy targets of example-schema-v2", async () => {
    const built = await pairs("example-schema-v2", (target) => target.schemaVersion === "2");
    expect(built.map((entry) => entry.name).sort()).toEqual([
      "android-legacy production",
      "android-legacy staging",
      "ios-legacy production",
      "ios-legacy staging",
    ]);
    let compared = 0;
    for (const { v4, v2 } of built) {
      expect(v2!.schemaVersion).toBe("2");
      compared += compareEvaluations(v4, v2!, [
        ...contextsFor(v4, 600),
        { userId: "qa-user-1", country: "nl", plan: "enterprise" },
        {},
      ]);
    }
    expect(compared).toBeGreaterThan(10000);
  });

  it("matches for every target of example-targets, a project in the v3 shape", async () => {
    const built = await pairs("example-targets", () => true);
    expect(built.length).toBeGreaterThan(10);
    let compared = 0;
    expect(built.every((entry) => entry.v2)).toBe(true);
    for (const { v4, v2 } of built) compared += compareEvaluations(v4, v2!, contextsFor(v4, 150));
    expect(compared).toBeGreaterThan(10000);
  });

  it("matches for the example-1 targets that schema 2 can express", async () => {
    const built = await pairs("example-1", () => true);
    const convertible = built.filter((entry) => entry.v2);
    // The build refuses exactly the targets whose datafiles have issues.
    for (const entry of built)
      expect(!!entry.v2).toBe(convertDatafileToSchemaV2(entry.v4).issues.length === 0);
    expect(convertible.length).toBeGreaterThan(0);
    expect(convertible.length).toBeLessThan(built.length);
    for (const { v4, v2 } of convertible) compareEvaluations(v4, v2!, contextsFor(v4, 80));
  });
});
