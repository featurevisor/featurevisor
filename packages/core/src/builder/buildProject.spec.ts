import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFeaturevisor } from "@featurevisor/sdk";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { lintProject } from "../linter";
import { buildProjectSets } from "./buildProject";
import { buildRuntimeDatafiles } from "./buildRuntimeDatafiles";
import { getCustomDatafile } from "./buildDatafile";

describe("project build selections", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-build-selection-"));
    jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });
  function write(file: string, value: unknown) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(value));
  }
  function project(environments: string[] | undefined = undefined, sets = false) {
    fs.writeFileSync(
      path.join(root, "featurevisor.config.js"),
      `module.exports = ${JSON.stringify({ parser: "json", environments, sets })}`,
    );
    for (const prefix of sets ? ["sets/dev/", "sets/production/"] : [""]) {
      write(prefix + "attributes/userId.json", { description: "User", type: "string" });
      write(prefix + "features/ready.json", {
        description: "Ready",
        bucketBy: "userId",
        rules: environments
          ? { production: [{ key: "all", conditions: "*", percentage: 100 }] }
          : [{ key: "all", conditions: "*", percentage: 100 }],
      });
      write(prefix + "targets/all.json", { description: "All" });
    }
    const projectConfig = getProjectConfig(root);
    return {
      projectConfig,
      datasource: new Datasource(projectConfig, root),
      rootDirectoryPath: root,
      options: {},
    };
  }
  it("cleans unknown saved metadata even for definitions outside a selected Target", async () => {
    const deps = project();
    write("targets/only.json", { description: "Only ready", includeFeatures: ["ready"] });
    const untouched = {
      hash: "unchanged",
      variations: [{ value: "control", weight: 100 }],
      traffic: [
        {
          key: "stable",
          percentage: 50000,
          allocation: [{ variation: "control", range: [0, 50000] }],
        },
      ],
    };
    // Seed disk directly to represent a project not yet written by this CLI.
    write(".featurevisor/existing-state.json", {
      obsolete: true,
      features: {
        ready: { traffic: [], ranges: [[50001, 100000]] },
        noLongerDefined: { ...untouched, ranges: [[0, 100000]] },
      },
    });
    await buildProjectSets(deps, { target: ["only"] });
    const saved = await deps.datasource.readState(false);
    expect(saved).not.toHaveProperty("obsolete");
    expect(saved.features.noLongerDefined).toEqual(untouched);
    expect(saved.features.ready).not.toHaveProperty("ranges");
    const datafile = JSON.parse(
      fs.readFileSync(
        path.join(deps.projectConfig.datafilesDirectoryPath, "featurevisor-only.json"),
        "utf8",
      ),
    );
    expect(Object.keys(datafile.features)).toEqual(["ready"]);
    expect(datafile.features.ready).not.toHaveProperty("ranges");
  });

  it.each([false, true])(
    "rejects an environment in a flat project before writing (json=%s)",
    async (json) => {
      const deps = project();
      await expect(
        buildProjectSets(deps, { environment: "production", json }),
      ).rejects.toMatchObject({ code: "invalid_environment" });
      expect(fs.existsSync(deps.projectConfig.stateDirectoryPath)).toBe(false);
      expect(fs.existsSync(deps.projectConfig.datafilesDirectoryPath)).toBe(false);
      await expect(
        buildRuntimeDatafiles(deps, { environment: "production", revision: "test" }),
      ).rejects.toMatchObject({ code: "invalid_environment" });
    },
  );
  it.each([false, true])(
    "rejects unknown configured environments before writing (json=%s)",
    async (json) => {
      const deps = project(["staging", "production"]);
      await expect(buildProjectSets(deps, { environment: "typo", json })).rejects.toMatchObject({
        code: "invalid_environment",
      });
      expect(fs.existsSync(deps.projectConfig.datafilesDirectoryPath)).toBe(false);
    },
  );
  it("writes only the selected environment", async () => {
    const deps = project(["staging", "production"]);
    await buildProjectSets(deps, { environment: "production" });
    expect(
      fs.existsSync(
        path.join(deps.projectConfig.datafilesDirectoryPath, "production/featurevisor-all.json"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(deps.projectConfig.datafilesDirectoryPath, "staging"))).toBe(
      false,
    );
    expect(
      fs.existsSync(
        path.join(deps.projectConfig.stateDirectoryPath, "existing-state-staging.json"),
      ),
    ).toBe(false);
  });
  it("treats an omitted environment rule list as empty after successful lint", async () => {
    const deps = project(["staging", "production"]);
    expect((await lintProject(deps, { json: true })).hasError).toBe(false);
    const datafile = await getCustomDatafile({ ...deps, environment: "staging" });
    const f = createFeaturevisor({ datafile, logLevel: "fatal" });
    expect(f.isEnabled("ready", { userId: "1" })).toBe(false);
    f.close();
    await buildProjectSets(deps);
    expect(
      fs.existsSync(
        path.join(deps.projectConfig.datafilesDirectoryPath, "staging/featurevisor-all.json"),
      ),
    ).toBe(true);
  });
  it("requires a configured environment for single datafile operations", async () => {
    const deps = project(["staging", "production"]);
    await expect(buildProjectSets(deps, { json: true })).rejects.toMatchObject({
      code: "missing_environment",
    });
    await expect(
      buildRuntimeDatafiles(deps, { environment: false, revision: "test" }),
    ).rejects.toMatchObject({ code: "missing_environment" });
  });
  it.each([false, true])(
    "uses the custom directory for datafiles and revisions (sets=%s)",
    async (sets) => {
      const deps = project(undefined, sets);
      const out = path.join(root, "custom");
      await buildProjectSets(deps, { datafilesDir: out });
      expect(fs.readFileSync(path.join(out, deps.projectConfig.revisionFileName), "utf8")).toBe(
        "1",
      );
      for (const prefix of sets ? ["dev", "production"] : [""]) {
        expect(fs.existsSync(path.join(out, prefix, "featurevisor-all.json"))).toBe(true);
        expect(
          fs.readFileSync(path.join(out, prefix, deps.projectConfig.revisionFileName), "utf8"),
        ).toBe("1");
      }
      expect(fs.existsSync(deps.projectConfig.datafilesDirectoryPath)).toBe(false);
    },
  );
  it("keeps runtime builds free of state and revision writes", async () => {
    const deps = project();
    const output = await buildRuntimeDatafiles(deps, { environment: false, revision: "test" });
    expect(output).toHaveLength(1);
    expect(fs.existsSync(deps.projectConfig.stateDirectoryPath)).toBe(false);
    expect(fs.existsSync(deps.projectConfig.datafilesDirectoryPath)).toBe(false);
  });

  it.each([true, false])(
    "inflates global variables and preserves runtime behaviour (precompute=%s)",
    async (precomputeMutations) => {
      const deps = project();
      deps.projectConfig.precomputeMutations = precomputeMutations;
      write("variables/limit.json", { description: "Limit", type: "integer", defaultValue: 10 });
      write("variables/limit-0.json", {
        description: "Real names are preserved",
        type: "integer",
        defaultValue: 99,
      });
      write("variables/settings.json", {
        description: "Settings",
        type: "object",
        defaultValue: { entries: [], label: "limit" },
        conditions: [{ feature: "ready" }, { variable: "limit", operator: "equals", value: 10 }],

        overrides: [
          { key: "first", conditions: "*", mutate: { "entries:append": "one" }, continue: true },
          { key: "second", conditions: "*", mutate: { "entries:append": "two" } },
        ],
      });
      const base = await getCustomDatafile({ ...deps, environment: false });
      const inflated = await getCustomDatafile({ ...deps, environment: false, inflate: 3 });
      expect(Object.keys(inflated.features)).toHaveLength(Object.keys(base.features).length * 3);
      expect(Object.keys(inflated.variables!)).toHaveLength(
        Object.keys(base.variables!).length * 3,
      );
      expect(inflated.variables!.limit).toEqual(base.variables!.limit);
      expect(inflated.variables!["limit-0"]).toEqual(base.variables!["limit-0"]);
      const f = createFeaturevisor({ datafile: inflated });
      for (const key of ["settings", "settings-0", "settings-1"]) {
        expect(f.getVariable(key, { userId: "test" })).toEqual({
          entries: ["one", "two"],
          label: "limit",
        });
      }
      expect(f.getVariable("limit-0")).toBe(99);
      expect(f.getVariable("limit-1")).toBe(10);
      f.close();
      expect(fs.existsSync(deps.projectConfig.stateDirectoryPath)).toBe(false);
      expect(fs.existsSync(deps.projectConfig.datafilesDirectoryPath)).toBe(false);
    },
  );

  it.each([false, true])("rejects --set in flat projects before writes (json=%s)", async (json) => {
    const deps = project();
    await expect(buildProjectSets(deps, { set: "production", json })).rejects.toThrow("Omit --set");
    expect(fs.existsSync(deps.projectConfig.stateDirectoryPath)).toBe(false);
    expect(fs.existsSync(deps.projectConfig.datafilesDirectoryPath)).toBe(false);
  });

  it.each([0, -2, 1.5, NaN, Infinity])(
    "rejects invalid inflation %s before reads or writes",
    async (inflate) => {
      for (const json of [false, true]) {
        const deps = project();
        const read = jest.spyOn(deps.datasource, "readRevision");
        await expect(buildProjectSets(deps, { inflate, json })).rejects.toMatchObject({
          code: "invalid_number",
        });
        expect(read).not.toHaveBeenCalled();
        expect(fs.existsSync(deps.projectConfig.stateDirectoryPath)).toBe(false);
        expect(fs.existsSync(deps.projectConfig.datafilesDirectoryPath)).toBe(false);
      }
    },
  );
});
