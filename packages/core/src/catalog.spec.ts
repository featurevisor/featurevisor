import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "./config";
import { Datasource } from "./datasource";
import { getCatalogTargetMemberships, reloadCatalogProject } from "./catalog";
import { buildTargetDatafile } from "./builder/buildProject";
import { buildDependencyGraph } from "./datasource/dependencies";

describe("core: Catalog bridge", () => {
  it("reports memberships from the builder's exclusions, expose rules, and mixed closure", async () => {
    const root = path.resolve(__dirname, "../../../examples/example-1");
    const projectConfig = { ...getProjectConfig(root), environments: ["production"] };
    const datasource = new Datasource(projectConfig, root);
    const catalogDatasource = Object.assign(Object.create(datasource), {
      listTargets: async () => ["mixed"],
      readTarget: async () => ({
        includeFeatures: ["hidden", "variableRequirementsExample"],
        excludeFeatures: ["variableRequirementsExample", "variablePolicySource"],
        includeVariables: ["runtimeMessage"],
        excludeVariables: ["runtimePolicy"],
      }),
    }) as Datasource;

    const memberships = await getCatalogTargetMemberships(projectConfig, catalogDatasource);
    expect(memberships).toEqual({
      mixed: {
        features: ["variablePolicySource", "variableRequirementsExample"],
        variables: ["runtimeMessage", "runtimePolicy"],
        segments: [],
        // Excluded by the Target, yet required by the selected runtimeMessage.
        dependencyFeatures: ["variablePolicySource", "variableRequirementsExample"],
        dependencyVariables: ["runtimePolicy"],
        datafiles: [
          { environment: "production", bytes: expect.any(Number), gzipBytes: expect.any(Number) },
        ],
      },
    });
    const [size] = memberships.mixed.datafiles;
    expect(size.bytes).toBeGreaterThan(size.gzipBytes);
    expect(size.gzipBytes).toBeGreaterThan(0);
  });

  it("reports the segments each Target's datafile carries", async () => {
    const root = path.resolve(__dirname, "../../../examples/example-1");
    const projectConfig = { ...getProjectConfig(root), environments: ["production"] };
    const datasource = new Datasource(projectConfig, root);
    const target = { includeFeatures: ["allowSignup"] };
    const catalogDatasource = Object.assign(Object.create(datasource), {
      listTargets: async () => ["signup"],
      readTarget: async () => target,
    }) as Datasource;

    const { signup } = await getCatalogTargetMemberships(projectConfig, catalogDatasource);
    const datafile = await buildTargetDatafile({
      projectConfig,
      datasource,
      target: target as any,
      environment: "production",
      existingState: await datasource.readState("production"),
      revision: "catalog",
    });
    expect(signup.segments).toContain("countries.netherlands");
    expect(signup.segments).toEqual(Object.keys(datafile.segments).sort());
  });

  it("builds the same datafiles from frozen definitions, so the builder never mutates its input", async () => {
    const root = path.resolve(__dirname, "../../../examples/example-1");
    const projectConfig = getProjectConfig(root);
    const freeze = <T>(value: T): T => {
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(freeze);
      }
      return value;
    };
    const build = async (frozen: boolean) => {
      const datasource = new Datasource(projectConfig, root);
      if (!frozen) return getCatalogTargetMemberships(projectConfig, datasource);
      // Example 1 has variation overrides and force entries, which the builder once rewrote.
      const shared = new Map<string, unknown>();
      const read = datasource.readFeature.bind(datasource);
      const readOnce = async (key: string) => {
        if (!shared.has(key)) shared.set(key, freeze(await read(key)));
        return shared.get(key);
      };
      return getCatalogTargetMemberships(
        projectConfig,
        Object.assign(Object.create(datasource), { readFeature: readOnce }) as Datasource,
      );
    };
    expect(await build(true)).toEqual(await build(false));
  });

  it("builds identical datafiles when one dependency graph is shared by every Target", async () => {
    const root = path.resolve(__dirname, "../../../examples/example-1");
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    const graph = await buildDependencyGraph(datasource);
    for (const targetKey of await datasource.listTargets()) {
      const target = await datasource.readTarget(targetKey);
      for (const environment of projectConfig.environments as string[]) {
        const build = (dependencyGraph?: Map<string, Set<string>>) =>
          buildTargetDatafile({
            projectConfig,
            datasource,
            target,
            environment,
            existingState: structuredClone(state[environment]),
            revision: "test",
            dependencyGraph,
          });
        const state = { [environment]: await datasource.readState(environment) };
        expect(await build(graph)).toEqual(await build());
      }
    }
  });

  it("estimates datafile sizes with the project's own formatting", async () => {
    const root = path.resolve(__dirname, "../../../examples/example-1");
    const sizeWith = async (prettyDatafile: boolean) => {
      const projectConfig = {
        ...getProjectConfig(root),
        environments: ["production"],
        prettyDatafile,
      };
      const datasource = Object.assign(Object.create(new Datasource(projectConfig, root)), {
        listTargets: async () => ["all"],
        readTarget: async () => ({ tag: "all" }),
      }) as Datasource;
      const memberships = await getCatalogTargetMemberships(projectConfig, datasource);
      return memberships.all.datafiles[0].bytes;
    };
    expect(await sizeWith(true)).toBeGreaterThan(await sizeWith(false));
  });

  it("evicts the config module before creating a fresh datasource", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-reload-"));
    const configPath = path.join(root, "featurevisor.config.js");

    try {
      fs.writeFileSync(configPath, "module.exports = { tags: ['first'] };\n");
      const first = await reloadCatalogProject(root);
      expect(first.projectConfig.tags).toEqual(["first"]);

      fs.writeFileSync(configPath, "module.exports = { tags: ['second'] };\n");
      // Jest keeps its own module registry in addition to Node's require.cache.
      jest.resetModules();
      const second = await reloadCatalogProject(root);
      expect(second.projectConfig.tags).toEqual(["second"]);
      expect(second.datasource).not.toBe(first.datasource);
      expect(second.datasource.getConfig()).toBe(second.projectConfig);
    } finally {
      const resolvedConfigPath = require.resolve(configPath);
      delete require.cache[resolvedConfigPath];
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
