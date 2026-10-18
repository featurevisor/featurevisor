import type { ParsedFeature, ParsedVariable } from "@featurevisor/types";

import { formatDatafileSize, listEntities, listProject, listPlugin } from "./index";

function createFeatureFixture(overrides: Partial<ParsedFeature> = {}): ParsedFeature {
  return {
    key: "untagged",
    description: "Untagged feature",
    bucketBy: "userId",
    rules: {
      staging: [{ key: "everyone", conditions: "*", percentage: 100 }],
      production: [{ key: "everyone", conditions: "*", percentage: 100 }],
    },
    ...overrides,
  };
}

describe("core: list", function () {
  test.each([false, true])(
    "marks compositions only in text output (pretty: %s)",
    async (pretty) => {
      const variables: Record<string, ParsedVariable> = {
        policy: { type: "object", defaultValue: { limit: 10 } },
        alias: { compose: "policy", tags: ["web"] },
        config: { compose: { policy: { variable: "policy" } }, tags: ["web"] },
        "screens/checkout": { compose: { config: { variable: "config" } }, tags: ["web"] },
      };
      const deps = {
        rootDirectoryPath: "",
        projectConfig: {} as any,
        datasource: {
          listVariables: async () => Object.keys(variables),
          readVariable: async (key: string) => variables[key],
        } as any,
        options: { variables: true, pretty },
      };
      const log = jest.spyOn(console, "log").mockImplementation();
      try {
        await listProject(deps);
        const lines = log.mock.calls.map((args) => args.join(" ").replace(/\x1b\[[0-9;]*m/g, ""));
        expect(lines).toContain("  • policy");
        expect(lines).toContain("  • alias (composed)");
        expect(lines).toContain("  • config (composed)");
        expect(lines).toContain("  • screens/checkout (composed)");
        log.mockClear();
        await listProject({ ...deps, options: { ...deps.options, json: true } });
        const result = Object.entries(variables).map(([key, variable]) => ({ ...variable, key }));
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toBe(JSON.stringify(result, null, pretty ? 2 : undefined));
        expect(JSON.parse(log.mock.calls[0][0])).toEqual(result);
        log.mockClear();
        await listProject({ ...deps, options: { ...deps.options, tag: "web" } });
        expect(log.mock.calls.flat().join("\n")).not.toContain("• policy");
        expect(log.mock.calls.flat().join("\n")).toContain("config (composed)");
        expect(variables.config).not.toHaveProperty("key");
      } finally {
        log.mockRestore();
      }
    },
  );

  test("lists composed variables without manufacturing a default or authored type", async () => {
    const variable: ParsedVariable = {
      description: "Composition",
      tags: ["web"],
      compose: { enabled: { feature: "checkout" } },
    };
    const result = await listEntities<ParsedVariable>(
      {
        rootDirectoryPath: "",
        projectConfig: {} as any,
        datasource: {
          listVariables: async () => ["config"],
          readVariable: async () => variable,
        } as any,
        options: { tag: "web" },
      },
      "variable",
    );
    expect(result).toEqual([{ key: "config", ...variable }]);
    expect(result[0]).not.toHaveProperty("defaultValue");
    expect(result[0]).not.toHaveProperty("type");
  });
  test("execution protocol suppresses set progress and requires one selected set", async () => {
    const projectConfig = { sets: true } as any;
    const setDatasource = {
      getConfig: () => projectConfig,
      listTests: async () => [],
      listScenarios: async () => [],
    };
    const datasource = {
      listSets: async () => ["production"],
      forSet: () => setDatasource,
    } as any;
    const parsed = { _: ["list"], tests: true, executionProtocol: true, set: "production" };
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await listPlugin.handler({
        rootDirectoryPath: "/project",
        projectConfig,
        datasource,
        parsed,
      });
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(log.mock.calls[0][0])).toEqual({
        kind: "featurevisor.test-execution",
        schemaVersion: 1,
        tests: [],
      });
      expect(parsed).not.toHaveProperty("json");
      await expect(
        listPlugin.handler({
          rootDirectoryPath: "/project",
          projectConfig,
          datasource,
          parsed: { ...parsed, set: undefined },
        }),
      ).rejects.toThrow("Pass --set");
    } finally {
      log.mockRestore();
    }
  });
  test("versions execution output without changing ordinary listings", async () => {
    const datasource = {
      listTests: async () => [],
      listScenarios: async () => ["journeys.audience"],
      readScenario: async () => ({
        matrix: { audience: ["nl", "de"] },
        checks: [{ segment: "${{ audience }}", matches: true }],
      }),
      segmentExists: async () => true,
      readSegment: async () => ({ conditions: "*" }),
    };
    const deps = {
      rootDirectoryPath: "/project",
      projectConfig: { parser: "yml", testsDirectoryPath: "/project/tests" } as any,
      datasource: datasource as any,
      options: { tests: true, executionProtocol: true },
    };
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await listProject(deps);
      const document = JSON.parse(log.mock.calls[0][0]);
      expect(document).toMatchObject({ kind: "featurevisor.test-execution", schemaVersion: 1 });
      expect(document.tests[0]._test.entityType).toBe("scenario");
      expect(document.tests[0].assertions).toHaveLength(2);
      expect(document.tests[0].assertions[0]._case.id).toEqual(expect.any(String));
      expect(Object.keys(document.tests[0]._segments)).toEqual(["nl", "de"]);
      expect(deps.options).toEqual({ tests: true, executionProtocol: true });
      log.mockClear();
      await listProject({ ...deps, options: { tests: true, json: true } });
      expect(Array.isArray(JSON.parse(log.mock.calls[0][0]))).toBe(true);
      await expect(
        listProject({ ...deps, options: { features: true, executionProtocol: true } }),
      ).rejects.toThrow("only be used with --tests");
    } finally {
      log.mockRestore();
    }
  });
  test("includes only referenced authored segments in expanded execution specs", async () => {
    const readSegment = jest.fn(async (key: string) => ({
      description: key,
      conditions: [{ attribute: "country", operator: "equals", value: key }],
    }));
    const datasource = {
      listTests: async () => [],
      listScenarios: async () => ["journeys.audience"],
      readScenario: async () => ({
        matrix: { segment: ["nl", "de"] },
        checks: [{ segment: "${{ segment }}", matches: true }],
        children: [{ checks: [{ segment: "nl", matches: false }] }],
      }),
      segmentExists: async (key: string) => ["nl", "de"].includes(key),
      readSegment,
    };
    const deps = {
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: {},
    };
    const authored = await listEntities<any>(deps, "scenario");
    expect(authored[0]).not.toHaveProperty("_segments");
    expect((await listEntities<any>(deps, "test"))[0]).not.toHaveProperty("_segments");
    expect(readSegment).not.toHaveBeenCalled();
    const expanded = await listEntities<any>({ ...deps, options: { applyMatrix: true } }, "test");
    expect(Object.keys(expanded[0]._segments)).toEqual(["nl", "de"]);
    expect(readSegment).toHaveBeenCalledTimes(2);
    expect(expanded[0]._segments.nl.conditions[0].value).toBe("nl");
    datasource.segmentExists = async () => false;
    await expect(listEntities({ ...deps, options: { applyMatrix: true } }, "test")).rejects.toThrow(
      'Unknown segment "nl"',
    );
  });
  test("includes transitive authored segment references without following feature names as segments", async () => {
    const definitions = {
      audience: { conditions: ["member", { feature: "checkout" }] },
      member: { conditions: { or: ["country", { variable: "permission", operator: "exists" }] } },
      country: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
    };
    const expanded = await listEntities<any>(
      {
        rootDirectoryPath: "",
        projectConfig: {} as any,
        options: { applyMatrix: true },
        datasource: {
          listTests: async () => [],
          listScenarios: async () => ["audience"],
          readScenario: async () => ({ checks: [{ segment: "audience", matches: true }] }),
          segmentExists: async (key) => Object.prototype.hasOwnProperty.call(definitions, key),
          readSegment: async (key) => definitions[key],
        } as any,
      },
      "test",
    );
    expect(Object.keys(expanded[0]._segments)).toEqual(["audience", "member", "country"]);
  });
  test.each(["segment", "scenario"])(
    "compiles the complete %s execution segment closure without changing authored definitions",
    async (entityType) => {
      const definitions = {
        audience: { description: "Audience", conditions: ["policy", { feature: "checkout" }] },
        policy: {
          conditions: {
            or: [
              {
                variable: "settings.namespaced",
                path: "items.0.enabled",
                operator: "equals",
                value: true,
              },
              {
                feature: "checkout",
                variable: "settings",
                path: ["literal.key", 1],
                operator: "notNull",
              },
            ],
          },
        },
      };
      const before = JSON.stringify(definitions);
      const datasource = {
        listTests: async () => (entityType === "segment" ? ["audience"] : []),
        readTest: async () => ({
          segment: "audience",
          assertions: [{ context: {}, expectedToMatch: true }],
        }),
        listScenarios: async () => (entityType === "scenario" ? ["audience"] : []),
        readScenario: async () => ({ checks: [{ segment: "audience", matches: true }] }),
        segmentExists: async (key: string) =>
          Object.prototype.hasOwnProperty.call(definitions, key),
        readSegment: async (key: string) => definitions[key],
      };
      const deps = {
        rootDirectoryPath: "",
        projectConfig: { parser: "yml", testsDirectoryPath: "/project/tests" } as any,
        datasource: datasource as any,
        options: { applyMatrix: true, executionMetadata: true, executionProtocol: true },
      };
      const [test] = await listEntities<any>(deps, "test");
      expect(Object.keys(test._segments)).toEqual(["audience", "policy"]);
      expect(test._segments.audience.description).toBe("Audience");
      expect(test._segments.audience.conditions).toEqual(["policy", { feature: "checkout" }]);
      expect(test._segments.policy.conditions.or).toEqual([
        {
          variable: "settings.namespaced",
          path: ["items", 0, "enabled"],
          operator: "equals",
          value: true,
        },
        {
          feature: "checkout",
          variable: "settings",
          path: ["literal.key", 1],
          operator: "notNull",
        },
      ]);
      expect(JSON.stringify(definitions)).toBe(before);
      const [ordinary] = await listEntities<any>(
        { ...deps, options: { applyMatrix: true } },
        "test",
      );
      if (entityType === "segment") expect(ordinary).not.toHaveProperty("_segments");
      else expect(ordinary._segments.policy.conditions.or[0].path).toBe("items.0.enabled");
    },
  );
  test("bounds execution segment discovery for cyclic references", async () => {
    const readSegment = jest.fn(async (key: string) => ({ conditions: key === "a" ? "b" : "a" }));
    const [test] = await listEntities<any>(
      {
        rootDirectoryPath: "",
        projectConfig: {} as any,
        options: { applyMatrix: true, executionProtocol: true },
        datasource: {
          listTests: async () => ["a"],
          listScenarios: async () => [],
          readTest: async () => ({
            segment: "a",
            assertions: [{ context: {}, expectedToMatch: false }],
          }),
          segmentExists: async () => true,
          readSegment,
        } as any,
      },
      "test",
    );
    expect(Object.keys(test._segments)).toEqual(["a", "b"]);
    expect(readSegment).toHaveBeenCalledTimes(2);
  });
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
      listScenarios: async () => [],
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

  test("collects children-only references after expanding operator, value, and path matrices", async function () {
    const featureFixtures = {
      checkout: createFeatureFixture({
        key: "checkout",
        variablesSchema: { theme: { type: "string", defaultValue: "light" } },
      }),
      untested: createFeatureFixture({ key: "untested" }),
    };
    const variableFixtures: Record<string, ParsedVariable> = {
      owner: { description: "Owner", type: "string", defaultValue: "owner" },
      supportEmail: {
        description: "Support email",
        type: "string",
        defaultValue: "support@example.com",
      },
      backupEmail: {
        description: "Backup email",
        type: "string",
        defaultValue: "backup@example.com",
      },
      untested: { description: "Untested", type: "string", defaultValue: "none" },
    };
    const datasource = {
      listFeatures: async () => Object.keys(featureFixtures),
      readFeature: async (key: keyof typeof featureFixtures) => featureFixtures[key],
      listVariables: async () => Object.keys(variableFixtures),
      readVariable: async (key: string) => variableFixtures[key],
      listTests: async () => ["owner-check"],
      listSegments: async () => ["audience", "untested"],
      readSegment: async (key: string) => ({ key, conditions: "*" }),
      readTest: async () => ({
        variable: "owner",
        assertions: [
          {
            checks: [
              {
                operator: "notEquals",
                compareTo: { variable: "backupEmail" },
              },
            ],
          },
        ],
      }),
      listScenarios: async () => ["readiness"],
      readScenario: async () => ({
        matrix: {
          variable: ["supportEmail"],
          operator: ["greaterThan"],
          threshold: [3],
          index: [0],
        },
        checks: [{ variable: "supportEmail", operator: "exists" }],
        children: [
          {
            checks: [
              {
                variable: "${{ variable }}",
                path: ["items", "${{ index }}"],
                operator: "${{ operator }}",
                value: "${{ threshold }}",
              },
              {
                feature: "checkout",
                variable: "theme",
                operator: "equals",
                value: "light",
              },
              { segment: "audience", matches: false },
            ],
          },
        ],
      }),
    };
    const deps = {
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: {},
    };

    const variablesWithTests = await listEntities<ParsedVariable & { key: string }>(
      { ...deps, options: { withTests: true } },
      "variable",
    );
    expect(variablesWithTests.map((variable) => variable.key).sort()).toEqual([
      "backupEmail",
      "owner",
      "supportEmail",
    ]);
    await expect(
      listEntities<ParsedVariable>({ ...deps, options: { withoutTests: true } }, "variable"),
    ).resolves.toEqual([expect.objectContaining({ key: "untested" })]);
    await expect(
      listEntities<ParsedFeature>({ ...deps, options: { withTests: true } }, "feature"),
    ).resolves.toEqual([expect.objectContaining({ key: "checkout" })]);
    await expect(
      listEntities({ ...deps, options: { withTests: true } }, "segment"),
    ).resolves.toEqual([expect.objectContaining({ key: "audience" })]);
    await expect(
      listEntities({ ...deps, options: { withoutTests: true } }, "segment"),
    ).resolves.toEqual([expect.objectContaining({ key: "untested" })]);
    await expect(
      listEntities<ParsedFeature>({ ...deps, options: { withoutTests: true } }, "feature"),
    ).resolves.toEqual([expect.objectContaining({ key: "untested" })]);
  });

  test("collects feature-only checks from nested matrix children", async function () {
    const featureFixtures = {
      checkout: createFeatureFixture({ key: "checkout" }),
      untested: createFeatureFixture({ key: "untested" }),
    };
    const datasource = {
      listFeatures: async () => Object.keys(featureFixtures),
      readFeature: async (key: keyof typeof featureFixtures) => featureFixtures[key],
      listTests: async () => [],
      listScenarios: async () => ["feature-state"],
      readScenario: async () => ({
        matrix: { feature: ["checkout"] },
        checks: [{ feature: "checkout", enabled: true }],
        children: [
          {
            checks: [
              {
                not: [{ feature: "${{ feature }}", enabled: false }],
              },
            ],
          },
        ],
      }),
    };
    const deps = {
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: {},
    };

    await expect(
      listEntities<ParsedFeature>({ ...deps, options: { withTests: true } }, "feature"),
    ).resolves.toEqual([expect.objectContaining({ key: "checkout" })]);
    await expect(
      listEntities<ParsedFeature>({ ...deps, options: { withoutTests: true } }, "feature"),
    ).resolves.toEqual([expect.objectContaining({ key: "untested" })]);
  });

  test("rejects invalid checks while collecting test coverage", async function () {
    const datasource = {
      listVariables: async () => ["supportEmail"],
      readVariable: async () => ({
        description: "Support email",
        type: "string",
        defaultValue: "support@example.com",
      }),
      listTests: async () => [],
      listScenarios: async () => ["invalid"],
      readScenario: async () => ({
        checks: [{ variable: "supportEmail", unsupported: true }],
      }),
    };

    await expect(
      listEntities<ParsedVariable>(
        {
          rootDirectoryPath: "",
          projectConfig: {} as any,
          datasource: datasource as any,
          options: { withTests: true },
        },
        "variable",
      ),
    ).rejects.toThrow("Unknown check property");
  });

  test("rejects empty matrices while collecting test coverage", async function () {
    const datasource = {
      listVariables: async () => ["supportEmail"],
      readVariable: async () => ({
        description: "Support email",
        type: "string",
        defaultValue: "support@example.com",
      }),
      listTests: async () => [],
      listScenarios: async () => ["empty-matrix"],
      readScenario: async () => ({
        matrix: {},
        checks: [
          {
            variable: "${{ variable }}",
            operator: "${{ operator }}",
            value: "${{ threshold }}",
          },
        ],
      }),
    };

    await expect(
      listEntities<ParsedVariable>(
        {
          rootDirectoryPath: "",
          projectConfig: {} as any,
          datasource: datasource as any,
          options: { withTests: true },
        },
        "variable",
      ),
    ).rejects.toThrow("empty assertion matrix");
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
        rules: { production: [{ key: "off", conditions: "*", percentage: 0 }] },
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

  test("filters enabled and disabled features without environments", async function () {
    const fixtures = {
      rolling: createFeatureFixture({
        key: "rolling",
        rules: [{ key: "everyone", conditions: "*", percentage: 25 }] as any,
      }),
      off: createFeatureFixture({
        key: "off",
        rules: [{ key: "everyone", conditions: "*", percentage: 0 }] as any,
      }),
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

    await expect(
      listEntities<ParsedFeature>({ ...deps, options: { enabled: true } }, "feature"),
    ).resolves.toEqual([expect.objectContaining({ key: "rolling" })]);
    await expect(
      listEntities<ParsedFeature>({ ...deps, options: { disabled: true } }, "feature"),
    ).resolves.toEqual([expect.objectContaining({ key: "off" })]);
  });

  test("only lists features disabled in the requested environment", async function () {
    const fixtures = {
      enabled: createFeatureFixture({ key: "enabled" }),
      disabled: createFeatureFixture({
        key: "disabled",
        rules: { production: [{ key: "off", conditions: "*", percentage: 0 }] },
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
        options: { disabledIn: "production" },
      },
      "feature",
    );

    expect(result).toEqual([
      expect.objectContaining({ key: "disabled" }),
      expect.objectContaining({ key: "missing" }),
    ]);
  });

  test("validates environment filters against the project configuration", async function () {
    const deps = {
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: {} as any,
      options: {},
    };
    const withEnvironments = {
      ...deps,
      projectConfig: { environments: ["staging", "production"] } as any,
    };

    await expect(
      listProject({ ...deps, options: { features: true, enabledIn: "production" } }),
    ).rejects.toThrow(
      "This project does not configure environments. Use --enabled instead of --enabled-in.",
    );
    await expect(
      listProject({ ...deps, options: { features: true, disabledIn: "production" } }),
    ).rejects.toThrow("Use --disabled instead of --disabled-in.");
    await expect(
      listProject({ ...withEnvironments, options: { features: true, enabledIn: "prod" } }),
    ).rejects.toThrow(
      'Unknown environment "prod" for --enabled-in. Available environments: staging, production.',
    );
    await expect(
      listProject({ ...withEnvironments, options: { features: true, enabled: true } }),
    ).rejects.toThrow(
      "This project configures environments. Use --enabled-in=<environment> instead of --enabled.",
    );
    await expect(
      listProject({ ...deps, options: { features: true, enabled: true, disabled: true } }),
    ).rejects.toThrow("Options --enabled and --disabled cannot be combined.");
    await expect(
      listProject({ ...deps, options: { segments: true, enabled: true } }),
    ).rejects.toThrow("Option --enabled can only be used with --features.");
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

  test("lists schemas", async function () {
    const datasource = {
      listSchemas: async () => ["price"],
      readSchema: async () => ({ description: "Price", type: "number" }),
    };
    const deps = {
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: {},
    };

    await expect(listEntities({ ...deps, options: {} }, "schema")).resolves.toEqual([
      expect.objectContaining({ key: "price" }),
    ]);
  });

  test("lists raw scenarios separately from normalized execution tests", async function () {
    const scenario = {
      description: "Checkout remains available",
      environment: "production",
      matrix: { country: ["nl", "de"] },
      context: { country: "${{ country }}" },
      checks: [{ feature: "checkout", enabled: true }],
    };
    const datasource = {
      listTests: async () => [],
      listScenarios: async () => ["checkout.readiness"],
      readScenario: async () => scenario,
    };
    const deps = {
      rootDirectoryPath: "",
      projectConfig: {} as any,
      datasource: datasource as any,
      options: {},
    };

    const rawScenarios = await listEntities<any>(deps, "scenario");
    expect(rawScenarios).toEqual([
      {
        ...scenario,
        key: "checkout.readiness",
      },
    ]);
    expect(rawScenarios[0]).not.toHaveProperty("assertions");
    expect(rawScenarios[0]).toHaveProperty("checks", scenario.checks);

    const executionTests = await listEntities<any>(deps, "test");
    expect(executionTests).toEqual([
      {
        key: "checkout.readiness",
        scenario: "checkout.readiness",
        assertions: [
          {
            description: "Checkout remains available",
            environment: "production",
            matrix: { country: ["nl", "de"] },
            context: { country: "${{ country }}" },
            checks: [{ feature: "checkout", enabled: true }],
          },
        ],
      },
    ]);

    const expandedTests = await listEntities<any>(
      { ...deps, options: { applyMatrix: true } },
      "test",
    );
    expect(expandedTests[0].assertions).toHaveLength(2);
    expect(expandedTests[0].assertions.map((assertion) => assertion.description)).toEqual([
      "Case 1 of 2: Checkout remains available",
      "Case 2 of 2: Checkout remains available",
    ]);
    expect(expandedTests[0].assertions.map((assertion) => assertion.context.country)).toEqual([
      "nl",
      "de",
    ]);
    expect(expandedTests[0].assertions.every((assertion) => assertion.matrix === undefined)).toBe(
      true,
    );
    expect(scenario).not.toHaveProperty("assertions");
    expect(scenario.matrix).toEqual({ country: ["nl", "de"] });
  });

  test("adds stable execution metadata to every expanded test kind", async function () {
    const datasource = {
      getExtension: () => "yml",
      getSet: () => "staging",
      listTests: async () => ["features.checkout", "segments.desktop", "variables.settings"],
      readTest: async (key: string) => {
        if (key.startsWith("features.")) {
          return {
            feature: "checkout",
            assertions: [
              {
                key: "availability",
                matrix: { environment: ["staging", "production"] },
                environment: "${{ environment }}",
                expectedToBeEnabled: true,
              },
            ],
          };
        }
        if (key.startsWith("segments.")) {
          return {
            segment: "desktop",
            assertions: [{ context: {}, expectedToMatch: true }],
          };
        }
        return {
          variable: "settings",
          assertions: [{ checks: [{ operator: "exists" }] }],
        };
      },
      listScenarios: async () => ["checkout.readiness"],
      readScenario: async () => ({
        matrix: { country: ["nl", "de"] },
        context: { country: "${{ country }}" },
        checks: [{ feature: "checkout", enabled: true }],
      }),
    };
    const deps = {
      rootDirectoryPath: "/project",
      projectConfig: {
        namespaceCharacter: ".",
        parser: "yml",
        testsDirectoryPath: "/project/sets/staging/tests",
      } as any,
      datasource: datasource as any,
      options: { applyMatrix: true, executionMetadata: true, set: "staging" },
    };

    const result = await listEntities<any>(deps, "test");

    expect(result.map((test) => test._test)).toEqual([
      {
        source: "sets/staging/tests/features/checkout.spec.yml",
        set: "staging",
        entityType: "feature",
      },
      {
        source: "sets/staging/tests/segments/desktop.spec.yml",
        set: "staging",
        entityType: "segment",
      },
      {
        source: "sets/staging/tests/variables/settings.spec.yml",
        set: "staging",
        entityType: "variable",
      },
      {
        source: "sets/staging/tests/checkout/readiness.spec.yml",
        set: "staging",
        entityType: "scenario",
      },
    ]);
    expect(result[0].assertions.map((assertion) => assertion._case)).toEqual([
      {
        id: JSON.stringify(["staging", "feature", "features.checkout", "availability", 0]),
        assertionIndex: 0,
        matrixIndex: 0,
        matrixValues: { environment: "staging" },
      },
      {
        id: JSON.stringify(["staging", "feature", "features.checkout", "availability", 1]),
        assertionIndex: 0,
        matrixIndex: 1,
        matrixValues: { environment: "production" },
      },
    ]);
    expect(result[1].assertions[0]._case).toEqual({
      id: JSON.stringify(["staging", "segment", "segments.desktop", 0, null]),
      assertionIndex: 0,
      matrixIndex: null,
      matrixValues: {},
    });
    expect(result[3].assertions[1]._case).toEqual({
      id: JSON.stringify(["staging", "scenario", "checkout.readiness", 0, 1]),
      assertionIndex: 0,
      matrixIndex: 1,
      matrixValues: { country: "de" },
    });
  });

  test.each([undefined, ""])(
    "does not append an invalid source extension when the parser extension is %s",
    async (extension) => {
      const datasource = {
        getExtension: () => extension,
        listTests: async () => ["variables.settings"],
        readTest: async () => ({
          variable: "settings",
          assertions: [{ checks: [{ operator: "exists" }] }],
        }),
        listScenarios: async () => [],
      };

      const result = await listEntities<any>(
        {
          rootDirectoryPath: "/project",
          projectConfig: {
            namespaceCharacter: ".",
            parser: {},
            testsDirectoryPath: "/project/tests",
          } as any,
          datasource: datasource as any,
          options: { applyMatrix: true, executionMetadata: true },
        },
        "test",
      );

      expect(result[0]._test.source).toBe("tests/variables/settings.spec");
    },
  );

  test.each([
    [{ at: 50, sticky: { checkout: { enabled: true } } }],
    [{ at: 50, children: [{ sticky: { checkout: { enabled: true } } }] }],
  ])("rejects the removed feature assertion sticky field: %j", async (assertion) => {
    const datasource = {
      getExtension: () => "yml",
      listTests: async () => ["features.checkout"],
      readTest: async () => ({ feature: "checkout", assertions: [assertion] }),
      listScenarios: async () => [],
    };
    await expect(
      listEntities<any>(
        {
          rootDirectoryPath: "/project",
          projectConfig: {
            namespaceCharacter: ".",
            parser: {},
            testsDirectoryPath: "/project/tests",
          } as any,
          datasource: datasource as any,
          options: { applyMatrix: true, executionMetadata: true },
        },
        "test",
      ),
    ).rejects.toThrow("Replace it with `stickyFeatures`");
  });

  test("keeps child descriptions out of the native execution input", async () => {
    const datasource = {
      getExtension: () => "yml",
      listTests: async () => ["variables.settings"],
      readTest: async () => ({
        variable: "settings",
        assertions: [
          {
            expectedValue: 1,
            children: [{ description: "documented", context: { country: "nl" }, expectedValue: 2 }],
          },
        ],
      }),
      listScenarios: async () => ["scenarios.journey"],
      readScenario: async () => ({
        checks: [{ variable: "settings", operator: "exists" }],
        children: [
          { description: "documented", checks: [{ variable: "settings", operator: "exists" }] },
        ],
      }),
    };
    const deps = {
      rootDirectoryPath: "/project",
      projectConfig: {
        namespaceCharacter: ".",
        parser: {},
        testsDirectoryPath: "/project/tests",
      } as any,
      datasource: datasource as any,
    };

    const authored = await listEntities<any>({ ...deps, options: { applyMatrix: true } }, "test");
    expect(authored.map((test) => test.assertions[0].children[0].description)).toEqual([
      "documented",
      "documented",
    ]);

    const execution = await listEntities<any>(
      { ...deps, options: { applyMatrix: true, executionMetadata: true } },
      "test",
    );
    for (const test of execution) {
      expect(test.assertions[0].children[0]).not.toHaveProperty("description");
    }
  });

  test("filters one exact preassigned matrix case and keeps regex filters as intersections", async () => {
    const datasource = {
      getExtension: () => "yml",
      listTests: async () => ["variables.settings"],
      readTest: async () => ({
        variable: "settings",
        assertions: [
          {
            key: "configured",
            matrix: { country: ["nl", "de"] },
            description: "${{ country }} settings",
            context: { country: "${{ country }}" },
            checks: [{ operator: "exists" }],
          },
        ],
      }),
      listScenarios: async () => [],
    };
    const id = JSON.stringify([null, "variable", "variables.settings", "configured", 1]);
    const deps = {
      rootDirectoryPath: "/project",
      projectConfig: {
        namespaceCharacter: ".",
        parser: "yml",
        testsDirectoryPath: "/project/tests",
      } as any,
      datasource: datasource as any,
      options: { case: id, executionMetadata: true, set: null },
    };

    const result = await listEntities<any>(deps, "test");
    expect(result).toHaveLength(1);
    expect(result[0].assertions).toEqual([
      expect.objectContaining({
        description: "Assertion #1: de settings",
        context: { country: "de" },
        _case: expect.objectContaining({ id, assertionIndex: 0, matrixIndex: 1 }),
      }),
    ]);

    await expect(
      listEntities<any>(
        { ...deps, options: { ...deps.options, assertionPattern: "nl settings" } },
        "test",
      ),
    ).rejects.toThrow("No test case matched");

    const withoutMetadata = await listEntities<any>(
      { ...deps, options: { case: id, set: null } },
      "test",
    );
    expect(withoutMetadata[0]).not.toHaveProperty("_test");
    expect(withoutMetadata[0].assertions[0]).not.toHaveProperty("_case");
  });

  test("fails exact case selection when no test specs exist", async () => {
    await expect(
      listEntities<any>(
        {
          rootDirectoryPath: "/project",
          projectConfig: {} as any,
          datasource: {
            listTests: async () => [],
            listScenarios: async () => [],
          } as any,
          options: { case: "missing" },
        },
        "test",
      ),
    ).rejects.toThrow("No test case matched");
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
    ).rejects.toThrow("Invalid --key-pattern");
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
