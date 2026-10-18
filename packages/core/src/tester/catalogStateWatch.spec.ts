import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { getProjectSetExecutions } from "../sets";
import { getCatalogTargetMemberships, reloadCatalogProject } from "../catalog";
import { createTestReport } from "./report";
import { testProject } from "./testProject";
import { getTestInputFingerprint, getTestInputStatePaths } from "./provenance";

// Exercise sibling source without including it in Core's declaration root.
const { exportCatalog, startCatalogDevMode } = require("../../../catalog/src/node");

describe("Catalog live allocation state provenance", () => {
  let root: string;
  let externalState: string;
  let controller: { stop: () => Promise<void> } | undefined;
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  async function until(predicate: () => boolean) {
    for (let attempt = 0; attempt < 500 && !predicate(); attempt++) await delay(10);
    if (!predicate())
      throw new Error(
        `Live Catalog did not reach the expected state: ${jest.mocked(console.error).mock.calls.flat().map(String).join("; ")}`,
      );
  }
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "catalog-state-watch-")));
    externalState = `${root}-state`;
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    await controller?.stop();
    controller = undefined;
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(externalState, { recursive: true, force: true });
  });

  it.each([
    { sets: false, custom: false },
    { sets: false, custom: true },
    { sets: true, custom: false },
    { sets: true, custom: true },
  ])(
    "updates live reports for sets=$sets customState=$custom without output loops",
    async ({ sets, custom }) => {
      write(
        path.join(root, "featurevisor.config.js"),
        `module.exports = ${JSON.stringify({ parser: "json", sets, ...(custom ? { stateDirectoryPath: externalState, environments: ["staging", "production"] } : {}) })};`,
      );
      for (const set of sets ? ["dev", "production"] : [""]) {
        const base = set ? path.join(root, "sets", set) : root;
        write(path.join(base, "variables/limit.json"), { type: "integer", defaultValue: 10 });
        write(path.join(base, "tests/limit.spec.json"), {
          variable: "limit",
          assertions: [
            { key: "named", expectedValue: 10, ...(custom ? { environment: "staging" } : {}) },
          ],
        });
      }
      const projectConfig = getProjectConfig(root);
      const datasource = new Datasource(projectConfig, root);
      const executions = await getProjectSetExecutions(projectConfig, datasource);
      for (const execution of executions) {
        for (const file of getTestInputStatePaths(execution.projectConfig))
          write(file, { features: {} });
      }
      const report = createTestReport();
      for (const execution of executions)
        await testProject(
          { ...execution, rootDirectoryPath: root, options: {} },
          { report, json: true, set: execution.set || null },
        );
      const reportPath = path.join(root, "saved-report.json");
      write(reportPath, report);
      const fingerprint = jest.fn(getTestInputFingerprint);
      const runtime = {
        getProjectSetExecutions,
        getCatalogTargetMemberships,
        reloadCatalogProject,
        getTestInputFingerprint: fingerprint,
        getTestInputStatePaths,
      };
      const published: any[] = [];
      const server = {
        close: jest.fn(async () => {}),
        setOutputDirectoryPath: jest.fn(),
        setBasePath: jest.fn(),
        triggerReload: jest.fn(),
      };
      const api = {
        exportCatalog: async (...args: any[]) => {
          const result = await exportCatalog(runtime, ...args);
          published.push(result.manifest);
          return result;
        },
        serveCatalog: async () => server,
      };
      controller = await startCatalogDevMode(runtime, api, root, projectConfig, datasource, {
        _: [],
        testReport: reportPath,
        assets: false,
      });
      const latest = () => published[published.length - 1];
      expect(latest().testReport.verification).toBe("current");
      // Allow a platform's native watcher failure and first polling invalidation to settle.
      await delay(1600);
      const original = published[0];
      const scope = (manifest: any) =>
        Object.fromEntries(
          Object.entries(manifest.storage.groups).filter(([key]) =>
            key.startsWith("data/sets/production/"),
          ),
        );
      const changedExecution = executions[0];
      const state = getTestInputStatePaths(changedExecution.projectConfig)[0];
      fingerprint.mockClear();
      write(`${state}.tmp`, { features: { retired: { traffic: [] } } });
      fs.renameSync(`${state}.tmp`, state);
      await until(() => latest().testReport.verification === "stale");
      if (sets) {
        expect(scope(latest())).toEqual(scope(original));
        expect(
          fingerprint.mock.calls.every(
            ([config]) =>
              config.stateDirectoryPath === changedExecution.projectConfig.stateDirectoryPath,
          ),
        ).toBe(true);
      }
      // Returning to the original inputs proves state is reread in the same process.
      write(state, { features: {} });
      await until(() => latest().testReport.verification === "current");
      write(state, { features: { retired: { traffic: [] } } });
      await until(() => latest().testReport.verification === "stale");
      fs.rmSync(state);
      await until(() => latest().testReport.verification === "current");
      write(state, { features: { retired: { traffic: [] } } });
      await until(() => latest().testReport.verification === "stale");
      await delay(400);
      const count = published.length;
      write(path.join(path.dirname(state), "REVISION"), "next");
      write(path.join(path.dirname(state), "other.json"), {});
      write(path.join(root, "datafiles/other.json"), {});
      await delay(500);
      expect(published).toHaveLength(count);
      expect(server.triggerReload).toHaveBeenCalled();
    },
    15000,
  );
});
