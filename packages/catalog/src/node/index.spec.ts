import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as childProcess from "child_process";

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
        staging: [
          {
            key: "rule",
            segments: segmentKey,
            conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
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
    listGroups: async () => [],
    readGroup: async () => undefined,
    listSchemas: async () => [],
    readSchema: async () => undefined,
    listTests: async () => ["checkout-primary", "checkout-matrix", "premium-users"],
    readTest: async (key: string) => {
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

function git(root: string, args: string[]) {
  childProcess.execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
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
    expect(index.entities.segment[0].targets).toEqual(["premiumWeb"]);
    expect(index.entities.segment[0].usedInFeatureCount).toBe(1);
    expect(
      index.entities.attribute.find((entity: any) => entity.key === "country").targets,
    ).toEqual(["premiumWeb"]);
    expect(index.entities.attribute.find((entity: any) => entity.key === "plan").targets).toEqual([
      "premiumWeb",
    ]);
    expect(
      index.entities.attribute.find((entity: any) => entity.key === "plan").usedInSegmentCount,
    ).toBe(1);
    expect(detail.relationships).toMatchObject({
      segments: ["premiumUsers"],
      attributes: ["country"],
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

  it("writes slash-namespaced entity details as nested data paths", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));
    const projectConfig = {
      ...createProjectConfig(root),
      namespaceCharacter: "/",
    };
    const baseDatasource = createDatasource();
    const featureKey = "checkout/redesign";
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
      listTests: async () => ["features/checkout/redesign.spec"],
      readTest: async () => ({
        key: "features/checkout/redesign.spec",
        feature: featureKey,
        assertions: [],
      }),
    };

    await exportCatalog(createRuntime(), root, projectConfig, datasource, {
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
          "entities",
          "feature",
          "checkout",
          "redesign",
          "history",
          "page-1.json",
        ),
      ),
    ).toBe(true);
    expect(index.entities.feature[0].key).toBe(featureKey);
    expect(index.entities.feature[0].href).toBe("entities/feature/checkout/redesign.json");
    expect(detail.sourcePath).toBe("features/checkout/redesign.yml");
    expect(detail.historyPath).toBe("data/root/entities/feature/checkout/redesign/history");
  });

  it("exports repository source links and dev editor links", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-catalog-"));

    git(root, ["init"]);
    git(root, ["checkout", "-b", "catalog-test"]);
    git(root, ["remote", "add", "origin", "git@github.com:featurevisor/featurevisor.git"]);

    await exportCatalog(createRuntime(), root, createProjectConfig(root), createDatasource(), {
      copyAssets: false,
      dev: true,
      devEditors: [{ id: "cursor", label: "Cursor", icon: "cursor" }],
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
      commit: "https://github.com/featurevisor/featurevisor/commit/{{hash}}",
    });
    expect(manifest.dev.editors).toEqual([{ id: "cursor", label: "Cursor", icon: "cursor" }]);
    expect(detail.sourcePath).toBe("features/checkout.yml");
    expect(detail.editLinks.cursor).toMatch(/^cursor:\/\/file\/.+features\/checkout\.yml$/);
  });
});
