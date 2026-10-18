import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { testPlugin } from "./testProject";
import type { TestReport } from "./report";

describe("core: test command reporting", () => {
  let root: string;
  function write(file: string, data: unknown) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, typeof data === "string" ? data : JSON.stringify(data));
  }
  async function run(options: Record<string, unknown> = {}) {
    const projectConfig = getProjectConfig(root);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const originalInfo = console.info;
    const originalDebug = console.debug;
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await testPlugin.handler({
        rootDirectoryPath: root,
        projectConfig,
        datasource: new Datasource(projectConfig, root),
        parsed: { json: true, ...options },
      } as any);
      expect(console.info).toBe(originalInfo);
      expect(console.debug).toBe(originalDebug);
      expect(console.log).toBe(log);
      expect(log).toHaveBeenCalledTimes(1);
      const json = log.mock.calls[0][0];
      return { report: JSON.parse(json) as TestReport, result, json, stderr: error.mock.calls };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  }
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-report-tests-"));
    write("featurevisor.config.js", 'module.exports = { parser: "json" };');
    write("variables/limit.json", { description: "Limit", type: "integer", defaultValue: 10 });
    write("variables/unused.json", { description: "Unused", type: "integer", defaultValue: 20 });
    write("tests/scenarios/limit.spec.json", {
      matrix: { expected: [10, 20] },
      checks: [
        { key: "capacity", variable: "limit", operator: "equals", value: "${{ expected }}" },
      ],
    });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it("emits one versioned document, disambiguates scenarios, and does not write project state", async () => {
    const before = fs.readdirSync(root, { recursive: true }).sort();
    const { report, result } = await run({ pretty: true, coverage: true, uncovered: true });
    expect(result).toBe(false);
    expect(report).toMatchObject({
      schemaVersion: 1,
      runner: "javascript",
      passed: false,
      errors: [],
      summary: {
        scenarioSpecs: { passed: 0, failed: 1 },
        scenarioCases: { passed: 1, failed: 1 },
        entityAssertions: { passed: 0, failed: 0 },
      },
    });
    expect(report.results[0].source).toBe("tests/scenarios/limit.spec.json");
    expect(report.results[0].key).toBe("scenarios.limit");
    expect(JSON.parse(report.results[0].cases[0].id)[2]).toBe("scenarios.limit");
    expect(report.results[0].cases[1].errors[0]).toMatchObject({
      path: ["checks", 0],
      details: { checkKey: "capacity" },
    });
    expect(report.coverage).toEqual({ mode: "observed-selections", selections: [] });
    expect(report.uncovered).toEqual([{ set: null, features: [], variables: ["unused"] }]);
    expect(fs.readdirSync(root, { recursive: true }).sort()).toEqual(before);
  });

  it("reruns the exact expanded case without renumbering its identity", async () => {
    const { report } = await run();
    const failed = report.results[0].cases[1];
    const rerun = await run({ case: failed.id });
    expect(rerun.report.summary.scenarioCases).toEqual({ passed: 0, failed: 1 });
    expect(rerun.report.results[0].cases[0].id).toBe(failed.id);
    expect(rerun.report.results[0].cases[0].matrixValues).toEqual({ expected: 20 });
  });

  it("uses the normalized entity identity in reports, source paths and exact reruns", async () => {
    write("tests/scenarios/limit-entity.spec.json", {
      variable: "limit",
      assertions: [{ key: "default", expectedValue: 10 }],
    });
    const { report } = await run();
    const entity = report.results.find(
      (result) => result.source === "tests/scenarios/limit-entity.spec.json",
    )!;
    expect(entity.source).toBe("tests/scenarios/limit-entity.spec.json");
    expect(JSON.parse(entity.cases[0].id)[2]).toBe("scenarios.limit-entity");
    const rerun = await run({ case: entity.cases[0].id });
    expect(rerun.report.results).toHaveLength(1);
    expect(rerun.report.results[0].key).toBe("limit");
    expect(rerun.report.results[0].cases[0].id).toBe(entity.cases[0].id);
  });

  it("keeps verbose diagnostics and shown datafiles off JSON stdout", async () => {
    const { report, stderr, json } = await run({ verbose: true, showDatafile: true, pretty: true });
    expect(report.schemaVersion).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
    expect(json).toMatch(/\n\s+"/);
  });

  it.each([{}, { quiet: true }, { verbose: true }])(
    "keeps SDK errors in the JSON report without changing command failure (%j)",
    async (options) => {
      write("variables/malformed.json", { type: "json", defaultValue: "{" });
      write("tests/scenarios/limit.spec.json", {
        checks: [{ variable: "malformed", operator: "isNull" }],
      });
      const { report, result, stderr } = await run(options);
      expect(result).toBe(false);
      expect(report.schemaVersion).toBe(1);
      expect(report.passed).toBe(false);
      expect(report.results[0].cases[0].errors[0]).toMatchObject({
        expected: "successful comparison",
        actual: expect.stringContaining("getVariable failed"),
      });
      if (!("quiet" in options)) {
        expect(stderr.flat().some((value) => String(value).includes("getVariable failed"))).toBe(
          true,
        );
      }
    },
  );

  it("reports unknown cases and malformed specs as infrastructure failures", async () => {
    const missing = await run({ case: "not-a-case" });
    expect(missing.result).toBe(false);
    expect(missing.report.errors).not.toHaveLength(0);
    expect(missing.report.passed).toBe(false);
    write("tests/scenarios/limit.spec.json", { checks: [] });
    const malformed = await run();
    expect(malformed.result).toBe(false);
    expect(malformed.report.passed).toBe(false);
    expect(malformed.report.errors).not.toHaveLength(0);
  });

  it.each([{}, { quiet: true }, { verbose: true }])(
    "prints a parse failure once before saying tests did not run (%j)",
    async (options) => {
      write("variables/broken.json", "{");
      const projectConfig = getProjectConfig(root);
      const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
      const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
      const result = await testPlugin.handler({
        rootDirectoryPath: root,
        projectConfig,
        datasource: new Datasource(projectConfig, root),
        parsed: options,
      } as any);
      expect(result).toBe(false);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain("variables/broken.json");
      const notice = log.mock.calls.findIndex((call) => call.includes("Tests did not run."));
      expect(notice).toBeGreaterThanOrEqual(0);
      expect(error.mock.invocationCallOrder[0]).toBeLessThan(log.mock.invocationCallOrder[notice]);
      expect(log.mock.calls.flat().join("\n")).not.toContain("Total cases:");
      if ("verbose" in options) expect(error.mock.calls[0][0]).toContain("Caused by:");
      else expect(error.mock.calls[0][0]).not.toContain("\n    at ");
    },
  );

  it("keeps zero counts and plain errors in the JSON failure contract", async () => {
    write("variables/broken.json", "{");
    const normal = await run();
    const verbose = await run({ verbose: true });
    expect(verbose.report).toEqual(normal.report);
    expect(normal.report.summary.assertions).toEqual({ passed: 0, failed: 0 });
    expect(Object.keys(normal.report.errors[0])).toEqual(["message"]);
    expect(normal.json).not.toContain("Tests did not run");
    expect(normal.json).not.toContain("Caused by:");
  });

  it.each([null, "control"])(
    "preserves warnings once for hidden passing and visible failing cases (%s)",
    async (expectedVariation) => {
      fs.rmSync(path.join(root, "tests/scenarios/limit.spec.json"));
      write("attributes/userId.json", { description: "User", type: "string" });
      write("features/checkout.json", {
        description: "Checkout",
        bucketBy: "userId",
        rules: [{ key: "all", conditions: "*", percentage: 100 }],
      });
      write("tests/checkout.spec.json", {
        feature: "checkout",
        assertions: [{ at: 0, expectedVariation }],
      });
      const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const projectConfig = getProjectConfig(root);
      const result = await testPlugin.handler({
        rootDirectoryPath: root,
        projectConfig,
        datasource: new Datasource(projectConfig, root),
        parsed: { onlyFailures: true },
      } as any);
      expect(result).toBe(expectedVariation === null ? undefined : false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('[Featurevisor] warn: No variations (feature "checkout")');
      const text = log.mock.calls.flat().join("\n");
      expect(text.includes("Testing:")).toBe(expectedVariation !== null);
      log.mockRestore();
      warn.mockRestore();
      const json = await run({ onlyFailures: true });
      expect(
        json.stderr.flat().filter((value) => String(value).includes("No variations")),
      ).toHaveLength(1);
      expect(json.report.passed).toBe(expectedVariation === null);
      expect(json.report.results[0].cases[0]).not.toHaveProperty("hints");
    },
  );

  it("uses sentence case and kebab case in test help examples", () => {
    for (const example of testPlugin.examples!) {
      expect(example.description).toMatch(/^[A-Z]/);
      expect(example.command).not.toMatch(/--[a-z-]*[A-Z]/);
    }
  });

  it.each(["", ["one", "two"]])(
    "rejects invalid exact case selectors instead of running everything",
    async (selector) => {
      const { report } = await run({ case: selector });
      expect(report.passed).toBe(false);
      expect(report.summary.assertions).toEqual({ passed: 0, failed: 0 });
      expect(report.errors[0].message).toContain("one nonempty case ID");
    },
  );

  it("preserves selected target filters in exact reruns and rejects excluded cases", async () => {
    write("targets/web.json", { description: "Web" });
    write("targets/mobile.json", { description: "Mobile" });
    write("tests/scenarios/limit.spec.json", {
      target: "web",
      checks: [{ variable: "limit", operator: "equals", value: 10 }],
    });
    const { report } = await run({ target: ["web"] });
    const testCase = report.results[0].cases[0];
    expect(testCase.rerun.args).toContain("--target=web");
    const excluded = await run({ target: ["mobile"], case: testCase.id });
    expect(excluded.report.passed).toBe(false);
    expect(excluded.report.errors).not.toHaveLength(0);
  });

  it("keeps association gaps independent of case and key filters", async () => {
    const all = await run({ uncovered: true });
    const filtered = await run({ uncovered: true, case: all.report.results[0].cases[0].id });
    expect(filtered.report.uncovered).toEqual(all.report.uncovered);
  });

  it("explains a missing spec owner instead of returning an unexplained failed spec", async () => {
    write("tests/missing.spec.json", {
      segment: "missing",
      assertions: [{ context: {}, expectedToMatch: true }],
    });
    const { report, result } = await run();
    expect(result).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('segment "missing" not found'),
        }),
      ]),
    );
  });

  it("finds an exact case across sets without treating an earlier unmatched set as a failure", async () => {
    write("featurevisor.config.js", 'module.exports = { parser: "json", sets: true };');
    for (const set of ["a", "b"]) {
      write(`sets/${set}/variables/limit.json`, { type: "integer", defaultValue: 10 });
      write(`sets/${set}/tests/scenarios/limit.spec.json`, {
        checks: [{ variable: "limit", operator: "equals", value: 10 }],
      });
    }
    const all = await run();
    expect(all.report.summary.scenarioCases).toEqual({ passed: 2, failed: 0 });
    const selected = all.report.results.find((spec) => spec.set === "b")!.cases[0];
    const rerun = await run({ case: selected.id });
    expect(rerun.report.passed).toBe(true);
    expect(rerun.report.summary.scenarioCases).toEqual({ passed: 1, failed: 0 });
    expect(rerun.report.results[0].set).toBe("b");
    expect((await run({ case: "does-not-exist" })).report.errors).not.toHaveLength(0);
  });
});
