import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import childProcess from "child_process";
import http from "http";
import { EventEmitter } from "events";

import {
  exportCatalog,
  isLoopbackHost,
  resolveCatalogRequestPath,
  startCatalogDevMode,
  createCatalogDevSession,
  createCatalogPlugin,
  serveCatalog,
  getChangedCatalogSets,
  type CatalogRuntime,
} from ".";
import { getCatalogInputWatchPaths, watchCatalogInputs } from "./watch";
import { decodeCatalogIndex } from "../indexCodec";
import { getEntityDependencies, getNearestOwners } from "../dependencyIndex";
import { searchCatalog } from "../searchModel";
import { resolveCatalogStorage, readCatalogStorageEntry } from "../storage";
import type { CatalogManifest } from "../types";

jest.mock("./watch", () => ({
  ...jest.requireActual("./watch"),
  watchCatalogInputs: jest.fn(),
}));

function createProjectConfig(root: string, sets = false) {
  return {
    sets,
    tags: ["all", "web", "mobile", "premium"],
    environments: ["staging", "production"],
    namespaceCharacter: ".",
    catalogDirectoryPath: path.join(root, "catalog"),
    featuresDirectoryPath: path.join(root, "features"),
    segmentsDirectoryPath: path.join(root, "segments"),
    attributesDirectoryPath: path.join(root, "attributes"),
    targetsDirectoryPath: path.join(root, "targets"),
    schemasDirectoryPath: path.join(root, "schemas"),
    variablesDirectoryPath: path.join(root, "variables"),
    testsDirectoryPath: path.join(root, "tests"),
    setsDirectoryPath: path.join(root, "sets"),
  };
}

function createDatasource(set = "") {
  const featureKey = set ? `checkout.${set}` : "checkout";
  const segmentKey = "premiumUsers";

  return {
    getExtension: () => "yml",
    listSets: async () => ["dev", "production"],
    forSet: (nextSet: string) => createDatasource(nextSet),
    listHistoryEntries: async () => [
      {
        commit: `${set || "root"}123456789`,
        author: "Test",
        timestamp: "2026-01-01T00:00:00.000Z",
        entities: [{ type: "feature", key: featureKey }],
      },
    ],
    listFeatures: async () => [featureKey],
    readFeature: async () => ({
      key: featureKey,
      description: "Checkout feature",
      tags: ["web", "premium"],
      bucketBy: "userId",
      rules: {
        staging: [
          {
            key: "rule",
            conditions: [segmentKey, { attribute: "country", operator: "equals", value: "nl" }],

            percentage: 100,
            enabled: true,
          },
        ],
        production: [],
      },
    }),
    listSegments: async () => [segmentKey],
    readSegment: async () => ({
      key: segmentKey,
      description: "Premium users",
      conditions: [{ attribute: "plan", operator: "equals", value: "premium" }],
    }),
    listAttributes: async () => ["plan", "country"],
    readAttribute: async (key: string) => ({
      key,
      type: "string",
      description: key === "plan" ? "Plan" : "Country",
    }),
    listTargets: async () => ["premiumWeb", "mobile"],
    readTarget: async (key: string) =>
      key === "premiumWeb"
        ? {
            key,
            description: "Premium web",
            tags: { and: ["web", "premium"] },
            includeFeatures: ["checkout*"],
            excludeFeatures: ["checkout.internal*"],
          }
        : { key, description: "Mobile", tag: "mobile", includeFeatures: "*" },
    listSchemas: async () => [],
    readSchema: async () => undefined,
    listVariables: async () => ["supportEmail"],
    readVariable: async () => ({
      key: "supportEmail",
      description: "Support email",
      tags: ["web", "premium"],
      type: "string",
      defaultValue: "support@example.com",
      overrides: {
        staging: [{ key: "premium", conditions: segmentKey, value: "premium@example.com" }],
        production: [],
      },
    }),
    listScenarios: async () => [],
    readScenario: async () => undefined,
    listTests: async () => [
      "checkout-primary",
      "checkout-matrix",
      "premium-users",
      "support-email",
    ],
    readTest: async (key: string) => {
      if (key === "support-email") {
        return {
          key,
          variable: "supportEmail",
          assertions: [
            {
              environment: "staging",
              context: { plan: "premium" },
              expectedValue: "premium@example.com",
            },
          ],
        };
      }
      if (key === "premium-users") {
        return {
          key,
          segment: segmentKey,
          assertions: [
            {
              context: { plan: "premium" },
              expectedToMatch: true,
            },
          ],
        };
      }

      if (key === "checkout-matrix") {
        return {
          key,
          feature: featureKey,
          assertions: [
            {
              matrix: { country: ["nl", "de"], at: [10, 90] },
              description: "${{ country }} at ${{ at }}%",
              environment: "production",
              at: "${{ at }}",
              context: { country: "${{ country }}" },
              expectedToBeEnabled: true,
            },
          ],
        };
      }

      return {
        key,
        feature: featureKey,
        assertions: [
          {
            description: "Enabled in staging",
            environment: "staging",
            context: { country: "nl" },
            expectedToBeEnabled: true,
          },
        ],
      };
    },
  };
}

function createRuntime(
  targetMemberships?: Record<
    string,
    { features: string[]; variables: string[]; segments?: string[] }
  >,
): CatalogRuntime {
  return {
    getCatalogTargetMemberships: async (_projectConfig, datasource) => {
      if (targetMemberships) return targetMemberships;

      const featureKeys: string[] = await datasource.listFeatures();
      const variableKeys: string[] = await datasource.listVariables();
      return {
        premiumWeb: {
          features: featureKeys.filter((key) => key.startsWith("checkout")),
          variables: variableKeys.includes("supportEmail") ? ["supportEmail"] : [],
        },
        mobile: { features: [], variables: [] },
      };
    },
    getProjectSetExecutions: async (projectConfig, datasource) => {
      if (!projectConfig.sets) {
        return [{ set: "", projectConfig, datasource }];
      }

      return (await datasource.listSets()).map((set: string) => ({
        set,
        projectConfig: {
          ...projectConfig,
          featuresDirectoryPath: path.join(projectConfig.setsDirectoryPath, set, "features"),
          segmentsDirectoryPath: path.join(projectConfig.setsDirectoryPath, set, "segments"),
          attributesDirectoryPath: path.join(projectConfig.setsDirectoryPath, set, "attributes"),
          targetsDirectoryPath: path.join(projectConfig.setsDirectoryPath, set, "targets"),
          schemasDirectoryPath: path.join(projectConfig.setsDirectoryPath, set, "schemas"),
          variablesDirectoryPath: path.join(projectConfig.setsDirectoryPath, set, "variables"),
          testsDirectoryPath: path.join(projectConfig.setsDirectoryPath, set, "tests"),
        },
        datasource: datasource.forSet(set),
      }));
    },
  };
}

function git(root: string, args: string[]) {
  childProcess.execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

describe("catalog compact integration", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-compact-"));
  });
  afterEach(() => {
    jest.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
  function load(manifest: CatalogManifest, logical: string) {
    const resolution = resolveCatalogStorage(manifest.storage, logical)!;
    expect(resolution).toBeDefined();
    return readCatalogStorageEntry<any>(
      read(path.join(root, "catalog", resolution.blockURL)),
      resolution,
    );
  }

  it("indexes every condition leaf through segments, root gates and all selector locations", async () => {
    const datasource = createDatasource();
    const mixed = {
      and: [
        "base",
        { attribute: "country.code", operator: "equals", value: "nl" },
        { feature: "dependency", enabled: false },
        { variable: "policy", path: ["limit"], operator: "greaterThan", value: 3 },
        {
          not: [
            { feature: "dependency", variable: "message", operator: "equals", value: "blocked" },
          ],
        },
      ],
    };
    datasource.listFeatures = async () => ["checkout", "dependency"];
    datasource.readFeature = (async (key: string) =>
      key === "checkout"
        ? {
            key,
            conditions: "eligible",
            rules: [
              {
                key: "rollout",
                conditions: mixed,
                percentage: 100,
                variableOverrides: { message: [{ conditions: mixed, value: "Ready" }] },
              },
            ],
            force: [{ conditions: mixed, enabled: true }],
            variations: [
              {
                value: "on",
                weight: 100,
                variableOverrides: { message: [{ conditions: mixed, value: "Ready" }] },
              },
            ],
          }
        : { key, rules: [{ key: "all", conditions: "*", percentage: 100 }] }) as any;
    datasource.listSegments = async () => ["base", "eligible", "outer", "unused"];
    datasource.readSegment = (async (key: string) => ({
      key,
      conditions: key === "eligible" ? mixed : key === "outer" ? "eligible" : "*",
    })) as any;
    datasource.listVariables = async () => ["policy", "config"];
    datasource.readVariable = (async (key: string) =>
      key === "policy"
        ? {
            key,
            type: "object",
            defaultValue: { limit: 5 },
          }
        : {
            key,
            compose: { policy: { variable: "policy" } },
            conditions: mixed,
            disabledValue: { policy: null },
            overrides: [
              {
                key: "parent",
                conditions: "eligible",
                continue: true,
                overrides: [{ key: "child", conditions: mixed, value: { policy: null } }],
              },
            ],
          }) as any;
    const { manifest } = await exportCatalog(
      createRuntime(),
      root,
      createProjectConfig(root),
      datasource,
      { compactStorage: true, copyAssets: false },
    );
    const detail = (type: string, key: string) =>
      load(manifest, `data/root/entities/${type}/${key}.json`);
    const index = decodeCatalogIndex(load(manifest, manifest.paths.root!));
    expect(detail("segment", "base").usedBy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "segment",
          key: "eligible",
          locations: ["conditions (inside AND)"],
        }),
      ]),
    );
    expect(detail("segment", "eligible").usedBy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "segment", key: "outer" }),
        expect.objectContaining({
          type: "feature",
          key: "checkout",
          locations: expect.arrayContaining(["conditions"]),
        }),
        expect.objectContaining({ type: "variable", key: "config" }),
      ]),
    );
    expect(detail("feature", "dependency").usedBy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "segment", key: "eligible" }),
        expect.objectContaining({
          type: "feature",
          key: "checkout",
          locations: expect.arrayContaining([
            "rules › rollout (inside AND)",
            "force › #1 (inside AND)",
            "rules › rollout › variable overrides › variable message › #1 (inside AND)",
            "variation on › variable overrides › variable message › #1 (inside AND)",
          ]),
        }),
      ]),
    );
    expect(detail("variable", "policy").usedBy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "segment", key: "eligible" }),
        expect.objectContaining({
          type: "variable",
          key: "config",
          locations: expect.arrayContaining([
            "conditions (inside AND)",
            "overrides › parent › child (inside AND)",
          ]),
        }),
      ]),
    );
    expect(detail("segment", "eligible").relationships).toMatchObject({
      segments: ["base"],
      referencedFeatures: ["dependency"],
      referencedVariables: ["policy"],
      attributes: ["country"],
    });
    expect(detail("feature", "checkout").relationships).toMatchObject({
      requiredFeatures: ["dependency"],
      requiredVariables: ["policy"],
      segments: ["base", "eligible"],
    });
    expect(
      index.entities.segment.find((entity) => entity.key === "base")?.usedByCount,
    ).toBeGreaterThan(0);
    expect(index.entities.segment.find((entity) => entity.key === "unused")?.usedByCount).toBe(0);
    expect(detail("variable", "config").entity).toMatchObject({
      conditions: mixed,
      disabledValue: { policy: null },
    });
    expect(detail("variable", "config").entity).not.toHaveProperty("defaultValue");
    for (const query of ["dependency", "policy", "base", "limit"]) {
      expect(searchCatalog(index, query)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "segment", key: "eligible" }),
          expect.objectContaining({ type: "feature", key: "checkout" }),
          expect.objectContaining({ type: "variable", key: "config" }),
        ]),
      );
    }
  });

  it.each(["boolean", "integer", "double", "string", "json", "object", "oneOf", "schema"])(
    "exports string aliases with effective %s types and exact source references",
    async (type) => {
      const datasource = createDatasource();
      const sourceKey = "checkout/source.with.dots";
      const variables = {
        [sourceKey]:
          type === "schema"
            ? { schema: "shared" }
            : type === "oneOf"
              ? { oneOf: [{ type: "string" }] }
              : { type },
        alias: {
          compose: sourceKey,
          overrides: [
            {
              key: "regional",
              conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
              value: null,
            },
          ],
        },
        chained: { compose: "alias" },
        screen: {
          compose: { nested: { variable: "chained" }, alias: { variable: sourceKey } },
        },
      };
      datasource.listVariables = async () => Object.keys(variables);
      datasource.readVariable = jest.fn(async (key: string) => variables[key]) as any;
      datasource.listSchemas = async () => ["shared", "base"];
      datasource.readSchema = (async (key: string) =>
        key === "shared" ? { schema: "base" } : { type: "object", properties: {} }) as any;
      const { manifest } = await exportCatalog(
        createRuntime(),
        root,
        createProjectConfig(root),
        datasource,
        { copyAssets: false, compactStorage: true },
      );
      const index = decodeCatalogIndex(load(manifest, manifest.paths.root!));
      for (const key of ["alias", "chained"]) {
        const expectedType = type === "schema" ? "object" : type;
        expect(index.entities.variable.find((entry) => entry.key === key)).toMatchObject({
          variableType: expectedType,
          isComposed: true,
        });
        const detail = load(manifest, `data/root/entities/variable/${key}.json`);
        expect(detail.aliasSourceType).toBe(expectedType);
        expect(detail).not.toHaveProperty("composedSourceAliases");
        expect(detail).not.toHaveProperty("accumulationPreview");
      }
      const alias = load(manifest, "data/root/entities/variable/alias.json");
      expect(alias.relationships.requiredVariables).toContain(sourceKey);
      const source = load(manifest, `data/root/entities/variable/${sourceKey}.json`);
      expect(source.relationships.requiredByVariables).toContain("alias");
      expect(source.usedBy).toContainEqual(
        expect.objectContaining({ key: "alias", locations: [`alias of ${sourceKey}`] }),
      );
      expect(alias.usedBy).toContainEqual(
        expect.objectContaining({ key: "chained", locations: ["alias of alias"] }),
      );
      expect(source.usedBy).toContainEqual(
        expect.objectContaining({ key: "screen", locations: ["compose alias"] }),
      );
      expect(
        load(manifest, "data/root/entities/variable/screen.json").composedSourceAliases,
      ).toEqual(["nested"]);
      expect(searchCatalog(index, sourceKey)).toContainEqual(
        expect.objectContaining({ key: "alias", match: { kind: "source", value: sourceKey } }),
      );
      expect(datasource.readVariable).toHaveBeenCalledTimes(4);
    },
  );

  it("exports compositions and reverse references without per member source reads", async () => {
    const datasource = createDatasource();
    const ordinary = datasource.readVariable;
    datasource.listVariables = async () => ["supportEmail", "config", "screen"];
    const readVariable = jest.fn(async (key: string) =>
      key === "screen"
        ? {
            compose: {
              view: { variable: "config" },
              contact: { variable: "supportEmail" },
              featureValue: { feature: "checkout", variable: "config" },
            },
          }
        : key === "config"
          ? {
              description: "Checkout composition",
              tags: ["web"],
              compose: {
                enabled: { feature: "checkout" },
                layout: { feature: "checkout", variation: true },
                label: { feature: "checkout", variable: "label" },
                email: { variable: "supportEmail" },
              },
            }
          : ordinary(),
    );
    datasource.readVariable = readVariable as any;
    const { manifest } = await exportCatalog(
      createRuntime(),
      root,
      createProjectConfig(root),
      datasource,
      { copyAssets: false, compactStorage: true },
    );
    const index = decodeCatalogIndex(load(manifest, manifest.paths.root!));
    const summary = index.entities.variable.find((entry) => entry.key === "config")!;
    expect(summary.variableType).toBe("object");
    expect(summary.isComposed).toBe(true);
    expect(
      index.entities.variable.find((entry) => entry.key === "supportEmail"),
    ).not.toHaveProperty("isComposed");
    expect(load(manifest, "data/root/entities/variable/screen.json").composedSourceAliases).toEqual(
      ["view"],
    );
    expect(searchCatalog(index, "email")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "variable",
          key: "config",
          match: { kind: "alias", value: "email" },
        }),
      ]),
    );
    expect(searchCatalog(index, "supportEmail")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "variable",
          key: "config",
          match: { kind: "source", value: "supportEmail" },
        }),
      ]),
    );
    const detail = load(manifest, "data/root/entities/variable/config.json");
    expect(detail.entity.compose.email).toEqual({ variable: "supportEmail" });
    expect(detail.composedSourceAliases).toEqual([]);
    expect(detail.entity).not.toHaveProperty("defaultValue");
    expect(detail.relationships.features).toContain("checkout");
    expect(detail.relationships.requiredVariables).toContain("supportEmail");
    expect(
      load(manifest, "data/root/entities/variable/supportEmail.json").relationships
        .requiredByVariables,
    ).toContain("config");
    expect(load(manifest, "data/root/entities/variable/supportEmail.json").usedBy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "config", locations: ["compose email"] }),
      ]),
    );
    expect(load(manifest, "data/root/entities/feature/checkout.json").usedBy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "config",
          locations: expect.arrayContaining(["compose enabled", "compose layout", "compose label"]),
        }),
      ]),
    );
    expect(readVariable.mock.calls.filter(([key]) => key === "supportEmail")).toHaveLength(1);
    expect(readVariable.mock.calls.filter(([key]) => key === "config")).toHaveLength(1);
    expect(readVariable.mock.calls.filter(([key]) => key === "screen")).toHaveLength(1);
  });

  it.each([false, true])(
    "exports composed override search and reverse dependencies without static previews, environments=%s",
    async (environments) => {
      const datasource = createDatasource();
      const readVariable = datasource.readVariable;
      datasource.listVariables = async () => ["supportEmail", "policy", "config"];
      const overrides = [
        {
          key: "regional",
          conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
          mutate: { email: "regional@example.com" },
          continue: true,
          overrides: [
            {
              key: "premium",
              conditions: [
                "premiumUsers",
                { feature: "checkout" },
                { variable: "policy", operator: "equals", value: true },
              ],

              value: { email: "premium@example.com" },
            },
          ],
        },
      ];
      datasource.readVariable = (async (key: string) => {
        if (key === "config")
          return {
            description: "Composed overrides",
            compose: { email: { variable: "supportEmail" } },
            overrides: environments ? { staging: overrides, production: [] } : overrides,
          };
        if (key === "policy") return { type: "boolean", defaultValue: true };
        return { ...(await readVariable()), overrides: undefined };
      }) as any;
      const resolveOverrideValue = jest.fn();
      const config = createProjectConfig(root);
      if (!environments) config.environments = [];
      const { manifest } = await exportCatalog(
        { ...createRuntime(), resolveOverrideValue },
        root,
        config,
        datasource,
        { copyAssets: false, compactStorage: true },
      );
      const detail = load(manifest, "data/root/entities/variable/config.json");
      expect(detail).not.toHaveProperty("accumulationPreview");
      expect(detail.entity).not.toHaveProperty("defaultValue");
      expect(resolveOverrideValue).not.toHaveBeenCalled();
      expect(detail.relationships).toMatchObject({
        features: ["checkout"],
        requiredVariables: ["policy", "supportEmail"],
        segments: ["premiumUsers"],
        // plan is read through premiumUsers.
        attributes: ["country", "plan"],
      });
      for (const [type, key] of [
        ["feature", "checkout"],
        ["variable", "policy"],
        ["segment", "premiumUsers"],
        ["attribute", "country"],
      ]) {
        const dependency = load(manifest, `data/root/entities/${type}/${key}.json`);
        expect(dependency.usedBy).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "variable",
              key: "config",
              locations: expect.arrayContaining([expect.stringContaining("regional")]),
            }),
          ]),
        );
      }
      const index = decodeCatalogIndex(load(manifest, manifest.paths.root!));
      expect(searchCatalog(index, "premium")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "variable",
            key: "config",
            match: { kind: "override", value: "regional › premium" },
          }),
        ]),
      );
    },
  );

  it.each([false, true])(
    "round trips compact indexes and details with prettyOutput=%s",
    async (prettyOutput) => {
      const config = createProjectConfig(root);
      const datasource = createDatasource();
      const features = jest.spyOn(datasource, "listFeatures");
      const feature = jest.spyOn(datasource, "readFeature");
      const runtime = createRuntime();
      const original = runtime.getCatalogTargetMemberships;
      runtime.getCatalogTargetMemberships = async (config, snapshot) => {
        // The runtime reads the same frozen definition the Catalog uses.
        const value = await snapshot.readFeature("checkout");
        expect(Object.isFrozen(value)).toBe(true);
        expect(() => (value.description = "Mutated by runtime")).toThrow(/read only/);
        return original(config, snapshot);
      };
      const { manifest } = await exportCatalog(runtime, root, config, datasource, {
        copyAssets: false,
        compactStorage: true,
        prettyOutput,
      });
      expect(manifest.storage?.version).toBe(2);
      const index = decodeCatalogIndex(load(manifest, manifest.paths.root!));
      expect(index.counts.feature).toBe(1);
      expect(index.entities.feature[0].description).toBe("Checkout feature");
      expect(index.entities.target.find((item) => item.key === "premiumWeb")!.tags).toEqual([
        "web",
        "premium",
      ]);
      expect(index.entities.target.find((item) => item.key === "mobile")!.tags).toEqual(["mobile"]);
      expect(load(manifest, "data/root/entities/target/premiumWeb.json").entity.tags).toEqual({
        and: ["web", "premium"],
      });
      expect(load(manifest, "data/root/entities/feature/checkout.json").entity.description).toBe(
        "Checkout feature",
      );
      expect(features).toHaveBeenCalledTimes(1);
      expect(feature).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(path.join(root, "catalog/data/root/index.json"))).toBe(false);
      const manifestText = fs.readFileSync(path.join(root, "catalog/data/manifest.json"), "utf8");
      expect(manifestText.includes("\n")).toBe(prettyOutput);
      const indexText = fs.readFileSync(
        path.join(root, "catalog", manifest.storage!.documents[manifest.paths.root!]),
        "utf8",
      );
      expect(indexText.includes("\n")).toBe(prettyOutput);
    },
  );

  it.each([undefined, false, []])(
    "exports the no-environments example with environments %j",
    async (environments) => {
      const example = path.resolve(__dirname, "../../../../examples/example-no-environments");
      const authoredConfig = require(path.join(example, "featurevisor.config.js"));
      const feature = require("yaml").parse(
        fs.readFileSync(path.join(example, "features/showCookieBanner.yml"), "utf8"),
      );
      const datasource = {
        ...createDatasource(),
        listFeatures: async () => ["showCookieBanner"],
        readFeature: async () => feature,
      };
      const config = { ...createProjectConfig(root), ...authoredConfig, environments };
      const { manifest } = await exportCatalog(createRuntime(), root, config, datasource, {
        copyAssets: false,
        compactStorage: true,
      });
      const index = decodeCatalogIndex(load(manifest, manifest.paths.root!));
      expect(index.entities.feature[0].environmentStatus).toBe("enabled");
      expect(index.entities.feature[0].environments).toBeUndefined();
      expect(manifest.projectConfig.environments).toEqual(
        Array.isArray(environments) ? [] : undefined,
      );
      const detail = load(manifest, "data/root/entities/feature/showCookieBanner.json");
      expect(detail.entity.rules).toEqual(feature.rules);
      expect(Array.isArray(detail.entity.rules)).toBe(true);
    },
  );

  it.each([
    { tags: ["web", "premium"] },
    { tags: { and: ["web", "premium"] } },
    { tags: { or: ["web", "premium"] } },
    { tag: "web", tags: { or: ["web", "premium"] } },
    { tag: "web", tags: { not: { or: ["web", { and: ["premium", "web"] }] } } },
  ])("exports Target tag mentions without changing the selector %j", async (selector) => {
    const datasource = {
      ...createDatasource(),
      listTargets: async () => ["target"],
      readTarget: async () => ({ description: "Target", ...selector }),
    };
    const { manifest } = await exportCatalog(
      createRuntime({ target: { features: [], variables: [] } }),
      root,
      createProjectConfig(root),
      datasource,
      { copyAssets: false, compactStorage: true },
    );
    const index = decodeCatalogIndex(load(manifest, manifest.paths.root!));
    expect(index.entities.target[0].tags).toEqual(["web", "premium"]);
    expect(load(manifest, "data/root/entities/target/target.json").entity).toMatchObject(selector);
  });

  it.each(["export", "serve"])("passes hyphenated formatting options to %s", async (subcommand) => {
    const api: any = { exportCatalog: jest.fn(), serveCatalog: jest.fn() };
    await createCatalogPlugin(createRuntime(), api).handler({
      rootDirectoryPath: root,
      projectConfig: createProjectConfig(root),
      datasource: createDatasource(),
      parsed: { _: [], subcommand, "pretty-output": true, "block-size": 1234 },
    });
    expect(api[subcommand === "export" ? "exportCatalog" : "serveCatalog"]).toHaveBeenCalledWith(
      root,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ prettyOutput: true, blockSize: 1234 }),
    );
  });

  it.each(["a space", "a%name", "日本語"])(
    "encodes set %s and entity segments exactly once",
    async (set) => {
      const config = createProjectConfig(root, true);
      const key = "nested/key %日本";
      const datasource = {
        ...createDatasource(),
        listSets: async () => [set],
        forSet: () => ({
          ...createDatasource(set),
          listFeatures: async () => [key],
          listTests: async () => [key],
          listScenarios: async () => [],
          listHistoryEntries: async () => [
            {
              commit: "abc123",
              subject: "subject",
              author: "Author",
              timestamp: "2026-01-01T00:00:00Z",
              entities: [
                { type: "feature", key },
                { type: "test", key },
              ],
            },
          ],
        }),
      };
      const { manifest } = await exportCatalog(createRuntime(), root, config, datasource, {
        copyAssets: false,
        compactStorage: true,
      });
      const base = `data/sets/${encodeURIComponent(set)}`;
      expect(manifest.paths.sets![set]).toBe(`${base}/index.json`);
      const encodedKey = key.split("/").map(encodeURIComponent).join("/");
      for (const type of ["feature", "test"]) {
        const detail = load(manifest, `${base}/entities/${type}/${encodedKey}.json`);
        expect(detail.historyPath).toBe(`${base}/entity-history/${type}/${encodedKey}`);
        expect(load(manifest, `${detail.historyPath}/page-1.json`)).toMatchObject({ page: 1 });
      }
    },
  );

  it("reuses only unchanged sets from the last successful publication and retries failed sets", async () => {
    const config = createProjectConfig(root, true);
    const dev = createDatasource("dev");
    const production = createDatasource("production");
    const devRead = jest.spyOn(dev, "readFeature");
    const productionRead = jest.spyOn(production, "readFeature");
    const datasource = {
      ...createDatasource(),
      forSet: (set: string) => (set === "dev" ? dev : production),
    };
    const runtime = createRuntime();
    const session = await createCatalogDevSession(root, config, datasource, { devEditors: [] });
    const options = { copyAssets: false, compactStorage: true, devSession: session };
    const first = await exportCatalog(runtime, root, config, datasource, options);
    const productionURL = first.manifest.storage!.documents["data/sets/production/index.json"];
    const productionMtime = fs.statSync(path.join(root, "catalog", productionURL)).mtimeMs;
    devRead.mockClear();
    productionRead.mockClear();
    const changedPaths = [path.join(config.setsDirectoryPath, "dev/features/checkout.yml")];
    const second = await exportCatalog(runtime, root, config, datasource, {
      compactStorage: false,
      ...options,
      changedPaths,
    });
    expect(devRead).toHaveBeenCalledTimes(1);
    expect(productionRead).not.toHaveBeenCalled();
    expect(second.manifest.storage!.documents["data/sets/production/index.json"]).toBe(
      productionURL,
    );
    expect(fs.statSync(path.join(root, "catalog", productionURL)).mtimeMs).toBe(productionMtime);
    const manifestPath = path.join(root, "catalog/data/manifest.json");
    const before = fs.readFileSync(manifestPath, "utf8");
    const indexes = session.setIndexes;
    const originalRename = fs.promises.rename;
    const rename = jest.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
      if (String(to) === manifestPath) throw new Error("Publication failed");
      return originalRename(from, to);
    });
    await expect(
      exportCatalog(runtime, root, config, datasource, {
        compactStorage: false,
        ...options,
        changedPaths,
      }),
    ).rejects.toThrow("Publication failed");
    rename.mockRestore();
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(before);
    expect(session.setIndexes).toBe(indexes);
    devRead.mockClear();
    productionRead.mockClear();
    await exportCatalog(runtime, root, config, datasource, {
      compactStorage: false,
      ...options,
      changedPaths: [path.join(config.setsDirectoryPath, "production/features/checkout.yml")],
    });
    expect(devRead).toHaveBeenCalledTimes(1);
    expect(productionRead).toHaveBeenCalledTimes(1);
    expect(session.failedChangedPaths).toEqual([]);
    devRead.mockClear();
    productionRead.mockClear();
    await exportCatalog(runtime, root, config, datasource, {
      compactStorage: false,
      ...options,
      changedPaths,
      outDir: "elsewhere",
    });
    expect(devRead).toHaveBeenCalledTimes(1);
    expect(productionRead).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a set after an unrelated publication replaces the manifest", async () => {
    const config = createProjectConfig(root, true);
    const production = createDatasource("production");
    const datasource = {
      ...createDatasource(),
      forSet: (set: string) => (set === "production" ? production : createDatasource(set)),
    };
    const session = await createCatalogDevSession(root, config, datasource, { devEditors: [] });
    const options = { copyAssets: false, compactStorage: true, devSession: session };
    await exportCatalog(createRuntime(), root, config, datasource, options);
    const manifestPath = path.join(root, "catalog/data/manifest.json");
    const manifest = read(manifestPath);
    delete manifest.storage;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const readProduction = jest.spyOn(production, "readFeature");
    await exportCatalog(createRuntime(), root, config, datasource, {
      compactStorage: false,
      ...options,
      changedPaths: [path.join(config.setsDirectoryPath, "dev/features/flag.yml")],
    });
    expect(readProduction).toHaveBeenCalledTimes(1);
  });

  it("treats shared, removed and unknown set paths as full invalidations", () => {
    const config = createProjectConfig(root, true);
    for (const changed of [
      root,
      path.join(root, "report.json"),
      config.setsDirectoryPath,
      path.join(config.setsDirectoryPath, "removed/features/a.yml"),
    ]) {
      expect(getChangedCatalogSets(config, [changed], ["dev", "production"])).toBeUndefined();
    }
    expect(
      getChangedCatalogSets(
        config,
        [path.join(config.setsDirectoryPath, "dev/features/a.yml")],
        ["dev", "production"],
      ),
    ).toEqual(new Set(["dev"]));
  });

  it("uses supplied subjects and looks up only missing custom datasource subjects", async () => {
    const exec = jest.spyOn(childProcess, "execFileSync").mockImplementation((_command, args) => {
      if ((args as string[]).includes("--no-walk"))
        return "bbb123456789\x1fFallback | subject\x1fkept\n";
      throw new Error("No Git metadata");
    });
    const datasource = {
      ...createDatasource(),
      listHistoryEntries: async () => [
        {
          commit: "aaa123",
          author: "Author",
          timestamp: "2026-01-03",
          subject: "Supplied",
          entities: [],
        },
        { commit: "bbb123", author: "Author", timestamp: "2026-01-02", entities: [] },
        { commit: "ccc123", author: "Author", timestamp: "2026-01-01", subject: "", entities: [] },
      ],
    };
    await exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
      compactStorage: false,
      copyAssets: false,
    });
    expect(
      read(path.join(root, "catalog/data/project/history/page-1.json")).entries.map(
        (entry: any) => entry.subject,
      ),
    ).toEqual(["Supplied", "Fallback | subject\x1fkept", ""]);
    const lookup = exec.mock.calls.filter((call) => (call[1] as string[]).includes("--no-walk"));
    expect(lookup).toHaveLength(1);
    expect(lookup[0][2]).toMatchObject({ input: "bbb123" });
  });

  it("watches exact Git and report paths, refreshes spec history and stops once", async () => {
    jest.useFakeTimers();
    git(root, ["init", "-q"]);
    const config = createProjectConfig(root);
    const datasource = createDatasource();
    const history = jest.spyOn(datasource, "listHistoryEntries");
    let onChange: (files: string[]) => void;
    const stopWatching = jest.fn();
    jest.mocked(watchCatalogInputs).mockImplementation((_root, _config, _ignored, callback) => {
      onChange = callback;
      return stopWatching;
    });
    const server = {
      close: jest.fn(async () => {}),
      setOutputDirectoryPath: jest.fn(),
      setBasePath: jest.fn(),
      triggerReload: jest.fn(),
    };
    const api: any = {
      exportCatalog: jest.fn(async () => {}),
      serveCatalog: jest.fn(async () => server),
    };
    const report = path.join(root, ".featurevisor/report.json");
    const controller = await startCatalogDevMode(createRuntime(), api, root, config, datasource, {
      _: [],
      testReport: report,
      "pretty-output": true,
      "block-size": 1234,
    });
    try {
      expect(api.exportCatalog.mock.calls[0][3]).toMatchObject({
        prettyOutput: true,
        blockSize: 1234,
      });
      const calls = jest.mocked(watchCatalogInputs).mock.calls;
      const extras = calls[calls.length - 1][4]!;
      const reference = childProcess
        .execFileSync("git", ["symbolic-ref", "HEAD"], { cwd: root, encoding: "utf8" })
        .trim();
      expect(extras).toEqual(
        ["HEAD", "packed-refs", "config", reference]
          .map((name) => path.join(root, ".git", name))
          .concat(report),
      );
      expect(extras).not.toContain(path.join(root, ".git"));
      expect(history).toHaveBeenCalledTimes(1);
      const sessionOf = (call: number) => api.exportCatalog.mock.calls.at(call)[3].devSession;
      const definitions = sessionOf(0).definitions;
      expect(definitions).toBeDefined();
      onChange!([path.join(config.featuresDirectoryPath, "flag.yml")]);
      // The rebuild starts 100 ms after the last event, not before.
      await jest.advanceTimersByTimeAsync(99);
      expect(api.exportCatalog).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(api.exportCatalog).toHaveBeenCalledTimes(2);
      expect(history).toHaveBeenCalledTimes(1);
      onChange!([path.join(config.testsDirectoryPath, "new.spec.yml")]);
      await jest.advanceTimersByTimeAsync(250);
      expect(history).toHaveBeenCalledTimes(2);
      // A new session for test inputs keeps the parsed definitions, which fingerprints guard.
      expect(sessionOf(-1)).not.toBe(sessionOf(0));
      expect(sessionOf(-1).definitions).toBe(definitions);
      expect(api.exportCatalog.mock.calls.at(-1)[3]).toMatchObject({
        prettyOutput: true,
        blockSize: 1234,
      });
      expect(api.exportCatalog.mock.calls.at(-1)[3].changedPaths).toBeUndefined();
      onChange!([path.join(root, ".git/config")]);
      await jest.advanceTimersByTimeAsync(250);
      expect(history).toHaveBeenCalledTimes(3);
      const exports = api.exportCatalog.mock.calls.length;
      onChange!([report]);
      const first = controller.stop();
      expect(controller.stop()).toBe(first);
      await first;
      await jest.advanceTimersByTimeAsync(2000);
      expect(api.exportCatalog).toHaveBeenCalledTimes(exports);
      expect(server.close).toHaveBeenCalledTimes(1);
    } finally {
      await controller.stop();
    }
  });

  it("refreshes custom set spec history and drains an active export when stopped", async () => {
    jest.useFakeTimers();
    const config = {
      ...createProjectConfig(root, true),
      testsDirectoryPath: path.join(root, "specifications"),
    };
    const datasource = createDatasource();
    const history = jest.spyOn(datasource, "listHistoryEntries");
    let onChange: (files: string[]) => void;
    const stopWatching = jest.fn();
    jest.mocked(watchCatalogInputs).mockImplementation((_root, _config, _ignored, callback) => {
      onChange = callback;
      return stopWatching;
    });
    const server = {
      close: jest.fn(async () => {}),
      setOutputDirectoryPath: jest.fn(),
      setBasePath: jest.fn(),
      triggerReload: jest.fn(),
    };
    const api: any = {
      exportCatalog: jest.fn(async () => {}),
      serveCatalog: jest.fn(async () => server),
    };
    const controller = await startCatalogDevMode(createRuntime(), api, root, config, datasource, {
      _: [],
    });
    let release!: () => void;
    api.exportCatalog.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    onChange!([path.join(config.setsDirectoryPath, "dev/custom/test.yml")]);
    await jest.advanceTimersByTimeAsync(250);
    expect(history).toHaveBeenCalledTimes(2);
    expect(api.exportCatalog.mock.calls[1][3].changedPaths).toBeUndefined();
    onChange!([path.join(config.setsDirectoryPath, "production/custom/test.yml")]);
    await jest.advanceTimersByTimeAsync(250);
    const stopping = controller.stop();
    let stopped = false;
    void stopping.then(() => (stopped = true));
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(api.exportCatalog).toHaveBeenCalledTimes(2);
    expect(server.triggerReload).not.toHaveBeenCalled();
    expect(stopWatching).toHaveBeenCalledTimes(1);
    expect(controller.stop()).toBe(stopping);
  });

  it.each([false, true])(
    "refreshes effective allocation watches only in report mode: %s",
    async (reportMode) => {
      jest.useFakeTimers();
      let config = {
        ...createProjectConfig(root, true),
        stateDirectoryPath: path.join(root, "custom-state"),
      };
      const sets = ["dev", "production"];
      const datasource = createDatasource();
      const runtime = createRuntime();
      runtime.getProjectSetExecutions = async (configuration) =>
        sets.map((set) => ({
          set,
          datasource,
          projectConfig: {
            ...configuration,
            stateDirectoryPath: path.join(configuration.stateDirectoryPath, "sets", set),
          },
        }));
      runtime.getTestInputStatePaths = jest.fn((configuration) =>
        configuration.environments.map((environment: string) =>
          path.join(configuration.stateDirectoryPath, `allocation-${environment}.json`),
        ),
      );
      runtime.reloadCatalogProject = async () => ({ projectConfig: config, datasource });
      let onChange!: (files: string[]) => void;
      jest.mocked(watchCatalogInputs).mockImplementation((_root, _config, _ignored, callback) => {
        onChange = callback;
        return jest.fn();
      });
      const server = {
        close: jest.fn(async () => {}),
        setOutputDirectoryPath: jest.fn(),
        setBasePath: jest.fn(),
        triggerReload: jest.fn(),
      };
      const api: any = {
        exportCatalog: jest.fn(async () => {}),
        serveCatalog: jest.fn(async () => server),
      };
      const controller = await startCatalogDevMode(runtime, api, root, config, datasource, {
        _: [],
        ...(reportMode ? { testReport: "report.json" } : {}),
      });
      const extras = () => {
        const calls = jest.mocked(watchCatalogInputs).mock.calls;
        return calls[calls.length - 1][4]!;
      };
      try {
        if (!reportMode) expect(runtime.getTestInputStatePaths).not.toHaveBeenCalled();
        expect(extras().some((file) => file.includes("allocation-"))).toBe(reportMode);
        const oldDirectory = config.stateDirectoryPath;
        config = {
          ...config,
          environments: ["preview"],
          stateDirectoryPath: path.join(root, "replacement-state"),
        };
        const definitionsBefore = api.exportCatalog.mock.calls.at(-1)[3].devSession?.definitions;
        onChange([path.join(root, "featurevisor.config.js")]);
        await jest.advanceTimersByTimeAsync(250);
        expect(extras().some((file) => file.startsWith(oldDirectory))).toBe(false);
        // Configuration can change the parser or directories, so parsed definitions start over.
        const definitionsAfter = api.exportCatalog.mock.calls.at(-1)[3].devSession?.definitions;
        expect(definitionsBefore).toBeDefined();
        expect(definitionsAfter).not.toBe(definitionsBefore);
        if (reportMode) {
          for (const set of sets)
            expect(extras()).toContain(
              path.join(config.stateDirectoryPath, "sets", set, "allocation-preview.json"),
            );
        }
        sets.push("qa");
        onChange([path.join(config.setsDirectoryPath, "qa")]);
        await jest.advanceTimersByTimeAsync(250);
        expect(
          extras().includes(
            path.join(config.stateDirectoryPath, "sets", "qa", "allocation-preview.json"),
          ),
        ).toBe(reportMode);
        if (!reportMode) expect(runtime.getTestInputStatePaths).not.toHaveBeenCalled();
      } finally {
        await controller.stop();
      }
    },
  );

  it("maps exact allocation inputs to every owning Set before directory classification", () => {
    const config = createProjectConfig(root, true);
    const devState = path.join(root, "custom-state/dev/existing-state.json");
    const shared = path.join(root, "custom-state/shared.json");
    const paths = new Map([
      ["dev", [devState, shared]],
      ["production", [shared]],
    ]);
    expect(getChangedCatalogSets(config, [devState], ["dev", "production"], paths)).toEqual(
      new Set(["dev"]),
    );
    expect(getChangedCatalogSets(config, [shared], ["dev", "production"], paths)).toEqual(
      new Set(["dev", "production"]),
    );
    expect(
      getChangedCatalogSets(
        config,
        [path.join(root, "custom-state/REVISION")],
        ["dev", "production"],
        paths,
      ),
    ).toBeUndefined();
  });

  it("invalidates every set when a shared report is stored inside one set", async () => {
    const config = createProjectConfig(root, true);
    const production = createDatasource("production");
    const datasource = {
      ...createDatasource(),
      forSet: (set: string) => (set === "production" ? production : createDatasource(set)),
    };
    const report = path.join(config.setsDirectoryPath, "dev", "report.json");
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, JSON.stringify({ schemaVersion: 1, results: [] }));
    const session = await createCatalogDevSession(root, config, datasource, { devEditors: [] });
    const options = {
      copyAssets: false,
      compactStorage: true,
      devSession: session,
      testReport: report,
    };
    await exportCatalog(createRuntime(), root, config, datasource, options);
    const readProduction = jest.spyOn(production, "readFeature");
    await exportCatalog(createRuntime(), root, config, datasource, {
      compactStorage: false,
      ...options,
      changedPaths: [report],
    });
    expect(readProduction).toHaveBeenCalledTimes(1);
  });

  it("serves compact output with immutable blocks, uncached manifest and idempotent SSE cleanup", async () => {
    const server = Object.assign(new EventEmitter(), {
      listen: jest.fn((_port, _host, callback) => callback()),
      close: jest.fn((callback) => callback()),
    });
    let handler: any;
    jest.spyOn(http, "createServer").mockImplementation(((callback: any) => {
      handler = callback;
      return server;
    }) as any);
    const handle = await serveCatalog(
      createRuntime(),
      root,
      createProjectConfig(root),
      createDatasource(),
      { copyAssets: false, prettyOutput: true, liveReload: true },
    );
    const manifest = read(path.join(root, "catalog/data/manifest.json"));
    expect(manifest.storage.version).toBe(2);
    const request = (url: string) =>
      new Promise<any>((resolve, reject) => {
        const headers: Record<string, string> = {};
        const response = {
          status: 0,
          headers,
          setHeader: (key: string, value: string) => (headers[key] = value),
          writeHead: (status: number, values: any) => {
            response.status = status;
            Object.assign(headers, values);
          },
          end: () => resolve(response),
        };
        Promise.resolve(handler({ url, headers: { host: "127.0.0.1:3000" } }, response)).catch(
          reject,
        );
      });
    expect((await request("/data/manifest.json")).headers["Cache-Control"]).toBe("no-cache");
    const block = manifest.storage.documents[manifest.paths.root];
    expect((await request(`/${block}?v=1`)).headers["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    const missing = await request(`/data/blocks/${"a".repeat(64)}.json`);
    expect(missing.status).toBe(404);
    expect(missing.headers["Cache-Control"]).toBe("no-cache");
    const response = {
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };
    await handler(
      Object.assign(new EventEmitter(), {
        url: "/__featurevisor_catalog_reload",
        headers: { host: "127.0.0.1:3000" },
      }),
      response,
    );
    const first = handle.close();
    expect(handle.close()).toBe(first);
    await first;
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });
});

describe("catalog export", () => {
  it("updates the meta marker and assets without copying on successive config exports", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-base-export-"));
    const config = createProjectConfig(root);
    const indexPath = path.join(config.catalogDirectoryPath, "index.html");
    fs.mkdirSync(config.catalogDirectoryPath);
    fs.writeFileSync(
      indexPath,
      '<html><head><script src="./assets/app.js"></script><link href="./favicon.png"></head><body><a href="#rules">Rules</a></body></html>',
    );
    try {
      for (const catalogBasePath of ["/catalog/", "/internal/catalog/", "/"]) {
        await exportCatalog(
          createRuntime(),
          root,
          { ...config, catalogBasePath },
          createDatasource(),
          {
            copyAssets: false,
            preserveAssets: true,
            compactStorage: true,
          },
        );
        const html = fs.readFileSync(indexPath, "utf8");
        expect(html).toContain(
          `<meta name="featurevisor-catalog-base" content="${catalogBasePath}">`,
        );
        expect(html).toContain(`src="${catalogBasePath}assets/app.js"`);
        expect(html).toContain(`href="${catalogBasePath}favicon.png"`);
        expect(html).toContain('href="#rules"');
        expect(html).not.toContain("<base");
        expect(html.match(/featurevisor-catalog-base/g)).toHaveLength(1);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects shared entity and scenario identities before writing either detail", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-identity-collision-"));
    try {
      const datasource = {
        ...createDatasource(),
        listTests: async () => ["checkout"],
        listScenarios: async () => ["checkout"],
      };
      await expect(
        exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
          compactStorage: false,
          copyAssets: false,
        }),
      ).rejects.toThrow('Test identity collision for "checkout"');
      expect(fs.existsSync(path.join(root, "catalog/data/root/entities/test/checkout.json"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses clean scenario identities while retaining an explicitly resolved source file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-clean-scenario-"));
    try {
      const datasource = {
        ...createDatasource(),
        listTests: async () => [],
        listScenarios: async () => ["journeys.checkout"],
        readScenario: async () => ({ checks: [{ feature: "checkout", enabled: true }] }),
        getScenarioSourcePath: (key: string) => {
          expect(key).toBe("journeys.checkout");
          return path.join(root, "tests", "journeys", "checkout.yml");
        },
      };
      await exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
        compactStorage: false,
        copyAssets: false,
      });
      const detail = JSON.parse(
        fs.readFileSync(
          path.join(root, "catalog/data/root/entities/test/journeys.checkout.json"),
          "utf8",
        ),
      );
      expect(detail.key).toBe("journeys.checkout");
      expect(detail.entity.scenario).toBe("journeys.checkout");
      expect(detail.sourcePath).toBe("tests/journeys/checkout.yml");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("separates indirect scenario links from segment tests and deduplicates each consumer", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-related-"));
    const datasource = {
      ...createDatasource(),
      listScenarios: async () => ["journeys/checkout.spec", "unrelated.spec", "direct.spec"],
      readScenario: async (key: string) =>
        key === "direct.spec"
          ? {
              checks: [
                { feature: "checkout", enabled: true },
                { segment: "premiumUsers", matches: true },
              ],
            }
          : key === "unrelated.spec"
            ? { checks: [{ variable: "unrelated", operator: "exists" }] }
            : {
                matrix: { feature: ["checkout", "checkout"] },
                checks: [{ feature: "${{ feature }}", enabled: true }],
                children: [
                  {
                    checks: [
                      {
                        variable: "supportEmail",
                        operator: "equals",
                        compareTo: { feature: "checkout", variable: "theme" },
                      },
                    ],
                  },
                ],
              },
    };
    try {
      await exportCatalog(
        createRuntime(),
        root,
        { ...createProjectConfig(root), namespaceCharacter: "/" },
        datasource,
        { compactStorage: false, copyAssets: false },
      );
      const detail = JSON.parse(
        fs.readFileSync(
          path.join(root, "catalog/data/root/entities/segment/premiumUsers.json"),
          "utf8",
        ),
      );
      expect(detail.tests.map((test: { key: string }) => test.key)).toEqual([
        "direct.spec",
        "premium-users",
      ]);
      expect(detail.relationships.tests).toEqual(["direct.spec", "premium-users"]);
      expect(detail.relatedScenarios).toEqual([
        {
          key: "journeys/checkout.spec",
          via: [
            { type: "feature", key: "checkout" },
            { type: "variable", key: "supportEmail" },
          ],
        },
      ]);
      const scenario = JSON.parse(
        fs.readFileSync(
          path.join(root, "catalog/data/root/entities/test/journeys/checkout.spec.json"),
          "utf8",
        ),
      );
      expect(scenario.entity.scenario).toBe("journeys/checkout.spec");
      expect(scenario.sourcePath).toBe("tests/journeys/checkout.spec.yml");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("watches all authored specs through the tests directory", () => {
    const root = path.join(os.tmpdir(), "featurevisor-catalog-watch");
    const projectConfig = createProjectConfig(root);

    expect(getCatalogInputWatchPaths(root, projectConfig)).toEqual([
      path.join(root, "featurevisor.config.js"),
      projectConfig.featuresDirectoryPath,
      projectConfig.segmentsDirectoryPath,
      projectConfig.attributesDirectoryPath,
      projectConfig.targetsDirectoryPath,
      projectConfig.schemasDirectoryPath,
      projectConfig.variablesDirectoryPath,
      projectConfig.testsDirectoryPath,
    ]);
  });

  it.each([
    "/../catalog-secret/secret.txt",
    "/%2e%2e/catalog-secret/secret.txt",
    "/%2e%2e%2fcatalog-secret/secret.txt",
    "/%2e%2e%5ccatalog-secret/secret.txt",
  ])("rejects request traversal without falling back to the SPA: %s", async (requestUrl) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-request-"));
    const output = path.join(root, "catalog");
    const sibling = path.join(root, "catalog-secret");
    fs.mkdirSync(output);
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(output, "index.html"), "catalog index");
    fs.writeFileSync(path.join(sibling, "secret.txt"), "secret");

    try {
      await expect(resolveCatalogRequestPath(output, requestUrl)).resolves.toEqual({
        status: "unsafe",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns an invalid request result for malformed URI encoding", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-request-"));
    const output = path.join(root, "catalog");
    fs.mkdirSync(output);

    try {
      await expect(resolveCatalogRequestPath(output, "/%E0%A4%A")).resolves.toEqual({
        status: "invalid",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects files reached through a symlink outside the Catalog output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-request-"));
    const output = path.join(root, "catalog");
    const sibling = path.join(root, "catalog-secret");
    fs.mkdirSync(output);
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, "secret.txt"), "secret");
    fs.symlinkSync(sibling, path.join(output, "linked"), "dir");

    try {
      await expect(resolveCatalogRequestPath(output, "/linked/secret.txt")).resolves.toEqual({
        status: "unsafe",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reloads config, datasource, output, Git session inputs, and watch paths in dev mode", async () => {
    jest.useFakeTimers();
    let onChange: (paths: string[]) => void;
    jest.mocked(watchCatalogInputs).mockImplementation((_root, _config, _ignored, callback) => {
      onChange = callback;
      return jest.fn();
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-dev-"));
    const configPath = path.join(root, "featurevisor.config.js");
    const firstConfig = createProjectConfig(root);
    const nextFeaturesPath = path.join(root, "next-features");
    const nextConfig = {
      ...createProjectConfig(root),
      featuresDirectoryPath: nextFeaturesPath,
      catalogDirectoryPath: path.join(root, "next-catalog"),
      catalogBasePath: "/internal/catalog/",
    };
    const firstDatasource = { id: "first" };
    const nextDatasource = { id: "next" };
    fs.writeFileSync(configPath, "module.exports = { tags: ['first'] };\n");
    fs.mkdirSync(firstConfig.featuresDirectoryPath, { recursive: true });
    fs.mkdirSync(nextFeaturesPath, { recursive: true });

    const reloadCatalogProject = jest.fn(async () => ({
      projectConfig: nextConfig,
      datasource: nextDatasource,
    }));
    const runtime: CatalogRuntime = {
      ...createRuntime(),
      reloadCatalogProject,
    };
    const server = {
      close: jest.fn(async () => undefined),
      setOutputDirectoryPath: jest.fn(),
      setBasePath: jest.fn(),
      triggerReload: jest.fn(),
    };
    const api: any = {
      exportCatalog: jest.fn(async () => undefined),
      serveCatalog: jest.fn(async () => server),
    };
    const controller = await startCatalogDevMode(runtime, api, root, firstConfig, firstDatasource, {
      _: [],
    });

    try {
      fs.writeFileSync(configPath, "module.exports = { tags: ['second', 'changed'] };\n");
      onChange!([configPath]);
      await jest.advanceTimersByTimeAsync(1250);

      expect(reloadCatalogProject).toHaveBeenCalledWith(root);
      expect(api.exportCatalog).toHaveBeenLastCalledWith(
        root,
        nextConfig,
        nextDatasource,
        expect.objectContaining({
          copyAssets: true,
          preserveAssets: false,
          dev: true,
        }),
      );
      expect(api.exportCatalog.mock.calls[1][3].devSession).toBeUndefined();
      expect(server.setOutputDirectoryPath).toHaveBeenCalledWith(nextConfig.catalogDirectoryPath);
      expect(server.setBasePath).toHaveBeenCalledWith("/internal/catalog/");

      fs.writeFileSync(path.join(nextFeaturesPath, "new.yml"), "description: watched\n");
      onChange!([path.join(nextFeaturesPath, "new.yml")]);
      await jest.advanceTimersByTimeAsync(1250);

      expect(api.exportCatalog).toHaveBeenCalledTimes(3);
      expect(api.exportCatalog).toHaveBeenLastCalledWith(
        root,
        nextConfig,
        nextDatasource,
        expect.objectContaining({
          copyAssets: false,
          preserveAssets: true,
          dev: true,
        }),
      );
      expect(api.exportCatalog.mock.calls[2][3].devSession).toBeUndefined();
      expect(server.triggerReload).toHaveBeenCalledTimes(2);

      nextConfig.catalogBasePath = "/moved/";
      onChange!([configPath]);
      await jest.advanceTimersByTimeAsync(1250);
      expect(api.exportCatalog).toHaveBeenCalledTimes(4);
      expect(api.exportCatalog).toHaveBeenLastCalledWith(
        root,
        nextConfig,
        nextDatasource,
        expect.objectContaining({ copyAssets: false, preserveAssets: true }),
      );
      expect(server.setBasePath).toHaveBeenLastCalledWith("/moved/");
      expect(server.setBasePath.mock.invocationCallOrder[2]).toBeLessThan(
        server.triggerReload.mock.invocationCallOrder[2],
      );
    } finally {
      await controller.stop();
      jest.useRealTimers();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "root property",
      {
        checks: [{ feature: "checkout", enabled: true }],
        unexpectedProperty: true,
      },
      'Unknown scenario property "unexpectedProperty"',
    ],
    [
      "child property",
      {
        checks: [{ feature: "checkout", enabled: true }],
        children: [{ checks: [{ feature: "checkout", enabled: true }], unexpectedProperty: true }],
      },
      'Unknown scenario child property "unexpectedProperty"',
    ],
  ])("rejects unknown %s in authored scenarios", async (_label, scenario, message) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-scenario-shape-"));
    const datasource = {
      ...createDatasource(),
      listScenarios: async () => ["checkout-readiness.spec"],
      readScenario: async () => scenario,
    };

    await expect(
      exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
        compactStorage: false,
        copyAssets: false,
      }),
    ).rejects.toThrow(message);
  });

  it.each([
    ["missing root checks", {}, "Scenarios require nonempty checks at the root"],
    ["empty root checks", { checks: [] }, "Scenarios require nonempty checks at the root"],
    [
      "empty children",
      {
        checks: [{ feature: "checkout", enabled: true }],
        children: [],
      },
      "Scenario children must be a nonempty array",
    ],
    [
      "non-object children",
      {
        checks: [{ feature: "checkout", enabled: true }],
        children: [null],
      },
      "Scenario child 1 must be an object",
    ],
    [
      "child checks",
      {
        checks: [{ feature: "checkout", enabled: true }],
        children: [{}],
      },
      "Scenario child 1 requires nonempty checks",
    ],
    [
      "unknown child properties",
      {
        checks: [{ feature: "checkout", enabled: true }],
        children: [
          {
            checks: [{ feature: "checkout", enabled: true }],
            expectedToBeEnabled: true,
          },
        ],
      },
      'Unknown scenario child property "expectedToBeEnabled"',
    ],
  ])("rejects scenarios with %s", async (_label, scenario, message) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-scenario-shape-"));
    const datasource = {
      ...createDatasource(),
      listScenarios: async () => ["checkout-readiness.spec"],
      readScenario: async () => scenario,
    };

    await expect(
      exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
        compactStorage: false,
        copyAssets: false,
      }),
    ).rejects.toThrow(message);
  });

  it.each(["scenario", "key", "feature", "segment", "variable"])(
    "rejects marker or owner property %s in a scenario root",
    async (property) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-scenario-mixed-"));
      const datasource = {
        ...createDatasource(),
        listScenarios: async () => ["checkout.readiness.spec"],
        readScenario: async () => ({
          checks: [{ feature: "checkout", enabled: true }],
          [property]: "invalid",
        }),
      };

      await expect(
        exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
          compactStorage: false,
          copyAssets: false,
        }),
      ).rejects.toThrow(`Unknown scenario property "${property}"`);
    },
  );

  it("rejects assertions in a scenario root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-scenario-mixed-"));
    const datasource = {
      ...createDatasource(),
      listScenarios: async () => ["checkout.readiness.spec"],
      readScenario: async () => ({
        checks: [{ feature: "checkout", enabled: true }],
        assertions: [],
      }),
    };

    await expect(
      exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
        compactStorage: false,
        copyAssets: false,
      }),
    ).rejects.toThrow("Scenarios use checks at the root, without assertions.");
  });

  it("wraps scenario checks without renaming payload properties", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-scenario-payload-"));
    const assertion = {
      context: {
        checks: "root context checks",
        custom: "root context custom",
      },
      stickyVariables: {
        settings: {
          checks: "root sticky checks",
          custom: "root sticky custom",
        },
      },
      checks: [{ feature: "checkout", enabled: true }],
      children: [
        {
          context: {
            checks: "child context checks",
            custom: "child context custom",
          },
          stickyVariables: {
            settings: {
              checks: "child sticky checks",
              custom: "child sticky custom",
            },
          },
          checks: [{ feature: "checkout", variation: "control" }],
        },
      ],
    };
    const datasource = {
      ...createDatasource(),
      listScenarios: async () => ["scenarios.checkout.spec"],
      readScenario: async () => ({
        promotable: false,
        ...assertion,
      }),
    };

    await exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
      compactStorage: false,
      copyAssets: false,
    });

    const detail = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          "catalog",
          "data",
          "root",
          "entities",
          "test",
          "scenarios.checkout.spec.json",
        ),
        "utf8",
      ),
    );
    expect(detail.entity).toEqual({
      key: "scenarios.checkout.spec",
      scenario: "scenarios.checkout.spec",
      promotable: false,
      assertions: [assertion],
    });
    expect(detail.sourcePath).toBe("tests/scenarios/checkout.spec.yml");
  });

  it("writes manifest, index, and feature detail for a root project", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));

    await exportCatalog(createRuntime(), root, createProjectConfig(root), createDatasource(), {
      compactStorage: false,
      copyAssets: false,
    });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "catalog", "data", "manifest.json"), "utf8"),
    );
    const index = JSON.parse(
      fs.readFileSync(path.join(root, "catalog", "data", "root", "index.json"), "utf8"),
    );
    const detail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "feature", "checkout.json"),
        "utf8",
      ),
    );

    expect(manifest.sets).toBe(false);
    expect(index.counts.feature).toBe(1);
    expect(index.counts.variable).toBe(1);
    expect(index.entities.feature[0].targets).toEqual(["premiumWeb"]);
    expect(index.entities.segment[0].targets).toEqual(["premiumWeb"]);
    expect(index.entities.variable[0].targets).toEqual(["premiumWeb"]);
    expect(index.entities.segment[0].usedInFeatureCount).toBe(1);
    expect(
      index.entities.attribute.find((entity: any) => entity.key === "country").targets,
    ).toEqual(["premiumWeb"]);
    expect(index.entities.attribute.find((entity: any) => entity.key === "plan").targets).toEqual([
      "premiumWeb",
    ]);
    // plan is read through premiumUsers, by the checkout feature and the supportEmail variable.
    const plan = index.entities.attribute.find((entity: any) => entity.key === "plan");
    expect([plan.usedInFeatureCount, plan.usedInVariableCount]).toEqual([1, 1]);
    expect(detail.relationships).toMatchObject({
      segments: ["premiumUsers"],
      // Attributes read through segments count too, as Target membership already does.
      attributes: ["country", "plan"],
      targets: ["premiumWeb"],
      tests: ["checkout-matrix", "checkout-primary"],
    });
    expect(detail.tests).toHaveLength(2);
    expect(detail.tests.map((test: any) => test.key)).toEqual([
      "checkout-matrix",
      "checkout-primary",
    ]);
    expect(detail.tests[0].assertions[0].matrix).toEqual({
      country: ["nl", "de"],
      at: [10, 90],
    });

    const segmentDetail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "segment", "premiumUsers.json"),
        "utf8",
      ),
    );
    expect(segmentDetail.tests).toEqual([
      expect.objectContaining({ key: "premium-users", segment: "premiumUsers" }),
    ]);

    const variableDetail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "variable", "supportEmail.json"),
        "utf8",
      ),
    );
    expect(variableDetail.relationships).toMatchObject({
      segments: ["premiumUsers"],
      targets: ["premiumWeb"],
      tests: ["support-email"],
    });
    expect(variableDetail.tests).toEqual([
      expect.objectContaining({ key: "support-email", variable: "supportEmail" }),
    ]);

    const targetDetail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "target", "premiumWeb.json"),
        "utf8",
      ),
    );
    // Without segments from Core, they follow from the Target's features and variables.
    expect(targetDetail.relationships).toMatchObject({
      features: ["checkout"],
      variables: ["supportEmail"],
      segments: ["premiumUsers"],
    });
  });

  it("exports attribute condition values and environment drift", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));
    await exportCatalog(createRuntime(), root, createProjectConfig(root), createDatasource(), {
      compactStorage: false,
      copyAssets: false,
    });

    const dataPath = path.join(root, "catalog", "data", "root");
    const read = (...parts: string[]) =>
      JSON.parse(fs.readFileSync(path.join(dataPath, ...parts), "utf8"));
    const index = read("index.json");
    const plan = read("entities", "attribute", "plan.json");

    expect(plan.conditionValues).toEqual([
      {
        path: "plan",
        operator: "equals",
        uses: 1,
        values: ["premium"],
        users: [[{ type: "segment", key: "premiumUsers" }]],
      },
    ]);
    expect(index.entities.feature[0]).toMatchObject({ environmentsDiffer: true });
  });

  it("exports compact storage unless the plain layout is requested", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));
    await exportCatalog(createRuntime(), root, createProjectConfig(root), createDatasource(), {
      copyAssets: false,
    });
    const data = path.join(root, "catalog", "data");
    const manifest = JSON.parse(fs.readFileSync(path.join(data, "manifest.json"), "utf8"));
    expect(manifest.storage).toMatchObject({ version: 2 });
    expect(fs.existsSync(path.join(data, "root", "index.json"))).toBe(false);
    expect(fs.readdirSync(path.join(data, "blocks")).length).toBeGreaterThan(0);
  });

  it("indexes authored overrides, force conditions and scalar values for search", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));
    const base = createDatasource();
    const datasource = {
      ...base,
      readFeature: async () => ({
        ...(await base.readFeature()),
        variablesSchema: { greeting: { type: "string", defaultValue: "Hello" } },
        rules: {
          staging: [
            {
              key: "rule",
              conditions: "*",
              percentage: 100,
              variableOverrides: {
                greeting: [
                  {
                    key: "dutchGreeting",
                    conditions: [{ attribute: "country", operator: "equals", value: "be" }],
                    value: "Hallo",
                  },
                ],
              },
            },
          ],
          production: [],
        },
        force: {
          staging: [
            {
              conditions: [{ attribute: "userId", operator: "equals", value: "qa-tester" }],
              enabled: true,
            },
          ],
        },
      }),
      readVariable: async () => ({
        key: "supportEmail",
        type: "integer",
        defaultValue: 1,
        overrides: { production: [{ key: "bigLimit", conditions: "*", value: 4242 }] },
      }),
    };
    await exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
      compactStorage: false,
      copyAssets: false,
    });
    const index = decodeCatalogIndex(
      JSON.parse(fs.readFileSync(path.join(root, "catalog", "data", "root", "index.json"), "utf8")),
    );
    const find = (query: string) =>
      searchCatalog(index, query).map((result) => [result.type, result.key, result.match]);

    expect(find("dutchGreeting")).toEqual([
      ["feature", "checkout", { kind: "override", value: "dutchGreeting" }],
    ]);
    expect(find("Hallo")[0]).toEqual(["feature", "checkout", { kind: "value", value: "Hallo" }]);
    expect(find("qa-tester")[0]).toEqual([
      "feature",
      "checkout",
      { kind: "value", value: "qa-tester" },
    ]);
    expect(find("4242")[0]).toEqual(["variable", "supportEmail", { kind: "value", value: "4242" }]);
  });

  it("caps the entities listed for each condition value and counts the rest", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));
    const segmentKeys = Array.from({ length: 30 }, (_, index) => `plan${index}`);
    const datasource = {
      ...createDatasource(),
      listSegments: async () => segmentKeys,
      readSegment: async (key: string) => ({
        key,
        conditions: [{ attribute: "plan", operator: "equals", value: "premium" }],
      }),
    };
    await exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
      compactStorage: false,
      copyAssets: false,
    });

    const plan = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "attribute", "plan.json"),
        "utf8",
      ),
    );
    const [entry] = plan.conditionValues;
    expect(entry).toMatchObject({ uses: 30, values: ["premium"], moreUsers: [6] });
    expect(entry.users[0]).toHaveLength(24);
    expect(entry.users[0][0]).toEqual({ type: "segment", key: "plan0" });
  });

  it("marks features live from flat rules when the project has no environments", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));
    const projectConfig = { ...createProjectConfig(root), environments: undefined as any };
    const datasource = {
      ...createDatasource(),
      readFeature: async () => ({
        key: "checkout",
        description: "Checkout feature",
        tags: ["web"],
        bucketBy: "userId",
        rules: [
          { key: "internal", conditions: "premiumUsers", percentage: 0 },
          { key: "everyone", conditions: "*", percentage: 50 },
        ],
      }),
    };

    await exportCatalog(createRuntime(), root, projectConfig, datasource, {
      compactStorage: false,
      copyAssets: false,
    });

    const index = JSON.parse(
      fs.readFileSync(path.join(root, "catalog", "data", "root", "index.json"), "utf8"),
    );
    const detail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "feature", "checkout.json"),
        "utf8",
      ),
    );

    expect(index.entities.feature[0]).toMatchObject({ environmentStatus: "enabled" });
    expect(index.entities.feature[0].environmentStatusEnvironment).toBeUndefined();
    expect(index.entities.feature[0].environments).toBeUndefined();
    expect(detail.environments).toBeUndefined();
  });

  it("exports usage locations, test summaries, previews and report results", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));
    const base = createDatasource();
    const datasource = {
      ...base,
      listAttributes: async () => ["plan", "country", "userId", "legacyId"],
      readVariable: async () => ({
        key: "supportEmail",
        description: "Support email",
        type: "object",
        defaultValue: { email: "support@example.com", tier: "basic" },
        overrides: {
          staging: [
            {
              key: "premium",
              conditions: { or: ["premiumUsers"] },
              continue: true,
              mutate: { tier: "premium" },
            },
            {
              key: "dutch",
              conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
              mutate: { email: "nl@example.com" },
            },
            { key: "never", conditions: "premiumUsers", value: { email: "x", tier: "x" } },
          ],
          production: [],
        },
      }),
    };
    const runtime: CatalogRuntime = {
      ...createRuntime(),
      resolveOverrideValue: (_variable, override, value) =>
        override.mutate ? { ...value, ...override.mutate } : override.value,
    };
    const reportPath = path.join(root, "report.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 1,
        runner: "javascript",
        passed: false,
        summary: { entityAssertions: { passed: 0, failed: 1 } },
        errors: [],
        results: [
          {
            type: "feature",
            key: "checkout",
            source: "tests/checkout-primary.spec.yml",
            set: null,
            passed: false,
            cases: [
              {
                id: JSON.stringify([null, "feature", "checkout-primary", 0, null]),
                passed: false,
                errors: [
                  { message: "flag expectation did not match", expected: true, actual: false },
                ],
              },
            ],
          },
        ],
        coverage: {
          mode: "observed-selections",
          selections: [
            {
              set: null,
              environment: "staging",
              target: null,
              featureKey: "checkout",
              ruleKey: "rule",
            },
            {
              set: null,
              environment: "staging",
              target: null,
              variableKey: "supportEmail",
              overridePath: ["premium"],
            },
          ],
        },
      }),
    );

    await exportCatalog(runtime, root, createProjectConfig(root), datasource, {
      compactStorage: false,
      copyAssets: false,
      testReport: reportPath,
    });

    const read = (...parts: string[]) =>
      JSON.parse(fs.readFileSync(path.join(root, "catalog", "data", ...parts), "utf8"));
    const index = read("root", "index.json");
    const segment = read("root", "entities", "segment", "premiumUsers.json");
    const feature = read("root", "entities", "feature", "checkout.json");
    const variable = read("root", "entities", "variable", "supportEmail.json");
    const test = read("root", "entities", "test", "checkout-primary.json");

    expect(segment.usedBy).toEqual([
      { type: "feature", key: "checkout", locations: ["rules › staging › rule"] },
      {
        type: "variable",
        key: "supportEmail",
        locations: ["overrides › staging › premium (inside OR)", "overrides › staging › never"],
      },
    ]);
    expect(feature.usedBy).toBeUndefined();
    expect(feature.relationships).not.toHaveProperty("groups");
    expect(variable.accumulationPreview.staging).toEqual([
      {
        path: ["premium"],
        value: { email: "support@example.com", tier: "premium" },
        continues: true,
      },
      { path: ["dutch"], value: { email: "nl@example.com", tier: "premium" }, continues: false },
      { path: ["never"], skipped: true, continues: false },
    ]);
    expect(variable.observedOverrides).toBeUndefined();
    expect(feature.observedRules).toBeUndefined();
    expect(test.report).toMatchObject({
      verification: "unverified",
      passed: false,
      cases: [
        {
          assertionIndex: 0,
          passed: false,
          errors: [{ message: "flag expectation did not match" }],
        },
      ],
    });
    expect(
      index.entities.test.find((entity: any) => entity.key === "checkout-primary"),
    ).toMatchObject({
      testKind: "feature",
      testSubject: "checkout",
      assertionCount: 1,
    });
    expect(index.entities.variable[0]).toMatchObject({ variableType: "object", hasTests: true });
    expect(index.entities.test[0].testPassed).toBeUndefined();
    // Features and variables are counted once each, directly or through segments, and
    // bucketBy counts as a read.
    const usedByCount = (type: string, key: string) =>
      index.entities[type].find((entity: any) => entity.key === key).usedByCount;
    expect(usedByCount("segment", "premiumUsers")).toBe(2);
    // Only premiumUsers reads plan, and checkout and supportEmail both use premiumUsers.
    expect(usedByCount("attribute", "plan")).toBe(2);
    expect(usedByCount("attribute", "country")).toBe(2);
    expect(usedByCount("attribute", "userId")).toBe(1);
    expect(usedByCount("attribute", "legacyId")).toBe(0);
    expect(read("manifest.json").testReport).toMatchObject({
      runner: "javascript",
      passed: false,
      verification: "unverified",
    });
  });

  it("writes per-set catalog files for sets-enabled projects", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));
    const datasource = {
      ...createDatasource(),
      forSet: (set: string) => ({
        ...createDatasource(set),
        listScenarios: async () => ["scenarios.checkout-readiness.spec"],
        readScenario: async () => ({
          checks: [{ feature: `checkout.${set}`, enabled: true }],
        }),
      }),
    };

    await exportCatalog(createRuntime(), root, createProjectConfig(root, true), datasource, {
      compactStorage: false,
      copyAssets: false,
    });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "catalog", "data", "manifest.json"), "utf8"),
    );

    expect(manifest.sets).toBe(true);
    expect(manifest.setKeys).toEqual(["dev", "production"]);
    expect(
      fs.existsSync(
        path.join(
          root,
          "catalog",
          "data",
          "sets",
          "dev",
          "entities",
          "feature",
          "checkout.dev.json",
        ),
      ),
    ).toBe(true);

    const scenarioDetail = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          "catalog",
          "data",
          "sets",
          "dev",
          "entities",
          "test",
          "scenarios.checkout-readiness.spec.json",
        ),
        "utf8",
      ),
    );
    expect(scenarioDetail.sourcePath).toBe("sets/dev/tests/scenarios/checkout-readiness.spec.yml");
    expect(scenarioDetail.entity.assertions[0].checks).toEqual([
      { feature: "checkout.dev", enabled: true },
    ]);
    for (const set of ["dev", "production"]) {
      const segment = JSON.parse(
        fs.readFileSync(
          path.join(root, "catalog/data/sets", set, "entities/segment/premiumUsers.json"),
          "utf8",
        ),
      );
      expect(segment.relatedScenarios).toEqual([
        {
          key: "scenarios.checkout-readiness.spec",
          via: [{ type: "feature", key: `checkout.${set}` }],
        },
      ]);
    }
  });

  it("attaches variable checks and scenarios to every referenced entity", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));
    const baseDatasource = createDatasource();
    const datasource = {
      ...baseDatasource,
      listFeatures: async () => ["checkout", "pricing"],
      readFeature: async (featureKey: string) => ({
        ...(await baseDatasource.readFeature()),
        key: featureKey,
        variablesSchema:
          featureKey === "checkout"
            ? {
                theme: { type: "string", defaultValue: "light" },
              }
            : undefined,
      }),
      listVariables: async () => ["supportEmail", "backupEmail"],
      readVariable: async (key: string) => ({
        key,
        type: "string",
        defaultValue: `${key}@example.com`,
      }),
      listTests: async () => ["support-check"],
      readTest: async (key: string) => ({
        key,
        variable: "supportEmail",
        assertions: [
          {
            checks: [
              {
                operator: "equals",
                compareTo: { variable: "backupEmail" },
              },
            ],
            children: [
              {
                checks: [
                  {
                    feature: "checkout",
                    variable: "theme",
                    operator: "equals",
                    value: "light",
                  },
                ],
              },
            ],
          },
        ],
      }),
      listScenarios: async () => ["journeys.checkout-readiness.spec"],
      readScenario: async () => ({
        matrix: { variable: ["supportEmail"], feature: ["pricing"] },
        checks: [
          {
            feature: "checkout",
            enabled: true,
          },
        ],
        children: [
          {
            checks: [
              {
                and: [
                  {
                    variable: "${{ variable }}",
                    operator: "notEquals",
                    value: "",
                  },
                  {
                    feature: "${{ feature }}",
                    variation: "control",
                  },
                  {
                    feature: "checkout",
                    variable: "theme",
                    operator: "equals",
                    compareTo: { variable: "backupEmail" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    };

    await exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
      compactStorage: false,
      copyAssets: false,
    });

    const readDetail = (type: string, key: string) =>
      JSON.parse(
        fs.readFileSync(
          path.join(root, "catalog", "data", "root", "entities", type, `${key}.json`),
          "utf8",
        ),
      );
    const featureDetail = readDetail("feature", "checkout");
    const pricingDetail = readDetail("feature", "pricing");
    const supportDetail = readDetail("variable", "supportEmail");
    const backupDetail = readDetail("variable", "backupEmail");
    const scenarioDetail = readDetail("test", "journeys.checkout-readiness.spec");

    expect(featureDetail.relationships.tests).toEqual([
      "journeys.checkout-readiness.spec",
      "support-check",
    ]);
    expect(pricingDetail.relationships.tests).toEqual(["journeys.checkout-readiness.spec"]);
    expect(supportDetail.relationships.tests).toEqual([
      "journeys.checkout-readiness.spec",
      "support-check",
    ]);
    expect(backupDetail.relationships.tests).toEqual([
      "journeys.checkout-readiness.spec",
      "support-check",
    ]);
    expect(featureDetail.tests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scenario: "journeys.checkout-readiness.spec" }),
        expect.objectContaining({ variable: "supportEmail" }),
      ]),
    );
    const scenario = supportDetail.tests.find((test: any) => test.scenario);
    const variableTest = supportDetail.tests.find((test: any) => test.variable);
    expect(scenario.assertions[0].checks).toEqual([{ feature: "checkout", enabled: true }]);
    expect(scenario.assertions[0].children[0].checks).toBeDefined();
    expect(variableTest.assertions[0].checks).toBeDefined();
    expect(scenarioDetail.sourcePath).toBe("tests/journeys/checkout-readiness.spec.yml");
    expect(scenarioDetail.entity).toMatchObject({
      key: "journeys.checkout-readiness.spec",
      scenario: "journeys.checkout-readiness.spec",
      assertions: [
        expect.objectContaining({
          checks: [{ feature: "checkout", enabled: true }],
          children: [expect.objectContaining({ checks: expect.any(Array) })],
        }),
      ],
    });
  });

  it("uses datasource classification for arbitrary folders and duplicate basenames", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-scenario-"));
    const projectConfig = {
      ...createProjectConfig(root),
      namespaceCharacter: "/",
    };
    const baseDatasource = createDatasource();
    const entityKey = "scenarios/entity.spec";
    const scenarioKeys = ["quality/gate.spec", "release/gate.spec"];
    const datasource = {
      ...baseDatasource,
      listHistoryEntries: async () => [
        {
          commit: "scenario123456789",
          author: "Scenario Author",
          timestamp: "2026-02-01T00:00:00.000Z",
          entities: [{ type: "scenario", key: scenarioKeys[0] }],
        },
      ],
      listFeatures: async () => ["checkout", "pricing"],
      readFeature: async (featureKey: string) => ({
        ...(await baseDatasource.readFeature()),
        key: featureKey,
      }),
      listTests: async () => [entityKey],
      readTest: async () => ({
        feature: "checkout",
        assertions: [{ expectedToBeEnabled: true }],
      }),
      listScenarios: async () => scenarioKeys,
      readScenario: async (key: string) => ({
        promotable: false,
        description: `Validate ${key} with ` + "${{ feature }} and ${{ variable }}",
        matrix: {
          feature: ["pricing"],
          variable: ["supportEmail"],
        },
        checks: [{ feature: "${{ feature }}", variation: "control" }],
        children: [
          {
            checks: [
              {
                variable: "${{ variable }}",
                operator: "notEquals",
                value: "",
              },
              { feature: "checkout", enabled: true },
            ],
          },
        ],
      }),
    };

    await exportCatalog(createRuntime(), root, projectConfig, datasource, {
      compactStorage: false,
      copyAssets: false,
    });

    const readDetail = (type: string, entityKey: string) =>
      JSON.parse(
        fs.readFileSync(
          path.join(root, "catalog", "data", "root", "entities", type, `${entityKey}.json`),
          "utf8",
        ),
      );
    const checkoutDetail = readDetail("feature", "checkout");
    const pricingDetail = readDetail("feature", "pricing");
    const variableDetail = readDetail("variable", "supportEmail");
    const testDetail = readDetail("test", entityKey);
    const scenarioDetail = readDetail("test", scenarioKeys[0]);
    const secondScenarioDetail = readDetail("test", scenarioKeys[1]);
    const index = JSON.parse(
      fs.readFileSync(path.join(root, "catalog", "data", "root", "index.json"), "utf8"),
    );

    expect(index.counts.test).toBe(3);
    expect(index.entities.test).toEqual([
      expect.objectContaining({
        key: scenarioKeys[0],
        href: `entities/test/${scenarioKeys[0]}.json`,
      }),
      expect.objectContaining({
        key: scenarioKeys[1],
        href: `entities/test/${scenarioKeys[1]}.json`,
      }),
      expect.objectContaining({ key: entityKey, href: `entities/test/${entityKey}.json` }),
    ]);
    expect(checkoutDetail.relationships.tests).toEqual([...scenarioKeys, entityKey]);
    expect(checkoutDetail.tests).toHaveLength(3);
    expect(checkoutDetail.tests.map((test: any) => test.key)).toEqual([...scenarioKeys, entityKey]);
    expect(checkoutDetail.tests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ feature: "checkout" }),
        expect.objectContaining({ scenario: scenarioKeys[0] }),
        expect.objectContaining({ scenario: scenarioKeys[1] }),
      ]),
    );
    expect(pricingDetail.tests).toEqual(
      scenarioKeys.map((scenario) => expect.objectContaining({ scenario })),
    );
    expect(variableDetail.tests).toEqual(
      scenarioKeys.map((scenario) => expect.objectContaining({ scenario })),
    );
    expect(testDetail.sourcePath).toBe("tests/scenarios/entity.spec.yml");
    expect(scenarioDetail.sourcePath).toBe("tests/quality/gate.spec.yml");
    expect(secondScenarioDetail.sourcePath).toBe("tests/release/gate.spec.yml");
    expect(scenarioDetail.lastModified).toEqual({
      commit: "scenario123456789",
      author: "Scenario Author",
      timestamp: "2026-02-01T00:00:00.000Z",
    });
    expect(scenarioDetail.historyPath).toBe("data/root/entity-history/test/quality/gate.spec");
    const scenarioHistory = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          "catalog",
          "data",
          "root",
          "entity-history",
          "test",
          "quality",
          "gate.spec",
          "page-1.json",
        ),
        "utf8",
      ),
    );
    expect(scenarioHistory.entries).toEqual([
      expect.objectContaining({ commit: "scenario123456789" }),
    ]);
    expect(scenarioDetail.entity).toMatchObject({
      key: scenarioKeys[0],
      scenario: scenarioKeys[0],
      promotable: false,
      assertions: [
        {
          description: "Validate quality/gate.spec with ${{ feature }} and ${{ variable }}",
          matrix: { feature: ["pricing"], variable: ["supportEmail"] },
          checks: [{ feature: "${{ feature }}", variation: "control" }],
          children: [
            {
              checks: expect.arrayContaining([
                expect.objectContaining({ variable: "${{ variable }}" }),
                expect.objectContaining({ feature: "checkout", enabled: true }),
              ]),
            },
          ],
        },
      ],
    });
  });

  it("uses the normalized entity test key for catalog IDs while retaining the source filename", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-test-id-"));
    try {
      const key = "scenarios.pricing-entity";
      const datasource = {
        ...createDatasource(),
        listTests: async () => [key],
        readTest: async () => ({
          feature: "checkout",
          assertions: [{ expectedToBeEnabled: true }],
        }),
      };
      await exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
        compactStorage: false,
        copyAssets: false,
      });
      const detail = JSON.parse(
        fs.readFileSync(
          path.join(root, "catalog", "data", "root", "entities", "test", `${key}.json`),
          "utf8",
        ),
      );
      expect(detail.key).toBe(key);
      expect(detail.entity.key).toBe(key);
      expect(detail.sourcePath).toBe("tests/scenarios/pricing-entity.spec.yml");
      expect(detail.historyPath).toBe(`data/root/entity-history/test/${key}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an invalid mixed root in the datasource entity test classification", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-mixed-test-"));
    const key = "scenarios.invalid.spec";
    const readScenario = jest.fn();
    const datasource = {
      ...createDatasource(),
      listTests: async () => [key],
      readTest: async () => ({
        feature: "checkout",
        checks: [{ feature: "checkout", enabled: true }],
      }),
      listScenarios: async () => [],
      readScenario,
    };

    await exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
      compactStorage: false,
      copyAssets: false,
    });

    const detail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "test", `${key}.json`),
        "utf8",
      ),
    );
    expect(readScenario).not.toHaveBeenCalled();
    expect(detail.sourcePath).toBe("tests/scenarios/invalid.spec.yml");
    expect(detail.entity).toEqual({
      key,
      feature: "checkout",
      checks: [{ feature: "checkout", enabled: true }],
    });
  });

  it("writes slash-namespaced entity details as nested data paths", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));
    const projectConfig = {
      ...createProjectConfig(root),
      namespaceCharacter: "/",
    };
    const baseDatasource = createDatasource();
    const featureKey = "checkout/redesign";
    const variableKey = "checkout/supportEmail";
    const datasource = {
      ...baseDatasource,
      listHistoryEntries: async () => [
        {
          commit: "root123456789",
          author: "Test",
          timestamp: "2026-01-01T00:00:00.000Z",
          entities: [{ type: "feature", key: featureKey }],
        },
      ],
      listFeatures: async () => [featureKey],
      readFeature: async () => ({
        ...(await baseDatasource.readFeature()),
        key: featureKey,
      }),
      listVariables: async () => [variableKey],
      readVariable: async () => ({
        key: variableKey,
        type: "string",
        defaultValue: "checkout@example.com",
      }),
      listTests: async () => [
        "features/checkout/redesign.spec",
        "variables/checkout/supportEmail.spec",
      ],
      readTest: async (key: string) =>
        key.startsWith("variables/")
          ? { key, variable: variableKey, assertions: [] }
          : { key, feature: featureKey, assertions: [] },
    };

    await exportCatalog(createRuntime(), root, projectConfig, datasource, {
      compactStorage: false,
      copyAssets: false,
    });

    const nestedDetailPath = path.join(
      root,
      "catalog",
      "data",
      "root",
      "entities",
      "feature",
      "checkout",
      "redesign.json",
    );
    const legacyFlatDetailPath = path.join(
      root,
      "catalog",
      "data",
      "root",
      "entities",
      "feature",
      "checkout%2Fredesign.json",
    );
    const detail = JSON.parse(fs.readFileSync(nestedDetailPath, "utf8"));
    const index = JSON.parse(
      fs.readFileSync(path.join(root, "catalog", "data", "root", "index.json"), "utf8"),
    );

    expect(fs.existsSync(legacyFlatDetailPath)).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          root,
          "catalog",
          "data",
          "root",
          "entity-history",
          "feature",
          "checkout",
          "redesign",
          "page-1.json",
        ),
      ),
    ).toBe(true);
    expect(index.entities.feature[0].key).toBe(featureKey);
    expect(index.entities.feature[0].href).toBe("entities/feature/checkout/redesign.json");
    expect(detail.sourcePath).toBe("features/checkout/redesign.yml");
    expect(detail.historyPath).toBe("data/root/entity-history/feature/checkout/redesign");
    expect(
      fs.existsSync(
        path.join(
          root,
          "catalog",
          "data",
          "root",
          "entities",
          "variable",
          "checkout",
          "supportEmail.json",
        ),
      ),
    ).toBe(true);
    expect(index.entities.variable[0]).toEqual(
      expect.objectContaining({
        key: variableKey,
        href: "entities/variable/checkout/supportEmail.json",
      }),
    );
  });

  it("exports precise transitive schema and target relationships", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));
    const baseDatasource = createDatasource();
    const datasource = {
      ...baseDatasource,
      listFeatures: async () => ["checkout", "archivedCheckout"],
      readFeature: async (key: string) =>
        key === "archivedCheckout"
          ? {
              key,
              description: "Archived checkout",
              archived: true,
              tags: ["web", "premium"],
              bucketBy: "userId",
              rules: [],
            }
          : {
              ...(await baseDatasource.readFeature()),
              variablesSchema: {
                payload: { schema: "outer", defaultValue: {} },
              },
            },
      listSchemas: async () => ["outer", "inner", "unused"],
      readSchema: async (key: string) =>
        key === "outer"
          ? { description: "Outer", type: "object", properties: { value: { schema: "inner" } } }
          : { description: key, type: "string" },
      readVariable: async () => ({
        key: "supportEmail",
        description: "Support email",
        tags: ["web", "premium"],
        schema: "outer",
        defaultValue: { schema: "unused" },
      }),
    };

    await exportCatalog(createRuntime(), root, createProjectConfig(root), datasource, {
      compactStorage: false,
      copyAssets: false,
    });

    const featureDetail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "feature", "checkout.json"),
        "utf8",
      ),
    );
    const variableDetail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "variable", "supportEmail.json"),
        "utf8",
      ),
    );
    const archivedDetail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "feature", "archivedCheckout.json"),
        "utf8",
      ),
    );

    expect(featureDetail.relationships.schemas).toEqual(["inner", "outer"]);
    expect(variableDetail.relationships.schemas).toEqual(["inner", "outer"]);
    expect(variableDetail.relationships.schemas).not.toContain("unused");
    expect(archivedDetail.relationships.targets).toEqual([]);
  });

  it("exports repository source links and dev editor links", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));

    git(root, ["init"]);
    git(root, ["checkout", "-b", "catalog-test"]);
    git(root, ["remote", "add", "origin", "git@github.com:featurevisor/featurevisor.git"]);

    await exportCatalog(createRuntime(), root, createProjectConfig(root), createDatasource(), {
      compactStorage: false,
      copyAssets: false,
      dev: true,
      devEditors: [{ id: "cursor", label: "Cursor" }],
    });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "catalog", "data", "manifest.json"), "utf8"),
    );
    const detail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "feature", "checkout.json"),
        "utf8",
      ),
    );

    expect(manifest.links).toEqual({
      provider: "github",
      repository: "https://github.com/featurevisor/featurevisor",
      source: "https://github.com/featurevisor/featurevisor/blob/catalog-test/{{path}}",
      edit: "https://github.com/featurevisor/featurevisor/edit/catalog-test/{{path}}",
      branch: "catalog-test",
      branchKind: "checkout",
      commit: "https://github.com/featurevisor/featurevisor/commit/{{hash}}",
    });
    expect(manifest.dev.editors).toEqual([{ id: "cursor", label: "Cursor" }]);
    expect(detail.sourcePath).toBe("features/checkout.yml");
    expect(detail.editLinks.cursor).toMatch(/^cursor:\/\/file\/.+features\/checkout\.yml$/);
  });

  it("links to origin's default branch rather than the checked out branch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));

    git(root, ["init"]);
    git(root, ["checkout", "-b", "feature-work"]);
    git(root, ["remote", "add", "origin", "https://gitlab.com/acme/flags.git"]);
    git(root, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);

    await exportCatalog(createRuntime(), root, createProjectConfig(root), createDatasource(), {
      compactStorage: false,
      copyAssets: false,
    });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "catalog", "data", "manifest.json"), "utf8"),
    );

    expect(manifest.links).toMatchObject({
      provider: "gitlab",
      source: "https://gitlab.com/acme/flags/-/blob/main/{{path}}",
      edit: "https://gitlab.com/acme/flags/-/edit/main/{{path}}",
      branch: "main",
      branchKind: "default",
    });
  });

  it("uses an explicit branch, and links a detached checkout to its commit without guessing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));
    git(root, ["init"]);
    git(root, ["remote", "add", "origin", "https://github.com/acme/flags.git"]);
    fs.writeFileSync(path.join(root, "README.md"), "flags\n");
    git(root, ["add", "."]);
    git(root, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "Initial",
    ]);
    const head = childProcess
      .execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })
      .trim();
    // A CI checkout: detached, with no origin HEAD and no local branch to fall back on.
    git(root, ["checkout", "-q", "--detach"]);
    const readLinks = async (options: { branch?: string }) => {
      await exportCatalog(createRuntime(), root, createProjectConfig(root), createDatasource(), {
        compactStorage: false,
        copyAssets: false,
        ...options,
      });
      return JSON.parse(
        fs.readFileSync(path.join(root, "catalog", "data", "manifest.json"), "utf8"),
      ).links;
    };

    const detached = await readLinks({});
    expect(detached.source).toBe(`https://github.com/acme/flags/blob/${head}/{{path}}`);
    expect(detached).not.toHaveProperty("edit");
    expect(detached).not.toHaveProperty("branch");

    expect(await readLinks({ branch: "release/2026 #1" })).toMatchObject({
      source: "https://github.com/acme/flags/blob/release/2026%20%231/{{path}}",
      edit: "https://github.com/acme/flags/edit/release/2026%20%231/{{path}}",
      branch: "release/2026 #1",
      branchKind: "configured",
    });
  });

  it.each([
    { feature: "account" },
    { or: [{ feature: "account" }, { not: [{ feature: "authenticated" }] }] },
  ])("projects global variable dependencies into target relationships: %j", async (requirement) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-variable-target-"));
    const baseDatasource = createDatasource();
    const datasource = {
      ...baseDatasource,
      listFeatures: async () => ["checkout", "account", "authenticated"],
      readFeature: async (key: string) => {
        if (key === "account") {
          return {
            key,
            description: "Account",
            tags: ["mobile"],
            conditions: [
              { feature: "authenticated" },
              { variable: "supportEmail", operator: "notNull" },
              {
                feature: "checkout",
                variable: "message",
                operator: "exists",
              },
            ],

            bucketBy: "userId",
            rules: { staging: [], production: [] },
          };
        }
        if (key === "authenticated") {
          return {
            key,
            description: "Authenticated",
            tags: ["mobile"],
            bucketBy: "userId",
            rules: { staging: [], production: [] },
          };
        }
        return baseDatasource.readFeature();
      },
      readVariable: async () => ({
        key: "supportEmail",
        description: "Support email",
        tags: ["web", "premium"],
        type: "string",
        defaultValue: "support@example.com",
        conditions: [requirement],
        overrides: {
          staging: [
            {
              key: "premium",
              conditions: "premiumUsers",
              value: "premium@example.com",
              overrides: [
                {
                  key: "enterprise",
                  conditions: [
                    { attribute: "plan", operator: "equals", value: "enterprise" },
                    { feature: "authenticated" },
                  ],

                  value: "enterprise@example.com",
                },
              ],
            },
            {
              key: "netherlands",
              conditions: [
                { attribute: "country", operator: "equals", value: "nl" },
                { feature: "account" },
              ],

              value: "nl@example.com",
            },
          ],
          production: [],
        },
      }),
    };

    await exportCatalog(
      createRuntime({
        premiumWeb: {
          features: ["account", "authenticated", "checkout"],
          variables: ["supportEmail"],
        },
        mobile: { features: ["account", "authenticated"], variables: [] },
      }),
      root,
      createProjectConfig(root),
      datasource,
      { compactStorage: false, copyAssets: false },
    );

    const targetDetail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "target", "premiumWeb.json"),
        "utf8",
      ),
    );
    const accountDetail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "feature", "account.json"),
        "utf8",
      ),
    );
    const checkoutDetail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "feature", "checkout.json"),
        "utf8",
      ),
    );
    const variableDetail = JSON.parse(
      fs.readFileSync(
        path.join(root, "catalog", "data", "root", "entities", "variable", "supportEmail.json"),
        "utf8",
      ),
    );

    expect(targetDetail.relationships.features).toEqual(["account", "authenticated", "checkout"]);
    expect(targetDetail.relationships.variables).toEqual(["supportEmail"]);
    expect(accountDetail.relationships.targets).toEqual(["mobile", "premiumWeb"]);
    expect(accountDetail.relationships.requiredVariables).toEqual(["supportEmail"]);
    expect(accountDetail.relationships.requiredFeatures).toEqual(["authenticated", "checkout"]);
    expect(checkoutDetail.relationships.requiredBy).toEqual(["account"]);
    expect(variableDetail.relationships.features).toEqual(["account", "authenticated", "checkout"]);
    expect(variableDetail.relationships.requiredByFeatures).toEqual(["account"]);
    expect(variableDetail.relationships.segments).toEqual(["premiumUsers"]);
    expect(variableDetail.relationships.attributes).toEqual(["country", "plan"]);
  });

  it("uses Core's canonical mixed dependency closure for Target memberships", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-target-closure-"));
    const baseDatasource = createDatasource();
    const datasource = {
      ...baseDatasource,
      listTargets: async () => ["chain"],
      readTarget: async () => ({
        includeFeatures: ["excluded"],
        includeVariables: ["a"],
        excludeVariables: ["b", "d"],
      }),
      listFeatures: async () => ["c", "excluded"],
      readFeature: async (key: string) => ({
        key,
        description: key,
        bucketBy: "userId",
        variablesSchema: key === "c" ? { config: { type: "string", defaultValue: "ok" } } : {},
        conditions: key === "c" ? [{ variable: "d", operator: "notNull" }] : undefined,
        rules: { staging: [], production: [] },
      }),
      listVariables: async () => ["a", "b", "d"],
      readVariable: async (key: string) => ({
        key,
        type: "string",
        defaultValue: key,
        conditions:
          key === "a"
            ? [{ variable: "b", operator: "notNull" }]
            : key === "b"
              ? [{ feature: "c", variable: "config", operator: "notNull" }]
              : undefined,
      }),
    };
    const getCatalogTargetMemberships = jest.fn(async () => ({
      chain: { features: ["c"], variables: ["a", "b", "d"], segments: ["fromDatafile"] },
    }));
    const runtime: CatalogRuntime = {
      ...createRuntime(),
      getCatalogTargetMemberships,
    };

    try {
      await exportCatalog(runtime, root, createProjectConfig(root), datasource, {
        compactStorage: false,
        copyAssets: false,
      });
      const readDetail = (type: string, key: string) =>
        JSON.parse(
          fs.readFileSync(
            path.join(root, "catalog", "data", "root", "entities", type, `${key}.json`),
            "utf8",
          ),
        );

      expect(getCatalogTargetMemberships).toHaveBeenCalledWith(
        expect.objectContaining({ catalogDirectoryPath: path.join(root, "catalog") }),
        expect.objectContaining({
          readFeature: expect.any(Function),
          listFeatures: expect.any(Function),
        }),
      );
      // Segments come from Core's datafile when it reports them.
      expect(readDetail("target", "chain").relationships).toEqual({
        features: ["c"],
        variables: ["a", "b", "d"],
        segments: ["fromDatafile"],
      });
      expect(readDetail("feature", "c").relationships.targets).toEqual(["chain"]);
      expect(readDetail("feature", "excluded").relationships.targets).toEqual([]);
      expect(readDetail("variable", "d").relationships.targets).toEqual(["chain"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("exports direct and indirect dependencies through segment and feature chains", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-dependencies-"));
    const segments: Record<string, unknown> = {
      region: [{ attribute: "country", operator: "in", value: ["nl", "de"] }],
      regionalPro: ["region", { attribute: "plan", operator: "equals", value: "pro" }],
      notRegional: { not: ["regionalPro"] },
      readsBeta: [{ feature: "beta", variation: "on" }],
      deadEnd: ["region"],
      deadStart: ["deadEnd"],
    };
    const features: Record<string, Record<string, unknown>> = {
      backend: {
        deprecated: true,
        rules: { staging: [{ key: "eu", conditions: "region", percentage: 100 }], production: [] },
      },
      beta: {
        conditions: [{ feature: "backend" }],
        variablesSchema: { label: { type: "string", defaultValue: "Label" } },
        variations: [
          { value: "off", weight: 50 },
          { value: "on", weight: 50 },
        ],
        rules: {
          staging: [{ key: "all", conditions: "notRegional", percentage: 100 }],
          production: [],
        },
      },
      banner: {
        conditions: { or: ["readsBeta"] },
        rules: { staging: [], production: [] },
      },
    };
    const datasource = {
      ...createDatasource(),
      listSegments: async () => Object.keys(segments),
      readSegment: async (key: string) => ({ key, conditions: segments[key] }),
      listFeatures: async () => Object.keys(features),
      readFeature: async (key: string) => ({
        key,
        description: key,
        bucketBy: "userId",
        ...features[key],
      }),
      listVariables: async () => ["copy"],
      readVariable: async () => ({
        key: "copy",
        type: "object",
        compose: { label: { feature: "beta", variable: "label" } },
      }),
      listAttributes: async () => ["country", "plan", "userId"],
      listTargets: async () => ["app"],
      readTarget: async () => ({ includeFeatures: ["banner"] }),
    };
    const runtime: CatalogRuntime = {
      ...createRuntime(),
      getCatalogTargetMemberships: async () => ({
        app: {
          features: ["backend", "banner", "beta"],
          variables: [],
          segments: ["readsBeta", "region"],
          dependencyFeatures: ["backend", "beta"],
        },
      }),
    };

    try {
      await exportCatalog(runtime, root, createProjectConfig(root), datasource, {
        compactStorage: false,
        copyAssets: false,
      });
      const read = (...parts: string[]) =>
        JSON.parse(fs.readFileSync(path.join(root, "catalog", "data", "root", ...parts), "utf8"));
      const detail = (type: string, key: string) => read("entities", type, `${key}.json`);
      const chains = (entries: Array<{ type: string; key: string; via: Array<{ key: string }> }>) =>
        Object.fromEntries(
          entries.map((entry) => [`${entry.type}:${entry.key}`, entry.via.map((step) => step.key)]),
        );
      const index = read("index.json");
      const summary = (type: string, key: string) =>
        index.entities[type].find((entity: any) => entity.key === key);
      // Pages work out dependencies from each detail and the index's direct references.
      const dependencies = (type: string, key: string) =>
        getEntityDependencies(detail(type, key), index);

      expect(summary("feature", "banner").references).toEqual([
        "attribute:userId",
        "segment:readsBeta",
      ]);
      expect(summary("segment", "readsBeta").references).toEqual(["feature:beta"]);

      // Users reached through other entities, each with the shortest chain.
      expect(chains(dependencies("segment", "region").usedIndirectlyBy)).toEqual({
        "feature:banner": ["readsBeta", "beta", "backend"],
        "feature:beta": ["backend"],
        "variable:copy": ["beta", "backend"],
        "segment:deadStart": ["deadEnd"],
        "segment:notRegional": ["regionalPro"],
        "segment:readsBeta": ["beta", "backend"],
      });
      expect(detail("segment", "region").usedBy.map((entry: any) => entry.key)).toEqual([
        "backend",
        "deadEnd",
        "regionalPro",
      ]);

      // What banner refers to, and what it reaches through those.
      expect(dependencies("feature", "banner").uses).toEqual([
        { type: "segment", key: "readsBeta", locations: ["conditions (inside OR)"] },
        { type: "attribute", key: "userId", locations: ["bucketBy"] },
      ]);
      expect(chains(dependencies("feature", "banner").usesIndirectly)).toMatchObject({
        "feature:beta": ["readsBeta"],
        "feature:backend": ["readsBeta", "beta"],
        "segment:region": ["readsBeta", "beta", "backend"],
        "attribute:country": ["readsBeta", "beta", "backend", "region"],
      });

      // Checks record what each reference reads, for "Checked by" and "Read by".
      expect(detail("feature", "beta").usedBy).toEqual([
        {
          type: "variable",
          key: "copy",
          locations: ["compose label"],
          checks: [{ location: "compose label", compose: { variable: "label" } }],
        },
        {
          type: "segment",
          key: "readsBeta",
          locations: ["conditions"],
          checks: [{ location: "conditions", condition: { feature: "beta", variation: "on" } }],
        },
      ]);

      // Counts and unused status follow features and variables, never unused segments.
      expect(summary("segment", "region")).toMatchObject({
        usedInFeatureCount: 3,
        usedInVariableCount: 1,
        usedByCount: 4,
      });
      expect(summary("segment", "deadEnd").usedByCount).toBe(0);
      expect(summary("segment", "deadStart").usedByCount).toBe(0);
      expect(summary("attribute", "plan").usedByCount).toBe(3);
      expect(summary("feature", "banner").dependsOnDeprecated).toBe(true);
      expect(summary("feature", "backend").dependsOnDeprecated).toBeUndefined();
      expect(summary("feature", "backend")).toMatchObject({
        usedInFeatureCount: 2,
        usedInVariableCount: 1,
      });

      // The Target says why it holds what it did not select.
      expect(detail("target", "app").contentPulledIn).toEqual({
        "feature:backend": [
          { type: "feature", key: "banner" },
          { type: "segment", key: "readsBeta" },
          { type: "feature", key: "beta" },
        ],
        "feature:beta": [
          { type: "feature", key: "banner" },
          { type: "segment", key: "readsBeta" },
        ],
      });
      expect(detail("target", "app").contentRequiredBy).toEqual({
        "feature:backend": [{ type: "feature", key: "beta" }],
        "feature:beta": [{ type: "feature", key: "banner" }],
      });
      // Segments have many owners, so pages find them in the index, through segments only.
      expect(getNearestOwners(index, { type: "segment", key: "region" })).toEqual([
        { type: "feature", key: "backend" },
        { type: "feature", key: "beta" },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails clearly when Core omits canonical membership for a Target", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-target-missing-"));

    try {
      await expect(
        exportCatalog(createRuntime({}), root, createProjectConfig(root), createDatasource(), {
          compactStorage: false,
          copyAssets: false,
        }),
      ).rejects.toThrow(
        'Catalog runtime did not return canonical membership for Target "premiumWeb".',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Catalog server host check", () => {
  it.each([
    "127.0.0.1:3000",
    "localhost:3000",
    "LOCALHOST",
    "app.localhost:3000",
    "[::1]:3000",
    "127.0.0.2",
  ])("accepts loopback host %s", (host) => expect(isLoopbackHost(host)).toBe(true));

  it.each([
    undefined,
    "",
    "evil.example:3000",
    "127.0.0.1.evil.example",
    "localhost.evil.example",
    "[::2]:3000",
  ])("rejects host %s", (host) => expect(isLoopbackHost(host)).toBe(false));
});
