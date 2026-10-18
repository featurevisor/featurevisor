import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import * as provenance from "./provenance";
import { createTestReport } from "./report";
import { testProject, testPlugin } from "./testProject";

jest.mock("./provenance", () => {
  const actual = jest.requireActual("./provenance");
  return {
    ...actual,
    getTestInputFingerprint: jest.fn(actual.getTestInputFingerprint),
    createTestInputSnapshot: jest.fn(actual.createTestInputSnapshot),
  };
});

describe("optional report preparation", () => {
  let root: string;
  const write = (file: string, value: unknown) => {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, typeof value === "string" ? value : JSON.stringify(value));
  };
  const dependencies = () => {
    const projectConfig = getProjectConfig(root);
    return {
      projectConfig,
      datasource: new Datasource(projectConfig, root),
      rootDirectoryPath: root,
      options: {},
    };
  };
  beforeEach(() => {
    jest.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "report-preparation-"));
    write("featurevisor.config.js", 'module.exports = { parser: "json" };');
    write("variables/limit.json", { description: "Limit", type: "integer", defaultValue: 10 });
    write("tests/limit.spec.json", { variable: "limit", assertions: [{ expectedValue: 10 }] });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([false, true])(
    "does not fingerprint ordinary text runs (shared report=%s)",
    async (shared) => {
      const fingerprint = jest.mocked(provenance.getTestInputFingerprint);
      const snapshot = jest.mocked(provenance.createTestInputSnapshot);
      write("schemas/unrelated.json", "{broken JSON");
      const report = shared ? createTestReport() : undefined;
      expect(await testProject(dependencies(), { onlyFailures: true, report })).toBe(false);
      expect(fingerprint).not.toHaveBeenCalled();
      expect(snapshot).not.toHaveBeenCalled();
      if (report) expect(report.provenance).toBeUndefined();
      expect(console.warn).not.toHaveBeenCalled();
    },
  );

  it("does not fingerprint the CLI's internally shared text report", async () => {
    const fingerprint = jest.mocked(provenance.getTestInputFingerprint);
    await testPlugin.handler({ ...dependencies(), parsed: { _: [], onlyFailures: true } });
    expect(fingerprint).not.toHaveBeenCalled();
  });

  it.each([0, -5, 1.5, NaN, "invalid", ""])(
    "rejects invalid explicit test inflation before preparation: %s",
    async (inflate) => {
      const fingerprint = jest.mocked(provenance.getTestInputFingerprint);
      const deps = dependencies();
      const read = jest.spyOn(deps.datasource, "listFeatures");
      expect(await testPlugin.handler({ ...deps, parsed: { _: [], json: true, inflate } })).toBe(
        false,
      );
      expect(fingerprint).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      const calls = jest.mocked(console.log).mock.calls;
      const report = JSON.parse(calls[calls.length - 1][0]);
      expect(report.passed).toBe(false);
      expect(report.errors[0].message).toContain("--inflate must be a positive integer");
    },
  );

  it("includes preparation in the execution timer and fingerprints JSON inputs", async () => {
    const now = jest.spyOn(Date, "now");
    const fingerprint = jest.mocked(provenance.getTestInputFingerprint);
    const report = createTestReport();
    await testProject(dependencies(), { json: true, report });
    expect(now.mock.invocationCallOrder[0]).toBeLessThan(fingerprint.mock.invocationCallOrder[0]);
    expect(report.provenance?.sets).toEqual([
      { set: null, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
    expect(report.passed).toBe(true);
  });

  it("leaves failed fingerprinting unverified without failing otherwise valid tests", async () => {
    write("schemas/unrelated.json", "{broken JSON");
    const report = createTestReport();
    report.provenance = {
      version: 1,
      algorithm: "sha256",
      sets: [{ set: null, fingerprint: "old" }],
    };
    expect(await testProject(dependencies(), { json: true, report })).toBe(false);
    expect(report.provenance?.sets).toEqual([]);
    expect(report.summary.entityAssertions.passed).toBe(1);
    expect(report.passed).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('schema "unrelated"'));
  });

  it("does not hide input failures needed by execution", async () => {
    write("variables/limit.json", "{broken JSON");
    await expect(testProject(dependencies(), { json: true })).rejects.toThrow();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('variable "limit"'));
  });

  it("does not accumulate duplicate provenance when a report is reused", async () => {
    const report = createTestReport();
    await testProject(dependencies(), { json: true, report });
    await testProject(dependencies(), { json: true, report });
    expect(report.provenance?.sets).toHaveLength(1);
    await testProject(dependencies(), { report, onlyFailures: true });
    expect(report.provenance?.sets).toEqual([]);
  });

  it("does not relabel mixed or previously unverified results as current", async () => {
    const report = createTestReport();
    await testProject(dependencies(), { json: true, report });
    write("variables/limit.json", {
      description: "Changed inputs",
      type: "integer",
      defaultValue: 10,
    });
    await testProject(dependencies(), { json: true, report });
    expect(report.provenance?.sets).toEqual([]);
    await testProject(dependencies(), { json: true, report });
    expect(report.provenance?.sets).toEqual([]);
    expect(report.passed).toBe(true);
  });
});
