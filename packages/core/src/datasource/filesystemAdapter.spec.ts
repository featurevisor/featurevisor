import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import childProcess from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { CustomParser } from "@featurevisor/parsers";

import { getProjectConfig } from "../config";
import { buildDatafile } from "../builder";
import { Datasource } from "./datasource";
import { FilesystemAdapter, getExistingStateFilePath } from "./filesystemAdapter";

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function createProject(configBody: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-fs-adapter-"));
  writeFile(path.join(root, "featurevisor.config.js"), configBody);

  return root;
}

function mockHistoryProcess(output: string, chunkSize = Buffer.byteLength(output) || 1, code = 0) {
  return jest.spyOn(childProcess, "spawn").mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: jest.fn(),
    });
    queueMicrotask(() => {
      const buffer = Buffer.from(output);
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        child.stdout.write(buffer.subarray(offset, offset + chunkSize));
      }
      child.stdout.end();
      child.stdout.on("end", () => child.emit("close", code));
    });
    return child as unknown as ReturnType<typeof childProcess.spawn>;
  });
}

describe("core: filesystemAdapter", () => {
  it.each([".", "/"])(
    "keeps nested scenario sources and detects public key collisions with namespace %s",
    async (namespace) => {
      const root = createProject(
        `module.exports = { namespaceCharacter: ${JSON.stringify(namespace)} };`,
      );
      try {
        const datasource = new Datasource(getProjectConfig(root), root);
        const key = ["nested.spec", "checkout"].join(namespace);
        const source = path.join(root, "tests", "nested.spec", "checkout.spec.yml");
        writeFile(source, "checks: []\n");
        await expect(datasource.listScenarios()).resolves.toEqual([key]);
        expect(datasource.getScenarioSourcePath(key)).toBe(source);
        await expect(datasource.readScenario(key)).resolves.toEqual({ checks: [] });

        const collision = path.join(root, "tests", "nested.spec", "checkout.yml");
        writeFile(collision, "checks: []\n");
        await expect(datasource.listScenarios()).rejects.toThrow(
          `Scenario key collision for "${key}"`,
        );
        expect(() => datasource.getScenarioSourcePath(key)).toThrow("Scenario key collision");
        fs.unlinkSync(collision);
        await expect(datasource.listScenarios()).resolves.toEqual([key]);
        writeFile(source, "feature: checkout\nassertions: []\n");
        await expect(datasource.listScenarios()).resolves.toEqual([]);
        await expect(datasource.listTests()).resolves.toEqual([key]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("reuses the discovery snapshot across entity reads and refreshes after an external change", async () => {
    const root = createProject("module.exports = {};");
    try {
      for (let index = 0; index < 40; index++) {
        writeFile(
          path.join(root, "tests", `entity-${index}.spec.yml`),
          "feature: ready\nassertions: []\n",
        );
      }
      const datasource = new Datasource(getProjectConfig(root), root);
      const adapter = (datasource as any).adapter as FilesystemAdapter;
      const discovery = jest.spyOn(adapter as any, "scenarioPaths");
      const keys = await datasource.listTests();
      expect(keys).toHaveLength(40);
      for (const key of keys) {
        await datasource.readTest(key);
        datasource.getTestSourcePath(key);
      }
      expect(discovery.mock.calls.filter(([refresh]) => refresh === true)).toHaveLength(1);
      writeFile(path.join(root, "tests", "entity-0.yml"), "feature: ready\nassertions: []\n");
      expect(() => datasource.getTestSourcePath("entity-0")).toThrow("Test key collision");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps source lookup working for custom adapters without test path discovery", () => {
    const root = createProject("module.exports = {};");
    try {
      const config = getProjectConfig(root);
      config.adapter = class {
        getEntityPath(_type: string, key: string) {
          return path.join(root, "custom", `${key}.yml`);
        }
      } as any;
      expect(new Datasource(config, root).getTestSourcePath("ready")).toBe(
        path.join(root, "custom", "ready.yml"),
      );
      config.adapter = class {} as any;
      expect(new Datasource(config, root).getTestSourcePath("ready")).toBe(
        path.join(root, "tests", "ready.yml"),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an entity test and scenario with the same public key before writes", async () => {
    const root = createProject("module.exports = {};");
    try {
      const datasource = new Datasource(getProjectConfig(root), root);
      writeFile(path.join(root, "tests", "checkout.yml"), "feature: checkout\nassertions: []\n");
      await expect(datasource.writeScenario("checkout", { checks: [] })).rejects.toThrow(
        "Test identity collision",
      );
      expect(fs.existsSync(path.join(root, "tests", "checkout.spec.yml"))).toBe(false);
      writeFile(path.join(root, "tests", "checkout.spec.yml"), "checks: []\n");
      await expect(datasource.listScenarios()).rejects.toThrow(
        'Test identity collision for "checkout"',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([".", "/"])(
    "normalizes entity specs anywhere under tests and rejects entity collisions with namespace %s",
    async (namespace) => {
      const root = createProject(
        `module.exports = { namespaceCharacter: ${JSON.stringify(namespace)} };`,
      );
      try {
        const datasource = new Datasource(getProjectConfig(root), root);
        const key = ["scenarios", "nested", "ready"].join(namespace);
        const specPath = path.join(root, "tests", "scenarios", "nested", "ready.spec.yml");
        const directPath = path.join(root, "tests", "scenarios", "nested", "ready.yml");
        writeFile(specPath, "variable: ready\nassertions: []\n");
        await expect(datasource.listTests()).resolves.toEqual([key]);
        expect(datasource.getTestSourcePath(key)).toBe(specPath);
        await expect(datasource.readTest(key)).resolves.toMatchObject({ variable: "ready" });
        writeFile(directPath, "feature: ready\nassertions: []\n");
        await expect(datasource.listTests()).rejects.toThrow(`Test key collision for "${key}"`);
        expect(() => datasource.getTestSourcePath(key)).toThrow("Test key collision");
        fs.unlinkSync(directPath);
        await expect(datasource.listTests()).resolves.toEqual([key]);
        await datasource.deleteTest(key);
        await expect(datasource.listTests()).resolves.toEqual([]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each([".", "/"])("discovers tests by contents with namespace %s", async (namespace) => {
    const root = createProject(
      `module.exports = { namespaceCharacter: ${JSON.stringify(namespace)} };`,
    );
    const key = (value: string) => value.split("/").join(namespace);
    writeFile(path.join(root, "tests", "checkout", "ready.spec.yml"), "checks: []\n");
    writeFile(
      path.join(root, "tests", "scenarios", "ready.spec.yml"),
      "feature: ready\nassertions: []\n",
    );
    writeFile(path.join(root, "tests", "ready.spec.yml"), "checks: []\n");
    const datasource = new Datasource(getProjectConfig(root), root);

    await expect(datasource.listScenarios()).resolves.toEqual([key("checkout/ready"), "ready"]);
    await expect(datasource.listTests()).resolves.toEqual([key("scenarios/ready")]);
    await expect(datasource.readTest(key("scenarios/ready"))).resolves.toEqual({
      feature: "ready",
      assertions: [],
    });
    await datasource.writeScenario(key("scenarios/ready"), { checks: [] });
    await expect(datasource.listTests()).resolves.toEqual([]);
    await expect(datasource.listScenarios()).resolves.toHaveLength(3);
    expect(fs.existsSync(path.join(root, "tests", "scenarios", "ready.spec.yml"))).toBe(true);
    await datasource.deleteScenario(key("checkout/ready"));
    await expect(datasource.scenarioExists(key("checkout/ready"))).resolves.toBe(false);
  });

  it("retains malformed and mixed specs for individual diagnostics", async () => {
    const root = createProject("module.exports = {};");
    const contents = {
      broken: "checks: [\n",
      mixed: "feature: checkout\nchecks: []\n",
      multiple: "feature: checkout\nvariable: policy\nassertions: []\n",
      missing: "description: No test shape\n",
      primitive: "null\n",
      scenario: "checks: null\n",
    };
    for (const [name, content] of Object.entries(contents)) {
      writeFile(path.join(root, "tests", "arbitrary", `${name}.spec.yml`), content);
    }
    const datasource = new Datasource(getProjectConfig(root), root);
    await expect(datasource.listTests()).resolves.toEqual([
      "arbitrary.broken",
      "arbitrary.missing",
      "arbitrary.mixed",
      "arbitrary.multiple",
      "arbitrary.primitive",
    ]);
    await expect(datasource.listScenarios()).resolves.toEqual(["arbitrary.scenario"]);
    await expect(datasource.readTest("arbitrary.broken")).rejects.toThrow();
    await expect(datasource.readTest("arbitrary.mixed")).resolves.toMatchObject({
      checks: [],
    });
  });

  it("parses once across collections and reads without retaining stale or mutated values", async () => {
    const root = createProject("module.exports = {};");
    const filePath = path.join(root, "tests", "same.spec.yml");
    writeFile(filePath, "checks: []\n");
    const config = getProjectConfig(root);
    const parser = config.parser as CustomParser;
    const parse = jest.fn(parser.parse.bind(parser));
    config.parser = { ...parser, parse: parse as CustomParser["parse"] };
    const datasource = new Datasource(config, root);
    await datasource.listTests();
    await datasource.listScenarios();
    const scenario = await datasource.readScenario("same");
    scenario.checks.push({ feature: "mutated", enabled: true });
    await expect(datasource.readScenario("same")).resolves.toEqual({ checks: [] });
    expect(parse).toHaveBeenCalledTimes(1);

    const stat = fs.statSync(filePath);
    writeFile(filePath, "checks: {}\n");
    fs.utimesSync(filePath, stat.atime, stat.mtime);
    await expect(datasource.readScenario("same")).resolves.toEqual({ checks: {} });
    expect(parse).toHaveBeenCalledTimes(2);
    writeFile(filePath, "feature: ready\nassertions: []\n");
    await expect(datasource.listScenarios()).resolves.toEqual([]);
    await expect(datasource.listTests()).resolves.toEqual(["same"]);
    expect(parse).toHaveBeenCalledTimes(3);

    writeFile(filePath, "checks: [\n");
    await datasource.listScenarios();
    await datasource.listTests();
    await expect(datasource.readTest("same")).rejects.toThrow();
    expect(parse).toHaveBeenCalledTimes(4);
    writeFile(filePath, "checks: []\n");
    await datasource.writeScenario("same", { checks: [] });
    await expect(datasource.listScenarios()).resolves.toEqual(["same"]);
    expect(parse).toHaveBeenCalledTimes(6);
    await datasource.deleteScenario("same");
    await expect(datasource.listScenarios()).resolves.toEqual([]);
  });

  it("shares custom tests storage and isolates selected sets", async () => {
    const root = createProject(
      'module.exports = { sets: true, testsDirectoryPath: "<rootDir>/specifications" };',
    );
    const datasource = new Datasource(getProjectConfig(root), root);
    await datasource.writeScenario("nested.root", { checks: [] });
    expect(fs.existsSync(path.join(root, "specifications", "nested", "root.spec.yml"))).toBe(true);
    const selected = datasource.forSet("staging");
    await selected.writeScenario("checkout.ready", { checks: [] });
    await selected.writeTest("scenarios.entity", { feature: "ready", assertions: [] });
    await expect(selected.listScenarios()).resolves.toEqual(["checkout.ready"]);
    await expect(selected.listTests()).resolves.toEqual(["scenarios.entity"]);
    await expect(datasource.listScenarios()).resolves.toEqual(["nested.root"]);
    await expect(datasource.forSet("production").listScenarios()).resolves.toEqual([]);
    expect(
      fs.existsSync(path.join(root, "sets", "staging", "tests", "checkout", "ready.spec.yml")),
    ).toBe(true);
  });

  it("classifies historical, renamed and deleted specs from their revision contents", async () => {
    const root = createProject('module.exports = { namespaceCharacter: "/" };');
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      }).trim();
    const commit = (message: string) => {
      git("add", ".");
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        message,
      );
      return git("rev-parse", "HEAD");
    };
    try {
      git("init", "-q");
      writeFile(path.join(root, "tests", "checkout", "old.spec.yml"), "checks: []\n");
      writeFile(
        path.join(root, "tests", "scenarios", "entity.spec.yml"),
        "feature: ready\nassertions: []\n",
      );
      const initial = commit("Initial specs");
      fs.renameSync(
        path.join(root, "tests", "checkout", "old.spec.yml"),
        path.join(root, "tests", "checkout", "new.spec.yml"),
      );
      writeFile(path.join(root, "tests", "scenarios", "entity.spec.yml"), "checks: []\n");
      const renamed = commit("Rename scenario and change entity kind");
      fs.unlinkSync(path.join(root, "tests", "checkout", "new.spec.yml"));
      const deleted = commit("Delete scenario");
      writeFile(
        path.join(root, "tests", "scenarios", "entity.spec.yml"),
        "variable: dirty\nassertions: []\n",
      );

      const datasource = new Datasource(getProjectConfig(root), root);
      const history = await datasource.listHistoryEntries("scenario");
      expect(history[0].entities).toEqual([{ type: "scenario", key: "checkout/new" }]);
      expect(history[1].entities).toEqual(
        expect.arrayContaining([
          { type: "scenario", key: "checkout/old" },
          { type: "scenario", key: "checkout/new" },
          { type: "scenario", key: "scenarios/entity" },
        ]),
      );
      expect(history[2].entities).toEqual([{ type: "scenario", key: "checkout/old" }]);
      expect((await datasource.listHistoryEntries("test"))[0].entities).toContainEqual({
        type: "test",
        key: "scenarios/entity",
      });
      expect((await datasource.readCommit(initial)).entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "test", key: "scenarios/entity", created: true }),
          expect.objectContaining({ type: "scenario", key: "checkout/old", created: true }),
        ]),
      );
      expect((await datasource.readCommit(renamed, "scenario")).entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "scenario", key: "checkout/old", deleted: true }),
          expect.objectContaining({ type: "scenario", key: "checkout/new", created: true }),
        ]),
      );
      expect((await datasource.readCommit(deleted, "scenario", "checkout/new")).entities).toEqual([
        expect.objectContaining({ type: "scenario", key: "checkout/new", deleted: true }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists generated datafiles as sorted relative paths", async () => {
    const root = createProject("module.exports = {};");
    writeFile(path.join(root, "datafiles", "production", "featurevisor-all.json"), "{}");
    writeFile(path.join(root, "datafiles", "staging", "nested", "featurevisor-web.json"), "abc");
    writeFile(path.join(root, "datafiles", "staging", "featurevisor-mobile.txt"), "abcd");
    writeFile(path.join(root, "datafiles", "REVISION"), "1");
    writeFile(path.join(root, "datafiles", ".DS_Store"), "");

    const datasource = new Datasource(getProjectConfig(root), root);

    await expect(datasource.listDatafiles()).resolves.toMatchObject([
      { path: "production/featurevisor-all.json", size: 2, gzipSize: expect.any(Number) },
      { path: "staging/featurevisor-mobile.txt", size: 4, gzipSize: expect.any(Number) },
      { path: "staging/nested/featurevisor-web.json", size: 3, gzipSize: expect.any(Number) },
    ]);
  });

  it("lists nested entity paths with dot namespace character by default", async () => {
    const root = createProject("module.exports = {};");

    writeFile(
      path.join(root, "features", "checkout", "page.yml"),
      [
        "description: Checkout page",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  staging:",
        "    - key: everyone",
        "      conditions: '*'",
        "      percentage: 100",
        "  production:",
        "    - key: everyone",
        "      conditions: '*'",
        "      percentage: 100",
      ].join("\n"),
    );
    writeFile(
      path.join(root, "segments", "countries", "germany.yml"),
      [
        "description: Germany",
        "conditions:",
        "  - attribute: country",
        "    operator: equals",
        "    value: de",
      ].join("\n"),
    );

    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    await expect(datasource.listFeatures()).resolves.toEqual(["checkout.page"]);
    await expect(datasource.listSegments()).resolves.toEqual(["countries.germany"]);
    await datasource.writeTarget("apps.web", {
      description: "Web app",
      tags: ["all"],
      context: { platform: "web" },
    });
    await expect(datasource.listTargets()).resolves.toEqual(["apps.web"]);
    await expect(datasource.readTarget("apps.web")).resolves.toMatchObject({
      description: "Web app",
      tags: ["all"],
    });
    await datasource.deleteTarget("apps.web");
    await expect(datasource.listTargets()).resolves.toEqual([]);
    await expect(datasource.readFeature("checkout.page")).resolves.toMatchObject({
      description: "Checkout page",
    });
  });

  it("keeps scenarios separate from tests and preserves raw authoring data", async () => {
    const root = createProject("module.exports = {};");
    writeFile(
      path.join(root, "tests", "variables", "supportEmail.spec.yml"),
      "variable: supportEmail\nassertions: []\n",
    );
    writeFile(
      path.join(root, "tests", "scenarios", "checkout", "readiness.spec.yml"),
      [
        "description: Checkout is ready",
        "matrix:",
        "  country: [nl, de]",
        "context:",
        '  country: "${{ country }}"',
        "checks:",
        "  - variable: supportEmail",
        "    operator: contains",
        '    value: "@"',
        "",
      ].join("\n"),
    );

    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    await expect(datasource.listTests()).resolves.toEqual(["variables.supportEmail"]);
    await expect(datasource.listScenarios()).resolves.toEqual(["scenarios.checkout.readiness"]);
    await expect(datasource.readScenario("scenarios.checkout.readiness")).resolves.toEqual({
      description: "Checkout is ready",
      matrix: { country: ["nl", "de"] },
      context: { country: "${{ country }}" },
      checks: [{ variable: "supportEmail", operator: "contains", value: "@" }],
    });

    await datasource.writeScenario("account.owner", {
      description: "Account has an owner",
      context: {},
      checks: [{ feature: "accountOwner", enabled: true }],
    });
    await expect(datasource.scenarioExists("account.owner")).resolves.toBe(true);
    expect((await datasource.listScenarios()).sort()).toEqual([
      "account.owner",
      "scenarios.checkout.readiness",
    ]);
    await expect(datasource.listTests()).resolves.toEqual(["variables.supportEmail"]);
    await datasource.deleteScenario("account.owner");
    await expect(datasource.scenarioExists("account.owner")).resolves.toBe(false);

    const datafile = await buildDatafile(
      config,
      datasource,
      { revision: "scenario-authoring", environment: false },
      { features: {} },
    );
    expect(datafile).not.toHaveProperty("scenarios");
  });

  it("keeps slash-separated keys when namespaceCharacter is slash", async () => {
    const root = createProject(
      'module.exports = { namespaceCharacter: "/", environments: ["staging", "production"] };',
    );

    writeFile(
      path.join(root, "features", "checkout", "page.yml"),
      [
        "description: Checkout page",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  staging:",
        "    - key: everyone",
        "      conditions: '*'",
        "      percentage: 100",
        "  production:",
        "    - key: everyone",
        "      conditions: '*'",
        "      percentage: 100",
      ].join("\n"),
    );
    writeFile(
      path.join(root, "variables", "checkout", "supportEmail.yml"),
      [
        "description: Checkout support email",
        "type: string",
        "defaultValue: checkout@example.com",
      ].join("\n"),
    );
    writeFile(
      path.join(root, "tests", "scenarios", "checkout", "readiness.spec.yml"),
      [
        "description: Checkout is ready",
        "checks:",
        "  - variable: checkout/supportEmail",
        "    operator: exists",
        "",
      ].join("\n"),
    );

    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    await expect(datasource.listFeatures()).resolves.toEqual(["checkout/page"]);
    await expect(datasource.listVariables()).resolves.toEqual(["checkout/supportEmail"]);
    await expect(datasource.listScenarios()).resolves.toEqual(["scenarios/checkout/readiness"]);
    await expect(datasource.listTests()).resolves.toEqual([]);
    await expect(datasource.readFeature("checkout/page")).resolves.toMatchObject({
      description: "Checkout page",
    });
    await expect(datasource.readVariable("checkout/supportEmail")).resolves.toMatchObject({
      description: "Checkout support email",
      defaultValue: "checkout@example.com",
    });

    const datafile = await buildDatafile(
      config,
      datasource,
      { revision: "slash-variable", environment: "production" },
      { features: {} },
    );
    expect(datafile.variables?.["checkout/supportEmail"]).toEqual(
      expect.objectContaining({ defaultValue: "checkout@example.com" }),
    );
  });

  it("classifies scenario history with namespaced keys", async () => {
    const root = createProject("module.exports = {};");
    const config = getProjectConfig(root);
    const adapter = new FilesystemAdapter(config, root);
    const spawn = mockHistoryProcess(
      [
        "",
        "abc123",
        "Test Author",
        "2026-09-13T12:00:00.000Z",
        "Scenario subject",
        "\ntests/scenarios/checkout/readiness.spec.yml",
        "",
      ].join("\0"),
    );
    jest.spyOn(adapter, "readHistoricalTestSpec").mockReturnValue({ checks: [] });

    expect(adapter.getPathPatterns("scenario")).toEqual(["tests"]);
    await expect(adapter.listHistoryEntries("scenario")).resolves.toEqual([
      {
        commit: "abc123",
        author: "Test Author",
        timestamp: "2026-09-13T12:00:00.000Z",
        subject: "Scenario subject",
        entities: [{ type: "scenario", key: "scenarios.checkout.readiness" }],
      },
    ]);
    await expect(adapter.listHistoryEntries("test")).resolves.toEqual([]);
    spawn.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists sets and reads entities from selected set", async () => {
    const root = createProject("module.exports = { sets: true };");

    writeFile(
      path.join(root, "sets", "storefront", "features", "banner.yml"),
      [
        "key: banner",
        "description: Storefront banner",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  staging:",
        "    - key: everyone",
        "      conditions: '*'",
        "      percentage: 100",
        "  production:",
        "    - key: everyone",
        "      conditions: '*'",
        "      percentage: 100",
      ].join("\n"),
    );

    writeFile(
      path.join(root, "sets", "admin", "features", "banner.yml"),
      [
        "key: banner",
        "description: Admin banner",
        "tags:",
        "  - all",
        "bucketBy: userId",
        "rules:",
        "  staging:",
        "    - key: everyone",
        "      conditions: '*'",
        "      percentage: 0",
        "  production:",
        "    - key: everyone",
        "      conditions: '*'",
        "      percentage: 0",
      ].join("\n"),
    );

    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);

    await expect(datasource.listSets()).resolves.toEqual(["admin", "storefront"]);

    const storefrontDatasource = datasource.forSet("storefront");
    const feature = await storefrontDatasource.readFeature("banner");

    expect(feature.description).toBe("Storefront banner");
    expect(storefrontDatasource.getSet()).toBe("storefront");
    expect(storefrontDatasource.getConfig().featuresDirectoryPath).toBe(
      path.join(root, "sets", "storefront", "features"),
    );
    expect(storefrontDatasource.getConfig().targetsDirectoryPath).toBe(
      path.join(root, "sets", "storefront", "targets"),
    );
    expect(storefrontDatasource.getConfig().testsDirectoryPath).toBe(
      path.join(root, "sets", "storefront", "tests"),
    );
    await storefrontDatasource.writeTarget("web", { description: "Storefront web" });
    await expect(storefrontDatasource.listTargets()).resolves.toEqual(["web"]);
  });

  it("writes compact state when prettyState is disabled", async () => {
    const root = createProject("module.exports = { prettyState: false };");
    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);
    const state = { features: {} };

    await datasource.writeState(false, state);

    expect(fs.readFileSync(getExistingStateFilePath(config, false), "utf8")).toBe(
      JSON.stringify(state),
    );
  });

  it("writes formatted state when prettyState is enabled", async () => {
    const root = createProject("module.exports = { prettyState: true };");
    const config = getProjectConfig(root);
    const datasource = new Datasource(config, root);
    const state = { features: {} };

    await datasource.writeState(false, state);

    expect(fs.readFileSync(getExistingStateFilePath(config, false), "utf8")).toBe(
      JSON.stringify(state, null, 2),
    );
  });

  it("fingerprints entity files for built in parsers only", async () => {
    const root = createProject("module.exports = {};");
    const file = path.join(root, "features", "checkout.yml");
    writeFile(file, "description: Checkout\n");
    const adapter = new FilesystemAdapter(getProjectConfig(root), root);

    const first = await adapter.getEntityFingerprint("feature", "checkout");
    expect(first).toMatch(/^.+checkout\.yml\u0000\d+:[\d.]+:\d+$/);
    expect(await adapter.getEntityFingerprint("feature", "checkout")).toBe(first);

    // An atomic save, as editors do, changes the identity even at the same size.
    const replacement = `${file}.tmp`;
    writeFile(replacement, "description: Checkin\n");
    fs.renameSync(replacement, file);
    expect(await adapter.getEntityFingerprint("feature", "checkout")).not.toBe(first);
    expect(await adapter.getEntityFingerprint("feature", "missing")).toBeUndefined();

    // A custom parser may read other files, so its output is not tied to one file.
    const custom: CustomParser = {
      extension: "yml",
      parse: (content) => ({ description: content }) as any,
      stringify: (value) => String(value),
    };
    const customAdapter = new FilesystemAdapter(
      { ...getProjectConfig(root), parser: custom },
      root,
    );
    expect(await customAdapter.getEntityFingerprint("feature", "checkout")).toBeUndefined();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("skips rereading unchanged test specs, but compares contents of recently written ones", async () => {
    // Permissions are how this observes reads, and they do not restrict root.
    if (process.getuid?.() === 0) return;
    const root = createProject("module.exports = {};");
    const file = path.join(root, "tests", "checkout.spec.yml");
    const age = (seconds: number) => {
      const time = new Date(Date.now() - seconds * 1000);
      fs.utimesSync(file, time, time);
    };
    writeFile(file, "feature: checkout\nassertions: []\n");
    age(60);
    const adapter = new FilesystemAdapter(getProjectConfig(root), root);
    try {
      await adapter.readEntity("test", "checkout");
      // An unreadable file proves the cached spec is served without reading it again.
      fs.chmodSync(file, 0o000);
      await expect(adapter.readEntity("test", "checkout")).resolves.toMatchObject({
        feature: "checkout",
      });

      // An edit changes size or time, so it is read again.
      fs.chmodSync(file, 0o644);
      writeFile(file, "feature: checkout\nassertions: [{ at: 1 }]\n");
      await expect(adapter.readEntity("test", "checkout")).resolves.toMatchObject({
        assertions: [{ at: 1 }],
      });
      // Written moments ago, it could still change within the same timestamp, so its
      // contents keep being read and compared.
      fs.chmodSync(file, 0o000);
      await expect(adapter.readEntity("test", "checkout")).rejects.toThrow();
    } finally {
      fs.chmodSync(file, 0o644);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
