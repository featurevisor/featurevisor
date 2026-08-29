import type { ParsedFeature, ParsedVariable } from "@featurevisor/types";

import { formatDatafileSize, listEntities, listProject } from "./index";

function createFeatureFixture(overrides: Partial<ParsedFeature> = {}): ParsedFeature {
  return {
    key: "untagged",
    description: "Untagged feature",
    bucketBy: "userId",
    rules: {
      staging: [{ key: "everyone", segments: "*", percentage: 100 }],
      production: [{ key: "everyone", segments: "*", percentage: 100 }],
    },
    ...overrides,
  };
}

describe("core: list", function () {
  test("excludes features with missing tags when tag filter is provided", async function () {
    const datasource = {
      listFeatures: async () => ["untagged"],
      readFeature: async () => createFeatureFixture(),
    };

    const result = await listEntities<ParsedFeature>(
      {
        rootDirectoryPath: "",
        projectConfig: {} as any,
        datasource: datasource as any,
        options: {
          tag: "all",
        },
      },
      "feature",
    );

    expect(result).toEqual([]);
  });

  test("lists the union of features selected by repeated targets", async function () {
    const featureFixtures = {
      web: createFeatureFixture({ key: "web", tags: ["web"] }),
      mobile: createFeatureFixture({ key: "mobile", tags: ["mobile"] }),
      internal: createFeatureFixture({ key: "internal", tags: ["internal"] }),
    };
    const datasource = {
      listFeatures: async () => Object.keys(featureFixtures),
      readFeature: async (key: keyof typeof featureFixtures) => featureFixtures[key],
      listTargets: async () => ["web", "mobile"],
      readTarget: async (key: string) => ({ description: key, tag: key }),
    };

    const result = await listEntities<ParsedFeature>(
      {
        rootDirectoryPath: "",
        projectConfig: {} as any,
        datasource: datasource as any,
        options: { target: ["web", "mobile"] },
      },
      "feature",
    );

    expect(result.map((feature) => feature.key).sort()).toEqual(["mobile", "web"]);
  });

  test("filters global variables by tags, targets, and test presence", async function () {
    const variableFixtures: Record<string, ParsedVariable> = {
      checkout: {
        description: "Checkout settings",
        type: "object",
        defaultValue: {},
        tags: ["web", "checkout"],
      },
      mobile: {
        description: "Mobile settings",
        type: "object",
        defaultValue: {},
        tags: ["mobile"],
      },
    };
    const datasource = {
      listVariables: async () => Object.keys(variableFixtures),
      readVariable: async (key: string) => variableFixtures[key],
      listTargets: async () => ["web"],
      readTarget: async () => ({ description: "Web", tag: "web" }),
      listTests: async () => ["checkout"],
      readTest: async () => ({ variable: "checkout", assertions: [] }),
    };
    const deps = {
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: {},
    };

    await expect(
      listEntities<ParsedVariable>({ ...deps, options: { tag: "checkout" } }, "variable"),
    ).resolves.toEqual([expect.objectContaining({ key: "checkout" })]);
    await expect(
      listEntities<ParsedVariable>({ ...deps, options: { target: "web" } }, "variable"),
    ).resolves.toEqual([expect.objectContaining({ key: "checkout" })]);
    await expect(
      listEntities<ParsedVariable>({ ...deps, options: { withTests: true } }, "variable"),
    ).resolves.toEqual([expect.objectContaining({ key: "checkout" })]);
    await expect(
      listEntities<ParsedVariable>({ ...deps, options: { withoutTests: true } }, "variable"),
    ).resolves.toEqual([expect.objectContaining({ key: "mobile" })]);
  });

  test("excludes archived definitions by default and filters either archived status", async function () {
    const fixtures = {
      active: createFeatureFixture({ key: "active" }),
      archived: createFeatureFixture({ key: "archived", archived: true }),
    };
    const datasource = {
      listFeatures: async () => Object.keys(fixtures),
      readFeature: async (key: keyof typeof fixtures) => fixtures[key],
    };
    const deps = {
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: {},
    };

    await expect(listEntities<ParsedFeature>(deps, "feature")).resolves.toEqual([
      expect.objectContaining({ key: "active" }),
    ]);
    await expect(
      listEntities<ParsedFeature>({ ...deps, options: { archived: true } }, "feature"),
    ).resolves.toEqual([expect.objectContaining({ key: "archived" })]);
    await expect(
      listEntities<ParsedFeature>({ ...deps, options: { archived: false } }, "feature"),
    ).resolves.toEqual([expect.objectContaining({ key: "active" })]);
  });

  test("filters definitions by promotable status", async function () {
    const fixtures = {
      shared: createFeatureFixture({ key: "shared", promotable: true }),
      local: createFeatureFixture({ key: "local", promotable: false }),
      defaultPromotable: createFeatureFixture({ key: "defaultPromotable" }),
    };
    const datasource = {
      listFeatures: async () => Object.keys(fixtures),
      readFeature: async (key: keyof typeof fixtures) => fixtures[key],
    };

    const result = await listEntities<ParsedFeature>(
      {
        rootDirectoryPath: "",
        projectConfig: {} as any,
        datasource: datasource as any,
        options: { promotable: true },
      },
      "feature",
    );

    expect(result).toEqual([
      expect.objectContaining({ key: "shared" }),
      expect.objectContaining({ key: "defaultPromotable" }),
    ]);

    const protectedResult = await listEntities<ParsedFeature>(
      {
        rootDirectoryPath: "",
        projectConfig: {} as any,
        datasource: datasource as any,
        options: { promotable: false },
      },
      "feature",
    );
    expect(protectedResult).toEqual([expect.objectContaining({ key: "local" })]);
  });

  test("only lists features enabled in the requested environment", async function () {
    const fixtures = {
      enabled: createFeatureFixture({ key: "enabled" }),
      disabled: createFeatureFixture({
        key: "disabled",
        rules: { production: [{ key: "off", segments: "*", percentage: 0 }] },
      }),
      missing: createFeatureFixture({ key: "missing", rules: { staging: [] } }),
    };
    const datasource = {
      listFeatures: async () => Object.keys(fixtures),
      readFeature: async (key: keyof typeof fixtures) => fixtures[key],
    };

    const result = await listEntities<ParsedFeature>(
      {
        rootDirectoryPath: "",
        projectConfig: {} as any,
        datasource: datasource as any,
        options: { enabledIn: "production" },
      },
      "feature",
    );

    expect(result).toEqual([expect.objectContaining({ key: "enabled" })]);
  });

  test("treats empty variation and variable collections as absent", async function () {
    const datasource = {
      listFeatures: async () => ["empty"],
      readFeature: async () =>
        createFeatureFixture({ key: "empty", variations: [], variablesSchema: {} }),
    };
    const deps = {
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: {},
    };

    await expect(
      listEntities<ParsedFeature>({ ...deps, options: { withVariations: true } }, "feature"),
    ).resolves.toEqual([]);
    await expect(
      listEntities<ParsedFeature>({ ...deps, options: { withoutVariations: true } }, "feature"),
    ).resolves.toHaveLength(1);
    await expect(
      listEntities<ParsedFeature>({ ...deps, options: { withVariables: true } }, "feature"),
    ).resolves.toEqual([]);
    await expect(
      listEntities<ParsedFeature>({ ...deps, options: { withoutVariables: true } }, "feature"),
    ).resolves.toHaveLength(1);
  });

  test("lists groups and schemas", async function () {
    const datasource = {
      listGroups: async () => ["checkout"],
      readGroup: async () => ({ description: "Checkout group", slots: [] }),
      listSchemas: async () => ["price"],
      readSchema: async () => ({ description: "Price", type: "double" }),
    };
    const deps = {
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: {},
    };

    await expect(listEntities({ ...deps, options: {} }, "group")).resolves.toEqual([
      expect.objectContaining({ key: "checkout" }),
    ]);
    await expect(listEntities({ ...deps, options: {} }, "schema")).resolves.toEqual([
      expect.objectContaining({ key: "price" }),
    ]);
  });

  test("rejects missing, repeated, and conflicting list selections", async function () {
    const deps = {
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: {} as any,
      options: {},
    };

    await expect(listProject(deps)).rejects.toThrow("Select one entity type");
    await expect(
      listProject({ ...deps, options: { features: true, segments: true } }),
    ).rejects.toThrow("Select only one entity type");
    await expect(
      listProject({
        ...deps,
        options: { features: true, withTests: true, withoutTests: true },
      }),
    ).rejects.toThrow("cannot be combined");
  });

  test("reports invalid regular expression filters", async function () {
    const datasource = {
      listFeatures: async () => ["checkout"],
      readFeature: async () => createFeatureFixture({ key: "checkout" }),
    };

    await expect(
      listEntities<ParsedFeature>(
        {
          rootDirectoryPath: "",
          projectConfig: {} as any,
          datasource: datasource as any,
          options: { keyPattern: "[" },
        },
        "feature",
      ),
    ).rejects.toThrow("Invalid --keyPattern");
  });

  test("lists generated datafiles", async function () {
    const log = jest.spyOn(console, "log").mockImplementation();
    const datasource = {
      listDatafiles: async () => [
        { path: "production/featurevisor-all.json", size: 42, gzipSize: 62 },
      ],
    };

    await listProject({
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: { datafiles: true, json: true },
    });

    expect(log).toHaveBeenCalledWith(
      '[{"path":"production/featurevisor-all.json","size":42,"gzipSize":62}]',
    );
    log.mockRestore();
  });

  test("formats datafile sizes with colored units", function () {
    expect(formatDatafileSize(42)).toBe("42.00 \u001b[33mB\u001b[0m");
    expect(formatDatafileSize(1024)).toBe("1.00 \u001b[36mkB\u001b[0m");
    expect(formatDatafileSize(1024 * 1024)).toBe("1.00 \u001b[32mmB\u001b[0m");
  });

  test("prints datafiles in aligned columns", async function () {
    const log = jest.spyOn(console, "log").mockImplementation();
    const datasource = {
      listDatafiles: async () => [
        { path: "production/featurevisor-all.json", size: 1024 * 1024, gzipSize: 1024 },
        { path: "staging/featurevisor-checkout.json", size: 42, gzipSize: 24 },
        { path: "development/featurevisor-all.json", size: 1024, gzipSize: 512 },
      ],
    };

    await listProject({
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: { datafiles: true },
    });

    const output = log.mock.calls.map(([message]) => message).join("\n");
    const uncoloredOutput = output.replace(/\u001b\[[0-9;]*m/g, "");

    expect(uncoloredOutput).toContain("Datafile");
    expect(uncoloredOutput).toContain("Size");
    expect(uncoloredOutput).toContain("Gzip");
    expect(uncoloredOutput).toContain("production/featurevisor-all.json");
    expect(uncoloredOutput).toContain("staging/featurevisor-checkout.json");
    expect(uncoloredOutput.indexOf("development/featurevisor-all.json")).toBeLessThan(
      uncoloredOutput.indexOf("staging/featurevisor-checkout.json"),
    );
    expect(uncoloredOutput.indexOf("staging/featurevisor-checkout.json")).toBeLessThan(
      uncoloredOutput.indexOf("production/featurevisor-all.json"),
    );
    expect(uncoloredOutput).toMatch(/development\/featurevisor-all\.json\s+1\.00 kB/);
    expect(uncoloredOutput).toMatch(/development\/featurevisor-all\.json\s+1\.00 kB\s+512\.00  B/);
    expect(uncoloredOutput).toMatch(/staging\/featurevisor-checkout\.json\s+42\.00  B/);
    expect(uncoloredOutput).toMatch(/production\/featurevisor-all\.json\s+1\.00 mB/);
    expect(uncoloredOutput).toContain("512.00  B\n\n  staging/");
    expect(uncoloredOutput).toContain("24.00  B\n\n  production/");
    expect(output).toContain("\u001b[36mkB\u001b[0m");
    expect(output).toContain("\u001b[33mB\u001b[0m");
    expect(output).toContain("\u001b[32mmB\u001b[0m");
    log.mockRestore();
  });
});
