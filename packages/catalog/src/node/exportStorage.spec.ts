import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { createCatalogDevSession, exportCatalog, type CatalogRuntime } from ".";
import { decodeCatalogIndex } from "../indexCodec";
import {
  readCatalogStorageEntry,
  resolveCatalogStorage,
  type CatalogStorageDescriptor,
} from "../storage";
import type { Test } from "@featurevisor/types";
import type { CatalogManifest, EntityDetail } from "../types";
import { expandTestAssertions, findTestReportCase, getTestReportCoverage } from "../testModel";
import * as api from "../api";

type Manifest = CatalogManifest & { storage?: CatalogStorageDescriptor };

const featureKey = "checkout/cart v2%é";
const variableKey = "checkout/support.email";
const scenarioKey = "scenarios/cart.ready.spec";

function config(root: string, sets: boolean, set = "") {
  const base = set ? path.join(root, "sets", set) : root;
  return {
    sets,
    tags: ["web"],
    environments: ["staging", "production"],
    namespaceCharacter: "/",
    catalogDirectoryPath: path.join(root, "catalog"),
    setsDirectoryPath: path.join(root, "sets"),
    ...Object.fromEntries(
      ["features", "segments", "attributes", "targets", "schemas", "variables", "tests"].map(
        (type) => [`${type}DirectoryPath`, path.join(base, type)],
      ),
    ),
  };
}

function fixture(root: string, setKeys: string[] = []) {
  const sets = new Map<string, ReturnType<typeof createDatasource>>();
  function createDatasource(set: string) {
    const features = new Map([
      [
        featureKey,
        {
          key: featureKey,
          description: `Cart in ${set || "root"}`,
          tags: ["web"],
          bucketBy: "userId",
          rules: {
            staging: [
              { key: "premium", conditions: "audience/premium", enabled: true, percentage: 100 },
            ],
            production: [],
          },
        },
      ],
    ]);
    return {
      features,
      getSet: () => set,
      getExtension: () => "yml",
      listSets: async () => [...sets.keys()],
      forSet: (key: string) => sets.get(key)!,
      listHistoryEntries: jest.fn(async () =>
        Array.from({ length: 55 }, (_, index) => ({
          commit: `${set || "root"}-${index}`,
          author: "Catalog tests",
          subject: `Change ${index}`,
          timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
          entities: [{ type: "feature", key: featureKey }],
        })),
      ),
      listFeatures: jest.fn(async () => [...features.keys()]),
      readFeature: jest.fn(async (key: string) => features.get(key)!),
      listVariables: jest.fn(async () => [variableKey]),
      readVariable: jest.fn(async () => ({
        key: variableKey,
        type: "string",
        tags: ["web"],
        defaultValue: "support@example.test",
        overrides: {
          staging: [
            { key: "premium", conditions: "audience/premium", value: "premium@example.test" },
          ],
          production: [],
        },
      })),
      listSegments: async () => ["audience/premium"],
      readSegment: async () => ({
        key: "audience/premium",
        conditions: [{ attribute: "plan", operator: "equals", value: "premium" }],
      }),
      listAttributes: async () => ["plan"],
      readAttribute: async () => ({ key: "plan", type: "string" }),
      listTargets: async () => ["web", "mobile"],
      readTarget: async (key: string) => ({ key, tag: "web" }),
      listSchemas: async () => ["cart/schema"],
      readSchema: async () => ({
        key: "cart/schema",
        type: "object",
        properties: { value: { type: "string" } },
      }),
      listTests: async () => ["tests/cart.spec"],
      readTest: async () => ({
        feature: featureKey,
        assertions: [{ environment: "staging", expectedToBeEnabled: true }],
      }),
      listScenarios: async () => [scenarioKey],
      readScenario: async () => ({
        checks: [
          { feature: featureKey, enabled: true },
          { variable: variableKey, value: "support@example.test" },
        ],
      }),
    };
  }
  for (const set of setKeys) sets.set(set, createDatasource(set));
  const datasource = createDatasource("");
  const projectConfig = config(root, setKeys.length > 0);
  const runtime: CatalogRuntime = {
    getProjectSetExecutions: async () =>
      projectConfig.sets
        ? [...sets].map(([set, datasource]) => ({
            set,
            projectConfig: config(root, true, set),
            datasource,
          }))
        : [{ set: "", projectConfig, datasource }],
    getCatalogTargetMemberships: jest.fn(async (configuration, source) => {
      const memberships: Record<string, { features: string[]; variables: string[] }> = {};
      for (const target of await source.listTargets()) {
        for (let build = 0; build < configuration.environments.length; build++) {
          // Like Core's builder: definitions are read for every Target and environment.
          for (const key of await source.listFeatures()) await source.readFeature(key);
        }
        memberships[target] = {
          features: await source.listFeatures(),
          variables: await source.listVariables(),
        };
      }
      return memberships;
    }),
  };
  return { datasource, projectConfig, runtime, sets };
}

function readJSON(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readLogical(output: string, manifest: Manifest, logical: string): any {
  const resolution = resolveCatalogStorage(manifest.storage, logical);
  if (!resolution) throw new Error(`Unresolved logical document: ${logical}`);
  const segments = resolution.blockURL.split("/");
  if (!manifest.storage && segments[1] === "sets") segments[2] = decodeURIComponent(segments[2]);
  const block = readJSON(path.join(output, ...segments));
  const value = readCatalogStorageEntry(block, resolution);
  if (value === undefined) throw new Error(`Missing logical document: ${logical}`);
  return logical.endsWith("/index.json") ? decodeCatalogIndex(value) : value;
}

function logicalDocuments(output: string, manifest: Manifest): Record<string, unknown> {
  const keys = new Set<string>();
  if (manifest.storage) {
    Object.keys(manifest.storage.documents).forEach((key) => keys.add(key));
    for (const ranges of Object.values(manifest.storage.groups)) {
      for (const range of ranges) {
        const block = readJSON(path.join(output, range.blockURL));
        const documents = Object.prototype.hasOwnProperty.call(block, "$catalogHistory")
          ? block.pages
          : block;
        Object.keys(documents).forEach((key) => keys.add(key));
      }
    }
  } else {
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.name.endsWith(".json") && entry.name !== "manifest.json") {
          const segments = path.relative(output, file).split(path.sep);
          if (segments[1] === "sets") segments[2] = encodeURIComponent(segments[2]);
          keys.add(segments.join("/"));
        }
      }
    };
    visit(path.join(output, "data"));
  }
  return Object.fromEntries(
    [...keys].sort().map((key) => [key, readLogical(output, manifest, key)]),
  );
}

function manifestContent(manifest: Manifest) {
  const result = { ...manifest } as Partial<Manifest>;
  delete result.generatedAt;
  delete result.storage;
  return result;
}

/** The leading sentence of a current report status. */
function coveragePhrase(executed: number, total: number, failed: number) {
  if (executed < total) return `${executed} of ${total} cases in report`;
  return failed ? `${total - failed} passed, ${failed} failed` : `${total} cases passed`;
}

function historicalPhrase(verification: string) {
  return verification === "stale"
    ? "Inputs changed since that report"
    : "Report inputs could not be verified";
}

function storageScope(manifest: Manifest, set: string) {
  const prefix = `data/sets/${encodeURIComponent(set)}/`;
  return {
    documents: Object.fromEntries(
      Object.entries(manifest.storage!.documents).filter(([key]) => key.startsWith(prefix)),
    ),
    groups: Object.fromEntries(
      Object.entries(manifest.storage!.groups).filter(([key]) => key.startsWith(prefix)),
    ),
  };
}

describe("Catalog export storage integration", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-export-storage-"));
  });
  afterEach(() => {
    api.setCatalogStorage(undefined);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([{ names: [] }, { names: ["release β"] }])(
    "separates history from slash namespace details in $names",
    async ({ names }) => {
      const source = fixture(root, names);
      const datasource = names.length ? source.sets.get(names[0])! : source.datasource;
      const keys = [
        "checkout",
        "checkout/history/page-1",
        "checkout/history/page-1/history/page-2",
        "history/page-1",
        "details/history/page-1",
      ];
      for (const key of keys)
        datasource.features.set(key, { ...datasource.features.get(featureKey)!, key });
      const exported = await exportCatalog(
        source.runtime,
        root,
        source.projectConfig,
        source.datasource,
        { copyAssets: false, compactStorage: true },
      );
      api.setCatalogStorage(exported.manifest.storage);
      api.setCatalogCacheTtl(0);
      jest.spyOn(global, "fetch").mockImplementation(
        async (url) =>
          ({
            ok: true,
            status: 200,
            headers: { get: () => "application/json" },
            json: async () =>
              readJSON(path.join(exported.outputDirectoryPath, String(url).replace(/^\//, ""))),
          }) as any,
      );
      for (const key of keys) {
        const detail = await api.fetchEntityDetail("feature", key, names[0]);
        expect(detail.key).toBe(key);
        expect(detail.historyPath).toContain("/entity-history/feature/");
        expect(await api.fetchHistoryPage(detail.historyPath!, 1)).toMatchObject({
          entries: [],
          page: 1,
        });
      }
      const original = await api.fetchEntityDetail("feature", featureKey, names[0]);
      expect((await api.fetchHistoryPage(original.historyPath!, 1)).entries).toHaveLength(50);
      expect((await api.fetchHistoryPage(original.historyPath!, 2)).entries).toHaveLength(5);
    },
  );

  it.each([
    { names: [] },
    { names: ["dev.eu", "production"] },
    { names: ["qa space", "team%blue"] },
  ])(
    "preserves every logical document between legacy and compact exports for sets $names",
    async ({ names }) => {
      const { runtime, datasource, projectConfig } = fixture(root, names);
      const legacy = await exportCatalog(runtime, root, projectConfig, datasource, {
        outDir: "legacy",
        copyAssets: false,
      });
      const compact = await exportCatalog(runtime, root, projectConfig, datasource, {
        outDir: "compact",
        copyAssets: false,
        compactStorage: true,
        blockSize: 512,
      });
      expect(manifestContent(compact.manifest)).toEqual(manifestContent(legacy.manifest));
      const expected = logicalDocuments(legacy.outputDirectoryPath, legacy.manifest);
      expect(Object.keys(expected).length).toBeGreaterThan(20);
      expect(logicalDocuments(compact.outputDirectoryPath, compact.manifest)).toEqual(expected);
      const indexes = names.length
        ? Object.values(compact.manifest.paths.sets!)
        : [compact.manifest.paths.root!];
      for (const indexPath of indexes) {
        const index = readLogical(compact.outputDirectoryPath, compact.manifest, indexPath);
        const entityTypes = [
          "attribute",
          "feature",
          "schema",
          "segment",
          "target",
          "test",
          "variable",
        ];
        expect(Object.keys(index.entities).sort()).toEqual(entityTypes);
        expect(Object.keys(index.counts).sort()).toEqual(entityTypes);
        expect(Object.keys(compact.manifest.counts[index.set || "root"]).sort()).toEqual(
          entityTypes,
        );
        expect(index.entities.feature[0].key).toBe(featureKey);
        expect(index.entities.feature[0].href).toBe(
          "entities/feature/checkout/cart%20v2%25%C3%A9.json",
        );
        expect(index.entities.test.some((item: any) => item.key === scenarioKey)).toBe(true);
        for (const summaries of Object.values(index.entities) as any[][]) {
          for (const summary of summaries) {
            const detail = readLogical(
              compact.outputDirectoryPath,
              compact.manifest,
              `${path.posix.dirname(indexPath)}/${summary.href}`,
            );
            expect(detail.key).toBe(summary.key);
            expect(detail.relationships).not.toHaveProperty("groups");
            expect(summary).not.toHaveProperty("slots");
            expect(
              detail.usedBy?.every((owner: any) => entityTypes.includes(owner.type)) ?? true,
            ).toBe(true);
            const history = readLogical(
              compact.outputDirectoryPath,
              compact.manifest,
              `${detail.historyPath}/page-1.json`,
            );
            if (detail.type === "feature") {
              expect(history.totalPages).toBe(2);
              expect(history.entries).toHaveLength(50);
              expect(
                readLogical(
                  compact.outputDirectoryPath,
                  compact.manifest,
                  `${detail.historyPath}/page-2.json`,
                ).entries,
              ).toHaveLength(5);
              expect(detail.entity.description).not.toContain("Builder annotation");
            }
          }
        }
      }
    },
  );

  it("keeps all prior manifest documents readable after successful replacement and deletion", async () => {
    const { runtime, datasource, projectConfig } = fixture(root);
    const options = { copyAssets: false, compactStorage: true, blockSize: 512 };
    const first = await exportCatalog(runtime, root, projectConfig, datasource, options);
    const previous = logicalDocuments(first.outputDirectoryPath, first.manifest);
    const files = fs.readdirSync(path.join(first.outputDirectoryPath, "data/blocks"));
    const bytes = files.map((file) =>
      fs.readFileSync(path.join(first.outputDirectoryPath, "data/blocks", file)),
    );
    datasource.features.clear();
    const second = await exportCatalog(runtime, root, projectConfig, datasource, options);
    const latest = readJSON(path.join(second.outputDirectoryPath, "data/manifest.json"));
    expect(latest).toEqual(second.manifest);
    expect(
      readLogical(second.outputDirectoryPath, latest, latest.paths.root).entities.feature,
    ).toEqual([]);
    expect(logicalDocuments(first.outputDirectoryPath, first.manifest)).toEqual(previous);
    files.forEach((file, index) =>
      expect(fs.readFileSync(path.join(first.outputDirectoryPath, "data/blocks", file))).toEqual(
        bytes[index],
      ),
    );
    const removed = `data/root/entities/feature/checkout/cart%20v2%25%C3%A9.json`;
    expect(() => readLogical(second.outputDirectoryPath, latest, removed)).toThrow();
    expect(readLogical(first.outputDirectoryPath, first.manifest, removed).key).toBe(featureKey);
  });

  it.each(["read", "block", "manifest"])(
    "preserves the last published view after a %s failure",
    async (failure) => {
      const { runtime, datasource, projectConfig } = fixture(root);
      const options = { copyAssets: false, compactStorage: true, blockSize: 512 };
      const first = await exportCatalog(runtime, root, projectConfig, datasource, options);
      const previous = logicalDocuments(first.outputDirectoryPath, first.manifest);
      const manifestFile = path.join(first.outputDirectoryPath, "data/manifest.json");
      const originalManifest = fs.readFileSync(manifestFile);
      datasource.features.get(featureKey)!.description = "Changed after the first generation";
      if (failure === "read")
        datasource.readFeature.mockRejectedValueOnce(new Error("Injected read failure"));
      else {
        const rename = fs.promises.rename;
        jest.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
          if (
            (failure === "manifest" && to === manifestFile) ||
            (failure === "block" && String(to).includes(`${path.sep}blocks${path.sep}`))
          ) {
            throw new Error(`Injected ${failure} failure`);
          }
          return rename(from, to);
        });
      }
      await expect(
        exportCatalog(runtime, root, projectConfig, datasource, options),
      ).rejects.toThrow(`Injected ${failure} failure`);
      expect(fs.readFileSync(manifestFile)).toEqual(originalManifest);
      expect(logicalDocuments(first.outputDirectoryPath, readJSON(manifestFile))).toEqual(previous);
      expect(logicalDocuments(first.outputDirectoryPath, first.manifest)).toEqual(previous);
    },
  );

  it("rebuilds only changed sets and retains the other set's immutable storage", async () => {
    const { runtime, datasource, projectConfig, sets } = fixture(root, ["dev.eu", "production"]);
    const devSession = await createCatalogDevSession(root, projectConfig, datasource, {
      devEditors: [],
    });
    const options = { copyAssets: false, compactStorage: true, devSession };
    const first = await exportCatalog(runtime, root, projectConfig, datasource, options);
    const previous = logicalDocuments(first.outputDirectoryPath, first.manifest);
    const changed = sets.get("dev.eu")!;
    const retained = sets.get("production")!;
    changed.readFeature.mockClear();
    retained.readFeature.mockClear();
    changed.listFeatures.mockClear();
    retained.listFeatures.mockClear();
    changed.features.get(featureKey)!.description = "New dev description";
    const second = await exportCatalog(runtime, root, projectConfig, datasource, {
      ...options,
      changedPaths: [
        path.join(projectConfig.setsDirectoryPath, "dev.eu/features/checkout/cart.yml"),
      ],
    });
    expect(changed.readFeature).toHaveBeenCalledTimes(1);
    expect(changed.listFeatures).toHaveBeenCalledTimes(1);
    expect(retained.readFeature).not.toHaveBeenCalled();
    expect(retained.listFeatures).not.toHaveBeenCalled();
    expect(storageScope(second.manifest, "production")).toEqual(
      storageScope(first.manifest, "production"),
    );
    expect(storageScope(second.manifest, "dev.eu")).not.toEqual(
      storageScope(first.manifest, "dev.eu"),
    );
    expect(
      readLogical(
        second.outputDirectoryPath,
        second.manifest,
        "data/sets/dev.eu/entities/feature/checkout/cart%20v2%25%C3%A9.json",
      ).entity.description,
    ).toBe("New dev description");
    expect(logicalDocuments(first.outputDirectoryPath, first.manifest)).toEqual(previous);
  });

  it.each([
    { kind: "partial", count: 3, passed: true, verification: "current", testPassed: undefined },
    { kind: "full", count: 12, passed: true, verification: "current", testPassed: true },
    { kind: "failure", count: 12, passed: false, verification: "current", testPassed: false },
    {
      kind: "partial failure",
      count: 3,
      passed: false,
      verification: "current",
      testPassed: undefined,
    },
    { kind: "duplicate", count: 12, passed: true, verification: "current", testPassed: undefined },
    { kind: "extra", count: 12, passed: true, verification: "current", testPassed: undefined },
    { kind: "wrong Set", count: 12, passed: true, verification: "current", testPassed: undefined },
    { kind: "stale", count: 3, passed: true, verification: "stale", testPassed: undefined },
    {
      kind: "historical duplicate",
      count: 3,
      passed: true,
      verification: "stale",
      testPassed: undefined,
    },
    {
      kind: "unverified",
      count: 12,
      passed: true,
      verification: "unverified",
      testPassed: undefined,
    },
  ])("exports $kind coverage without changing the saved report result", async (options) => {
    const { runtime, datasource, projectConfig } = fixture(root);
    datasource.readTest = async () => ({
      feature: featureKey,
      assertions: [
        {
          key: "named",
          matrix: { region: ["gb", "nl", "de"], tier: [0, 1, 2, 3] },
          environment: "staging",
          expectedToBeEnabled: true,
        },
      ],
    });
    runtime.getTestInputFingerprint = async () => "a".repeat(64);
    const cases = Array.from({ length: options.count }, (_, caseIndex) => ({
      id: JSON.stringify([null, "feature", "tests/cart.spec", "named", caseIndex]),
      passed: caseIndex === 0 ? options.passed : true,
      errors: [],
    }));
    if (options.kind === "duplicate") cases.push({ ...cases[0] });
    if (options.kind === "historical duplicate") cases.push(...cases, ...cases, ...cases);
    if (options.kind === "extra")
      cases.push({
        ...cases[0],
        id: JSON.stringify([null, "feature", "tests/cart.spec", "other", null]),
      });
    if (options.kind === "wrong Set")
      cases[11].id = JSON.stringify(["dev", "feature", "tests/cart.spec", "named", 11]);
    const testReport = path.join(root, "report.json");
    fs.writeFileSync(
      testReport,
      JSON.stringify({
        schemaVersion: 1,
        passed: options.passed,
        ...(options.verification === "unverified"
          ? {}
          : {
              provenance: {
                version: 1,
                algorithm: "sha256",
                sets: [
                  {
                    set: null,
                    fingerprint: (options.verification === "stale" ? "b" : "a").repeat(64),
                  },
                ],
              },
            }),
        results: [{ type: "feature", key: featureKey, passed: options.passed, cases }],
      }),
    );
    const exported = await exportCatalog(runtime, root, projectConfig, datasource, {
      copyAssets: false,
      compactStorage: true,
      testReport,
    });
    const index = readLogical(
      exported.outputDirectoryPath,
      exported.manifest,
      exported.manifest.paths.root!,
    );
    const spec = index.entities.test.find((item: any) => item.key === "tests/cart.spec");
    expect(spec.testPassed).toBe(options.testPassed);
    // The omitted scenario's cases still count towards the total.
    const reportCases = exported.manifest.testReport!.cases!;
    expect(reportCases.executed).toBe(options.kind === "wrong Set" ? 11 : options.count);
    expect(reportCases.total).toBeGreaterThan(12);
    if (options.verification === "current") {
      const executed = options.kind === "wrong Set" ? 11 : options.count;
      expect(spec.testReportStatus).toContain(coveragePhrase(executed, 12, options.passed ? 0 : 1));
    } else {
      expect(spec.testReportStatus).toContain(
        `${options.count} of 12 cases found in an earlier report`,
      );
      expect(spec.testReportStatus).toContain(historicalPhrase(options.verification));
      expect(spec.testReportStatus).not.toContain("cases in report");
    }
    const omitted = index.entities.test.find((item: any) => item.key === scenarioKey);
    expect(omitted.testReportStatus).toBe("Not in supplied report");
    expect(omitted.testPassed).toBeUndefined();
    const detail = readLogical(
      exported.outputDirectoryPath,
      exported.manifest,
      `data/root/${spec.href}`,
    );
    expect(detail.report.passed).toBe(options.passed);
    expect(detail.report.verification).toBe(options.verification);
    expect(detail.report.cases.map((item: any) => item.id)).toEqual(cases.map((item) => item.id));
  });

  it.each(
    ["current", "stale", "unverified"].flatMap((verification) =>
      [false, true].flatMap((reversed) =>
        [
          "duplicate failure",
          "split failure",
          "split pass",
          "partial failure",
          "partial pass",
          "raw failure",
          "mismatched failure",
        ].map((kind) => ({ verification, reversed, kind })),
      ),
    ),
  )("preserves $kind records ($verification, reversed=$reversed)", async (options) => {
    const { runtime, datasource, projectConfig } = fixture(root);
    const testKey = "tests/cart.spec";
    datasource.readTest = async () => ({
      feature: featureKey,
      assertions: [
        {
          key: "named",
          matrix: { region: ["gb", "nl"] },
          environment: "staging",
          expectedToBeEnabled: true,
        },
        { environment: "production", expectedToBeEnabled: false },
      ],
    });
    runtime.getTestInputFingerprint = async () => "a".repeat(64);
    const cases = [
      [null, "feature", testKey, "named", 0],
      [null, "feature", testKey, "named", 1],
      [null, "feature", testKey, 1, null],
    ].map((identity) => ({ id: JSON.stringify(identity), passed: true, errors: [] }));
    const failure = {
      ...cases[0],
      passed: false,
      errors: [{ message: "Retained failure", path: ["enabled"], expected: true, actual: false }],
    };
    const mismatches = [
      ["other", "feature", testKey, "named", 0],
      [null, "variable", testKey, "named", 0],
      [null, "feature", "other", "named", 0],
      [null, "feature", testKey, 0, 0],
      [null, "feature", testKey, "named", null],
      [null, "feature", testKey, "named", 2],
    ];
    const record = (rows: (typeof failure)[], passed = rows.every((row) => row.passed)) => ({
      type: "feature",
      // Empty records use the existing spec key fallback.
      key: rows.length ? featureKey : testKey,
      set: null,
      passed,
      cases: rows,
    });
    const partial = options.kind.startsWith("partial");
    const passed = options.kind.endsWith("pass");
    const results =
      options.kind === "duplicate failure"
        ? [record([failure]), record(cases)]
        : options.kind === "raw failure"
          ? [record([], false), record(cases)]
          : options.kind === "mismatched failure"
            ? [
                record(mismatches.map((id) => ({ ...failure, id: JSON.stringify(id) }))),
                record(cases),
              ]
            : [record([passed ? cases[0] : failure]), record(cases.slice(1, partial ? 2 : 3))];
    if (options.reversed) results.reverse();
    const testReport = path.join(root, "report.json");
    fs.writeFileSync(
      testReport,
      JSON.stringify({
        schemaVersion: 1,
        passed,
        ...(options.verification === "unverified"
          ? {}
          : {
              provenance: {
                version: 1,
                algorithm: "sha256",
                sets: [
                  {
                    set: null,
                    fingerprint: (options.verification === "stale" ? "b" : "a").repeat(64),
                  },
                ],
              },
            }),
        results,
      }),
    );
    const exported = await exportCatalog(runtime, root, projectConfig, datasource, {
      copyAssets: false,
      compactStorage: !options.reversed,
      testReport,
    });
    const read = (logical: string) =>
      readLogical(exported.outputDirectoryPath, exported.manifest, logical);
    const index = read(exported.manifest.paths.root!);
    const spec = index.entities.test.find((item: any) => item.key === testKey);
    const detail: EntityDetail<Test> = read(`data/root/${spec.href}`);
    expect(detail.report).toMatchObject({ verification: options.verification, passed });
    expect(detail.report!.cases).toEqual(
      results.flatMap((result) => result.cases).map((row) => expect.objectContaining(row)),
    );
    const feature: EntityDetail = read(`data/root/${index.entities.feature[0].href}`);
    const embedded = feature.tests!.find((item) => item.key === testKey) as Test & {
      report: EntityDetail["report"];
    };
    expect(embedded.report).toEqual(detail.report);
    const complete =
      !partial && !["duplicate failure", "mismatched failure"].includes(options.kind);
    const rawFailure = options.kind === "raw failure";
    expect(spec.testPassed).toBe(
      options.verification === "current" && complete && !rawFailure ? passed : undefined,
    );
    expect(getTestReportCoverage(detail.report!, detail.entity)).toMatchObject({
      total: 3,
      executed: partial ? 2 : 3,
      complete,
      duplicates: options.kind === "duplicate failure" ? 1 : 0,
      unmatched: options.kind === "mismatched failure" ? mismatches.length : 0,
    });
    expect(spec.testReportStatus).toContain(
      options.verification === "current"
        ? coveragePhrase(
            partial ? 2 : 3,
            3,
            ["duplicate failure", "split failure"].includes(options.kind) ? 1 : 0,
          )
        : `${partial ? 2 : 3} of 3 cases found in an earlier report`,
    );
    if (!complete && !partial) {
      expect(spec.testReportStatus).toContain("Completeness cannot be confirmed");
      expect(spec.testReportStatus).toContain("Reported result: failed");
    }
    const matched = findTestReportCase(
      detail.report,
      detail.entity,
      expandTestAssertions(detail.entity)[0],
    );
    const matchedFailure = !passed && !rawFailure && options.kind !== "mismatched failure";
    expect(matched?.passed).toBe(!matchedFailure);
    expect(matched?.errors).toEqual(matchedFailure ? failure.errors : []);
  });

  it("merges repeated records independently by Set, source and public spec key", async () => {
    const { runtime, datasource, projectConfig, sets } = fixture(root, ["dev", "production"]);
    const keys = ["cart/first", "cart/second", scenarioKey];
    for (const source of sets.values()) source.listTests = async () => keys.slice(0, 2);
    runtime.getTestInputFingerprint = async () => "a".repeat(64);
    const record = (set: string, key: string, type: string, passed: boolean) => ({
      set,
      type,
      key: type === "scenario" ? key : featureKey,
      passed,
      cases: [
        {
          id: JSON.stringify([set, type, key, 0, null]),
          passed,
          errors: passed ? [] : [{ message: `${set}:${type}:${key} failure` }],
        },
      ],
    });
    const results = [...sets.keys()].flatMap((set) =>
      keys.flatMap((key) => {
        const type = key === scenarioKey ? "scenario" : "feature";
        return [
          ...(set === "dev" && key !== keys[1] ? [record(set, key, type, false)] : []),
          record(set, key, type, true),
        ];
      }),
    );
    // A record from the other source must not contaminate an existing spec with the same key.
    results.push(record("production", keys[1], "scenario", false));
    results.push(record("production", scenarioKey, "feature", false));
    const testReport = path.join(root, "report.json");
    fs.writeFileSync(
      testReport,
      JSON.stringify({
        schemaVersion: 1,
        passed: false,
        provenance: {
          version: 1,
          algorithm: "sha256",
          sets: [...sets.keys()].map((set) => ({ set, fingerprint: "a".repeat(64) })),
        },
        results,
      }),
    );
    const exported = await exportCatalog(runtime, root, projectConfig, datasource, {
      copyAssets: false,
      compactStorage: true,
      testReport,
    });
    for (const set of sets.keys()) {
      const read = (logical: string) =>
        readLogical(exported.outputDirectoryPath, exported.manifest, logical);
      const index = read(exported.manifest.paths.sets![set]);
      for (const spec of index.entities.test) {
        const failed = set === "dev" && spec.key !== keys[1];
        const detail = read(`data/sets/${set}/${spec.href}`);
        expect(detail.report).toMatchObject({ verification: "current", passed: !failed });
        expect(detail.report.cases).toHaveLength(failed ? 2 : 1);
        expect(spec.testPassed).toBe(failed ? undefined : true);
        if (failed) {
          expect(spec.testReportStatus).toContain("1 duplicate case result");
          expect(spec.testReportStatus).toMatch(/\b\d+ failed\b/);
          expect(spec.testReportStatus).toContain("Reported result: failed");
        }
      }
    }
  });

  it("rechecks a dirty Set report while retaining current report blocks for unaffected Sets", async () => {
    const { runtime, datasource, projectConfig, sets } = fixture(root, ["dev.eu", "production"]);
    runtime.getTestInputFingerprint = jest.fn(async (_config, source) => {
      const values = await Promise.all(
        (await source.listFeatures()).map((key: string) => source.readFeature(key)),
      );
      return createHash("sha256").update(JSON.stringify(values)).digest("hex");
    });
    const provenanceSets = await Promise.all(
      [...sets].map(async ([set, source]) => ({
        set,
        fingerprint: await runtime.getTestInputFingerprint!(projectConfig, source),
      })),
    );
    const testReport = path.join(root, "saved-report.json");
    fs.writeFileSync(
      testReport,
      JSON.stringify({
        schemaVersion: 1,
        passed: true,
        provenance: { version: 1, algorithm: "sha256", sets: provenanceSets },
        results: [...sets.keys()].map((set) => ({
          set,
          type: "feature",
          key: featureKey,
          passed: true,
          cases: [
            {
              id: JSON.stringify([set, "feature", "tests/cart.spec", 0, null]),
              passed: true,
              errors: [],
            },
          ],
        })),
      }),
    );
    const devSession = await createCatalogDevSession(root, projectConfig, datasource, {
      devEditors: [],
    });
    const options = { copyAssets: false, compactStorage: true, devSession, testReport };
    const first = await exportCatalog(runtime, root, projectConfig, datasource, options);
    expect(first.manifest.testReport?.verification).toBe("current");
    const retained = sets.get("production")!;
    retained.readFeature.mockClear();
    sets.get("dev.eu")!.features.get(featureKey)!.description = "Dirty changed source";
    const second = await exportCatalog(runtime, root, projectConfig, datasource, {
      ...options,
      changedPaths: [
        path.join(projectConfig.setsDirectoryPath, "dev.eu/features/checkout/cart.yml"),
      ],
    });
    expect(second.manifest.testReport?.verification).toBe("stale");
    expect(retained.readFeature).not.toHaveBeenCalled();
    expect(storageScope(second.manifest, "production")).toEqual(
      storageScope(first.manifest, "production"),
    );
    for (const set of ["dev.eu", "production"]) {
      const index = readLogical(
        second.outputDirectoryPath,
        second.manifest,
        second.manifest.paths.sets![set],
      );
      const spec = index.entities.test.find((item: any) => item.key === "tests/cart.spec");
      expect(spec.testPassed).toBe(set === "production" ? true : undefined);
      const detail = readLogical(
        second.outputDirectoryPath,
        second.manifest,
        `data/sets/${set}/${spec.href}`,
      );
      expect(detail.report.verification).toBe(set === "production" ? "current" : "stale");
    }
  });

  it.each(["featurevisor.config.js", "features/shared.yml", "sets/unknown/features/cart.yml"])(
    "rebuilds all sets for unscoped input %s",
    async (changedPath) => {
      const { runtime, datasource, projectConfig, sets } = fixture(root, ["dev.eu", "production"]);
      const devSession = await createCatalogDevSession(root, projectConfig, datasource, {
        devEditors: [],
      });
      const options = { copyAssets: false, compactStorage: true, devSession };
      await exportCatalog(runtime, root, projectConfig, datasource, options);
      sets.forEach((source) => source.readFeature.mockClear());
      await exportCatalog(runtime, root, projectConfig, datasource, {
        ...options,
        changedPaths: [path.join(root, changedPath)],
      });
      sets.forEach((source) => expect(source.readFeature).toHaveBeenCalledTimes(1));
    },
  );

  it("falls back to a complete export when changedPaths has no prior session", async () => {
    const { runtime, datasource, projectConfig, sets } = fixture(root, ["dev.eu", "production"]);
    const result = await exportCatalog(runtime, root, projectConfig, datasource, {
      copyAssets: false,
      compactStorage: true,
      changedPaths: [path.join(projectConfig.setsDirectoryPath, "dev.eu/features/cart.yml")],
    });
    sets.forEach((source) => expect(source.readFeature).toHaveBeenCalledTimes(1));
    expect(Object.keys(result.manifest.paths.sets!)).toEqual(["dev.eu", "production"]);
    expect(
      Object.keys(logicalDocuments(result.outputDirectoryPath, result.manifest)).length,
    ).toBeGreaterThan(40);
  });

  it("does not advance the session after failed publication and can retry a scoped rebuild", async () => {
    const { runtime, datasource, projectConfig, sets } = fixture(root, ["dev.eu", "production"]);
    const devSession = await createCatalogDevSession(root, projectConfig, datasource, {
      devEditors: [],
    });
    const options = { copyAssets: false, compactStorage: true, devSession };
    const first = await exportCatalog(runtime, root, projectConfig, datasource, options);
    const previousIndexes = devSession.setIndexes;
    const manifestFile = path.join(first.outputDirectoryPath, "data/manifest.json");
    const previousManifest = fs.readFileSync(manifestFile);
    const changed = sets.get("dev.eu")!;
    const retained = sets.get("production")!;
    changed.features.get(featureKey)!.description = "Retry description";
    const rename = fs.promises.rename;
    const failure = jest.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
      if (to === manifestFile) throw new Error("Manifest switch failed");
      return rename(from, to);
    });
    const changedPaths = [path.join(projectConfig.setsDirectoryPath, "dev.eu/features/cart.yml")];
    await expect(
      exportCatalog(runtime, root, projectConfig, datasource, { ...options, changedPaths }),
    ).rejects.toThrow("Manifest switch failed");
    expect(devSession.setIndexes).toBe(previousIndexes);
    expect(fs.readFileSync(manifestFile)).toEqual(previousManifest);
    failure.mockRestore();
    changed.readFeature.mockClear();
    retained.readFeature.mockClear();
    const retry = await exportCatalog(runtime, root, projectConfig, datasource, {
      ...options,
      changedPaths,
    });
    expect(changed.readFeature).toHaveBeenCalledTimes(1);
    expect(retained.readFeature).not.toHaveBeenCalled();
    expect(devSession.setIndexes).not.toBe(previousIndexes);
    expect(storageScope(retry.manifest, "production")).toEqual(
      storageScope(first.manifest, "production"),
    );
    expect(
      readLogical(
        retry.outputDirectoryPath,
        retry.manifest,
        "data/sets/dev.eu/entities/feature/checkout/cart%20v2%25%C3%A9.json",
      ).entity.description,
    ).toBe("Retry description");
  });

  it("removes a deleted set from the new manifest while preserving its old documents", async () => {
    const { runtime, datasource, projectConfig, sets } = fixture(root, ["dev.eu", "production"]);
    const devSession = await createCatalogDevSession(root, projectConfig, datasource, {
      devEditors: [],
    });
    const options = { copyAssets: false, compactStorage: true, devSession };
    const first = await exportCatalog(runtime, root, projectConfig, datasource, options);
    const previous = logicalDocuments(first.outputDirectoryPath, first.manifest);
    sets.delete("dev.eu");
    const second = await exportCatalog(runtime, root, projectConfig, datasource, {
      ...options,
      changedPaths: [path.join(projectConfig.setsDirectoryPath, "dev.eu")],
    });
    expect(second.manifest.setKeys).toEqual(["production"]);
    expect(Object.keys(second.manifest.paths.sets!)).toEqual(["production"]);
    expect(Object.keys(second.manifest.counts!)).toEqual(["production"]);
    expect(storageScope(second.manifest, "dev.eu")).toEqual({ documents: {}, groups: {} });
    expect(logicalDocuments(first.outputDirectoryPath, first.manifest)).toEqual(previous);
  });
});
