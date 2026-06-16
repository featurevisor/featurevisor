import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { exportCatalog, type CatalogRuntime } from ".";

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
    groupsDirectoryPath: path.join(root, "groups"),
    schemasDirectoryPath: path.join(root, "schemas"),
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
        staging: [{ key: "rule", segments: segmentKey, percentage: 100, enabled: true }],
        production: [],
      },
    }),
    listSegments: async () => [segmentKey],
    readSegment: async () => ({
      key: segmentKey,
      description: "Premium users",
      conditions: [{ attribute: "plan", operator: "equals", value: "premium" }],
    }),
    listAttributes: async () => ["plan"],
    readAttribute: async () => ({ key: "plan", type: "string", description: "Plan" }),
    listTargets: async () => ["premiumWeb", "mobile"],
    readTarget: async (key: string) =>
      key === "premiumWeb"
        ? { key, description: "Premium web", tags: { and: ["web", "premium"] } }
        : { key, description: "Mobile", tag: "mobile" },
    listGroups: async () => [],
    readGroup: async () => undefined,
    listSchemas: async () => [],
    readSchema: async () => undefined,
    listTests: async () => ["checkout"],
    readTest: async () => ({ key: "checkout", feature: featureKey, assertions: [] }),
  };
}

function createRuntime(): CatalogRuntime {
  return {
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
          groupsDirectoryPath: path.join(projectConfig.setsDirectoryPath, set, "groups"),
          schemasDirectoryPath: path.join(projectConfig.setsDirectoryPath, set, "schemas"),
          testsDirectoryPath: path.join(projectConfig.setsDirectoryPath, set, "tests"),
        },
        datasource: datasource.forSet(set),
      }));
    },
  };
}

describe("catalog export", () => {
  it("writes manifest, index, and feature detail for a root project", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));

    await exportCatalog(createRuntime(), root, createProjectConfig(root), createDatasource(), {
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
    expect(index.entities.feature[0].targets).toEqual(["premiumWeb"]);
    expect(detail.relationships).toMatchObject({
      segments: ["premiumUsers"],
      targets: ["premiumWeb"],
      tests: ["checkout"],
    });
  });

  it("writes per-set catalog files for sets-enabled projects", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));

    await exportCatalog(
      createRuntime(),
      root,
      createProjectConfig(root, true),
      createDatasource(),
      {
        copyAssets: false,
      },
    );

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
  });
});
