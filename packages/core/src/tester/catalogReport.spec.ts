import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { getProjectSetExecutions } from "../sets";
import { getCatalogTargetMemberships } from "../catalog";
import { createTestReport } from "./report";
import { testProject } from "./testProject";
import { getTestInputFingerprint } from "./provenance";
// Load sibling source at runtime without pulling it into Core's declaration root.
const { exportCatalog } = require("../../../catalog/src/node");
const { readCatalogStorageEntry, resolveCatalogStorage } = require("../../../catalog/src/storage");
const { decodeCatalogIndex } = require("../../../catalog/src/indexCodec");
const { expandTestAssertions, findTestReportCase } = require("../../../catalog/src/testModel");

describe("Core report to Catalog input provenance", () => {
  let root: string;
  const runtime = { getProjectSetExecutions, getCatalogTargetMemberships, getTestInputFingerprint };
  function write(file: string, value: unknown) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, typeof value === "string" ? value : JSON.stringify(value));
  }
  function deps(directory = root) {
    const projectConfig = getProjectConfig(directory);
    return {
      rootDirectoryPath: directory,
      projectConfig,
      datasource: new Datasource(projectConfig, directory),
      options: {},
    };
  }
  async function run(directory = root, options = {}) {
    const report = createTestReport();
    await testProject(deps(directory), { json: true, report, ...options });
    return report;
  }
  async function catalog(report: unknown, directory = root, overrideRuntime = runtime) {
    write("saved-report.json", report);
    const { projectConfig, datasource } = deps(directory);
    await exportCatalog(overrideRuntime, directory, projectConfig, datasource, {
      outDir: path.join(root, "catalog"),
      copyAssets: false,
      compactStorage: true,
      testReport: path.join(root, "saved-report.json"),
    });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "catalog/data/manifest.json"), "utf8"),
    );
    const load = (logical: string): any => {
      const resolution = resolveCatalogStorage(manifest.storage, logical)!;
      return readCatalogStorageEntry(
        JSON.parse(fs.readFileSync(path.join(root, "catalog", resolution.blockURL), "utf8")),
        resolution,
      );
    };
    const index = decodeCatalogIndex(load(manifest.paths.root));
    return {
      manifest,
      index,
      load,
      tests: index.entities.test.map((item) => load(`data/root/${item.href}`)),
    };
  }
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-provenance-"));
    write(
      "featurevisor.config.js",
      'module.exports = { parser: "json", namespaceCharacter: "/" };',
    );
    write("variables/limit.json", { type: "integer", defaultValue: 10 });
    write("tests/limit.spec.json", {
      variable: "limit",
      assertions: [
        { key: "named", expectedValue: 10 },
        { expectedValue: 10 },
        {
          key: "matrix",
          matrix: { country: ["gb", "nl"] },
          context: { country: "${{ country }}" },
          expectedValue: 10,
        },
        {
          matrix: { country: ["gb", "nl"] },
          context: { country: "${{ country }}" },
          expectedValue: 10,
        },
      ],
    });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("matches keyed, unkeyed and matrix IDs through runner, exporter and UI matching", async () => {
    const report = await run();
    expect(report.provenance?.sets[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const { manifest, index, tests, load } = await catalog(report);
    expect(manifest.testReport.verification).toBe("current");
    expect(index.entities.test[0].testPassed).toBe(true);
    expect(tests[0].report.cases[0].assertionKey).toBe("named");
    const matched = expandTestAssertions(tests[0].entity).map((expanded) =>
      findTestReportCase(tests[0].report, tests[0].entity, expanded),
    );
    expect(matched.map((item) => item?.id)).toEqual(report.results[0].cases.map((item) => item.id));
    expect(new Set(matched).size).toBe(6);
    expect(load(manifest.paths.projectHistory).entries).toEqual([]);
    expect(load(`${tests[0].historyPath}/page-1.json`).entries).toEqual([]);
  });

  it.each([
    { dependencyInflate: 2, requestedInflate: 0, reused: false },
    { dependencyInflate: 2, requestedInflate: undefined, reused: false },
    { dependencyInflate: 2, requestedInflate: 0, reused: true },
    { dependencyInflate: undefined, requestedInflate: 2, reused: false },
  ])(
    "never verifies inflated inputs with $dependencyInflate/$requestedInflate and reused=$reused",
    async ({ dependencyInflate, requestedInflate, reused }) => {
      write("features/flag.json", {
        rules: [{ key: "everyone", conditions: "*", percentage: 100 }],
      });
      const report = reused ? await run() : createTestReport();
      write("tests/inflated.spec.json", { checks: [{ feature: "flag-0", enabled: true }] });
      const dependencies = { ...deps(), options: { inflate: dependencyInflate } };
      await testProject(dependencies, { json: true, report, inflate: requestedInflate });
      const inflated = report.results.find((spec) => spec.type === "scenario");
      // The generated feature proves which options actually reached the builder.
      expect(inflated?.passed).toBe(dependencyInflate === 2);
      expect(report.provenance?.sets.some((entry) => entry.set === null)).not.toBe(true);
      const { manifest, index, tests } = await catalog(report);
      expect(manifest.testReport.verification).toBe("unverified");
      expect(index.entities.test.every((spec) => spec.testPassed === undefined)).toBe(true);
      expect(tests.every((spec) => spec.report.verification === "unverified")).toBe(true);
    },
  );

  it.each(["definitions", "spec", "config"])(
    "marks a saved pass stale after dirty %s changes without relying on Git HEAD",
    async (change) => {
      execFileSync("git", ["init", "-q"], { cwd: root });
      const report = await run();
      if (change === "definitions")
        write("variables/limit.json", { type: "integer", defaultValue: 20 });
      if (change === "spec")
        write("tests/limit.spec.json", {
          variable: "limit",
          assertions: [{ key: "named", expectedValue: 20 }],
        });
      if (change === "config") {
        write(
          "featurevisor.config.js",
          'module.exports = { parser: "json", namespaceCharacter: "/", defaultBucketBy: "accountId" };',
        );
        jest.resetModules();
      }
      const { manifest, index, tests } = await catalog(report);
      expect(manifest.testReport.verification).toBe("stale");
      expect(index.entities.test[0].testPassed).toBeUndefined();
      expect(tests[0].report).toMatchObject({ passed: true, verification: "stale" });
    },
  );

  it.each([
    "legacy",
    "native",
    "version",
    "algorithm",
    "duplicate",
    "malformed",
    "missing runtime",
  ])("keeps %s provenance explicitly historical", async (kind) => {
    const report: any = await run();
    if (kind === "legacy" || kind === "native") delete report.provenance;
    if (kind === "native") report.runner = "go";
    if (kind === "version") report.provenance.version = 2;
    if (kind === "algorithm") report.provenance.algorithm = "unknown";
    if (kind === "duplicate") report.provenance.sets.push(report.provenance.sets[0]);
    if (kind === "malformed") report.provenance.sets[0].fingerprint = "invalid";
    const { manifest, tests, index } = await catalog(
      report,
      root,
      kind === "missing runtime"
        ? ({ ...runtime, getTestInputFingerprint: undefined } as any)
        : runtime,
    );
    expect(manifest.testReport.verification).toBe("unverified");
    expect(tests[0].report.verification).toBe("unverified");
    expect(index.entities.test[0].testPassed).toBeUndefined();
  });

  it("matches all Example 1 connectionSettings assertions, including the keyed matrix", async () => {
    const directory = path.resolve(__dirname, "../../../../examples/example-1");
    const report = await run(directory, { keyPattern: "connectionSettings" });
    const { tests } = await catalog(report, directory);
    const detail = tests.find((item) => item.entity.variable === "connectionSettings");
    const matched = expandTestAssertions(detail.entity).map((expanded) =>
      findTestReportCase(detail.report, detail.entity, expanded),
    );
    expect(matched).toHaveLength(5);
    expect(matched.every((item) => item?.passed)).toBe(true);
    expect(detail.report.verification).toBe("current");
  }, 30000);

  it.each([
    null,
    true,
    "unknown",
    [],
    { version: 1, algorithm: "sha256", sets: null },
    { version: 1, algorithm: "sha256", sets: [null, false, "unknown", {}] },
    { version: 1, algorithm: "sha256", sets: [{ set: null, fingerprint: ["a".repeat(64)] }] },
    { version: 1, algorithm: "sha256", sets: [{ set: null, fingerprint: { toString: null } }] },
    { version: 1, algorithm: "sha256", sets: [{ set: null, fingerprint: null }] },
    { version: 1, algorithm: "sha256", sets: [{ set: null, fingerprint: 42 }] },
  ])("treats malformed provenance as unverified without coercion: %j", async (provenance) => {
    const report = await run();
    const { manifest, index, tests } = await catalog({ ...report, provenance });
    expect(manifest.testReport.verification).toBe("unverified");
    expect(index.entities.test[0].testPassed).toBeUndefined();
    expect(tests[0].report.verification).toBe("unverified");
  });
});
