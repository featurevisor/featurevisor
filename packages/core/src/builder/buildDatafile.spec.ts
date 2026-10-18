import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { DatafileContent, ExistingState, ParsedFeature, Segment } from "@featurevisor/types";
import { parsers } from "@featurevisor/parsers";
import { createFeaturevisor } from "@featurevisor/sdk";

import type { ProjectConfig } from "../config";
import { buildDatafile, getCustomDatafile } from "./buildDatafile";
import { buildProject, buildProjectSets, buildTargetDatafile } from "./buildProject";

function createProjectConfig(root: string, stringify = true): ProjectConfig {
  return {
    featuresDirectoryPath: path.join(root, "features"),
    segmentsDirectoryPath: path.join(root, "segments-missing"),
    attributesDirectoryPath: path.join(root, "attributes-missing"),
    schemasDirectoryPath: path.join(root, "schemas-missing"),
    targetsDirectoryPath: path.join(root, "targets-missing"),
    variablesDirectoryPath: path.join(root, "variables-missing"),
    testsDirectoryPath: path.join(root, "tests-missing"),
    stateDirectoryPath: path.join(root, ".featurevisor"),
    datafilesDirectoryPath: path.join(root, "datafiles"),
    datafileNamePattern: "featurevisor-%s.json",
    revisionFileName: "REVISION",
    catalogDirectoryPath: path.join(root, "catalog"),
    setsDirectoryPath: path.join(root, "sets"),
    environments: ["staging", "production"],
    sets: false,
    namespaceCharacter: ".",
    tags: ["all"],
    adapter: {},
    plugins: [],
    defaultBucketBy: "userId",
    parser: parsers.yml,
    prettyState: true,
    prettyDatafile: false,
    stringify,
    enforceCatchAllRule: false,
  };
}

function isParsedFeature(
  feature: ParsedFeature | Record<string, ParsedFeature>,
): feature is ParsedFeature {
  return typeof (feature as ParsedFeature).description === "string";
}

function createMockDatasource(
  feature: ParsedFeature | Record<string, ParsedFeature>,
  segmentsByKey: Record<string, Segment> = {},
) {
  let featuresByKey: Record<string, ParsedFeature>;

  if (isParsedFeature(feature)) {
    featuresByKey = { [feature.key]: feature };
  } else {
    featuresByKey = feature;
  }

  return {
    listSchemas: async () => [],
    readSchema: async () => {
      throw new Error("readSchema should not be called");
    },
    listFeatures: async () => Object.keys(featuresByKey),
    readFeature: async (key: string) => featuresByKey[key],
    listSegments: async () => Object.keys(segmentsByKey),
    readSegment: async (key: string) => segmentsByKey[key],
    listAttributes: async () => [],
    readAttribute: async () => {
      throw new Error("readAttribute should not be called");
    },
    listVariables: async () => [],
    getRequiredFeaturesChain: async (key: string) => new Set([key]),
    getRequiredFeaturesChainForVariable: async () => new Set<string>(),
  } as any;
}

function createFeatureFixture(): ParsedFeature {
  return {
    key: "withRuleOverrides",
    description: "Rule variableOverrides fixture",
    tags: ["all"],
    bucketBy: "userId",
    variablesSchema: {
      config: {
        type: "object",
        defaultValue: {
          source: "default",
          nested: { value: 1 },
          list: ["d"],
          rows: [
            { id: 1, label: "one" },
            { id: 2, label: "two" },
          ],
          flag: false,
        },
      },
      fallbackConfig: {
        type: "object",
        defaultValue: {
          origin: "default",
          count: 1,
        },
      },
    },
    variations: [{ value: "control", weight: 100 }],
    rules: {
      staging: [
        {
          key: "rule1",
          conditions: "*",
          percentage: 100,
          variables: {
            config: {
              source: "rule",
              nested: { value: 10 },
              list: ["base"],
              rows: [
                { id: 1, label: "one" },
                { id: 2, label: "two" },
              ],
              flag: true,
            },
          },
          variableOverrides: {
            config: [
              {
                conditions: { and: ["mobile", "touch"] },
                value: {
                  "nested.value": 20,
                  "list:append": "m",
                  "rows[id=1]:after": { id: 15, label: "one-half" },
                  "rows[id=2]:remove": null,
                },
              },
              {
                conditions: [{ attribute: "country", operator: "equals", value: "de" }],
                value: {
                  "nested.value": 30,
                  "list:prepend": "de",
                  "rows[id=1]:before": { id: 0, label: "zero" },
                },
              },
              {
                conditions: [{ attribute: "device", operator: "equals", value: "desktop" }],
                value: {
                  source: "full",
                  nested: { value: 999 },
                  list: ["x"],
                  rows: [{ id: 7, label: "seven" }],
                  flag: false,
                },
              },
            ],
            fallbackConfig: [
              {
                conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
                value: {
                  count: 5,
                },
              },
            ],
          },
        },
      ],
      production: [
        {
          key: "everyone",
          conditions: "*",
          percentage: 100,
        },
      ],
    },
  } as ParsedFeature;
}

function createOrderingFeature(key = "ordering"): ParsedFeature {
  return {
    key,
    description: "Ordering",
    bucketBy: "userId",
    tags: ["all"],
    variablesSchema: {
      cta: { type: "object", defaultValue: { label: "Start" } },
    },
    rules: {
      staging: [
        {
          key: "all",
          conditions: "*",
          percentage: 100,
          variables: { "cta.label": "child", cta: { label: "parent" } },
        },
      ],
      production: [],
    },
  } as ParsedFeature;
}

describe("core: buildDatafile", function () {
  test.each([true, false])(
    "keeps timestamp formats out of datafiles with precomputeMutations=%s",
    async (precomputeMutations) => {
      const timestamp = "1970-01-01T00:00:00Z";
      const timestampSchema = { type: "string", format: "date-time" };
      const feature = {
        key: "timestampFeature",
        description: "Timestamp",
        tags: ["all"],
        bucketBy: "userId",
        variablesSchema: {
          when: { ...timestampSchema, defaultValue: timestamp, disabledValue: timestamp },
          referenced: { schema: "instant", defaultValue: timestamp },
        },
        rules: { staging: [{ key: "all", conditions: "*", percentage: 100 }] },
      } as ParsedFeature;
      const global = {
        description: "Timestamp",
        ...timestampSchema,
        defaultValue: timestamp,
        disabledValue: timestamp,
      };
      const datasource = createMockDatasource(feature);
      Object.assign(datasource, {
        listSchemas: async () => ["instant"],
        readSchema: async () => timestampSchema,
        listVariables: async () => ["timestamp"],
        readVariable: async () => global,
      });
      const config = { ...createProjectConfig(root), precomputeMutations };
      const withFormat = await buildDatafile(
        config,
        datasource,
        { revision: "1", environment: "staging" },
        existingState,
      );
      expect(withFormat.features.timestampFeature.variablesSchema?.when).toEqual({
        type: "string",
        defaultValue: timestamp,
        disabledValue: timestamp,
      });
      expect(withFormat.features.timestampFeature.variablesSchema?.referenced).toEqual({
        type: "string",
        defaultValue: timestamp,
      });
      expect(withFormat.variables?.timestamp).toEqual(
        expect.objectContaining({
          type: "string",
          defaultValue: timestamp,
          disabledValue: timestamp,
        }),
      );
      expect(JSON.stringify(withFormat)).not.toContain('"format"');
      delete (timestampSchema as { format?: string }).format;
      delete (feature.variablesSchema!.when as { format?: string }).format;
      delete (global as { format?: string }).format;
      const withoutFormat = await buildDatafile(
        config,
        datasource,
        { revision: "1", environment: "staging" },
        existingState,
      );
      expect(withFormat).toEqual(withoutFormat);
    },
  );

  test("does not scan tests or segments for policy when the default list is empty", async () => {
    const config = createProjectConfig(root, true);
    const datasource = createMockDatasource({
      plain: {
        key: "plain",
        description: "Plain",
        bucketBy: "userId",
        rules: { staging: [{ key: "all", conditions: "*", percentage: 100, enabled: true }] },
      },
    });
    const readFeature = jest.spyOn(datasource, "readFeature");
    const readSegment = jest.spyOn(datasource, "readSegment");
    const listTests = jest.fn(async () => []);
    const listScenarios = jest.fn(async () => []);
    Object.assign(datasource, { listTests, listScenarios });
    await buildDatafile(
      config,
      datasource,
      { revision: "1", environment: "staging" },
      existingState,
    );
    expect(readFeature).toHaveBeenCalledTimes(1);
    expect(readSegment).not.toHaveBeenCalled();
    expect(listTests).not.toHaveBeenCalled();
    expect(listScenarios).not.toHaveBeenCalled();
  });

  test("enforces disallowOperators without a separate lint command", async () => {
    const config = { ...createProjectConfig(root, true), disallowOperators: ["notEmpty"] };
    const datasource = createMockDatasource({
      gated: {
        key: "gated",
        description: "Gated",
        bucketBy: "userId",
        conditions: { variable: "tags", operator: "notEmpty" },
        rules: { staging: [{ key: "all", conditions: "*", percentage: 100, enabled: true }] },
      },
    });
    await expect(
      buildDatafile(config, datasource, { revision: "1", environment: "staging" }, existingState),
    ).rejects.toThrow(/Feature "gated" at conditions.operator: operator "notEmpty" is disallowed/);
  });

  test("enforces operator policy for global override and segment selectors in every environment", async () => {
    const config = { ...createProjectConfig(root, true), disallowOperators: ["equals"] };
    const datasource = createMockDatasource(
      {},
      {
        restricted: {
          description: "Restricted",
          conditions: { attribute: "country", operator: "equals", value: "nl" },
        },
      },
    );
    Object.assign(datasource, {
      listVariables: async () => ["policy"],
      readVariable: async () => ({
        type: "string",
        defaultValue: "base",
        overrides: {
          production: [
            {
              key: "restricted",
              conditions: { variable: "gate", operator: "equals", value: true },
              value: "private-literal",
            },
          ],
        },
      }),
    });
    await expect(
      buildDatafile(config, datasource, { revision: "1", environment: "staging" }, existingState),
    ).rejects.toThrow(/Variable "policy" at overrides.production.0.conditions.operator/);
    Object.assign(datasource, { listVariables: async () => [] });
    await expect(
      buildDatafile(config, datasource, { revision: "1", environment: "staging" }, existingState),
    ).rejects.toThrow(/Segment "restricted" at conditions.operator/);
  });

  test("enforces the policy on authored checks before test execution", async () => {
    const config = { ...createProjectConfig(root, true), disallowOperators: ["equals"] };
    const datasource = createMockDatasource({});
    Object.assign(datasource, {
      listTests: async () => ["contract"],
      readTest: async () => ({
        variable: "policy",
        assertions: [
          {
            matrix: { operator: ["notEquals", "equals"] },
            checks: [
              {
                not: [{ operator: "${{ operator }}", variable: "policy", value: "private-value" }],
              },
            ],
          },
        ],
      }),
      listScenarios: async () => [],
    });
    await expect(
      buildDatafile(config, datasource, { revision: "1", environment: "staging" }, existingState),
    ).rejects.toThrow(/Test "contract" at assertions.0.checks.0.not.0.operator/);
  });
  let root: string;
  let existingState: ExistingState;

  beforeEach(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-buildDatafile-"));
    fs.mkdirSync(path.join(root, "features"), { recursive: true });
    fs.mkdirSync(path.join(root, "segments-missing"), { recursive: true });
    existingState = { features: {} };
  });

  afterEach(function () {
    fs.rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function createBuildDatasource(features: ParsedFeature | Record<string, ParsedFeature>) {
    const datasource = createMockDatasource(features);
    datasource.listTargets = async () => ["all"];
    datasource.readTarget = async () => ({ tag: "all" });
    datasource.readState = async () => existingState;
    datasource.readRevision = async () => "1";
    datasource.writeDatafile = async () => {};
    return datasource;
  }

  test("resolves rule variableOverrides mutations using rule variables as base and default fallback when missing", async function () {
    const config = createProjectConfig(root, true);
    const datasource = createMockDatasource(createFeatureFixture());

    const result = (await buildDatafile(
      config,
      datasource,
      {
        revision: "1",
        environment: "staging",
      },
      existingState,
    )) as DatafileContent;

    expect(result.schemaVersion).toBe("4");

    const trafficRule = result.features.withRuleOverrides.traffic.find((t) => t.key === "rule1");

    expect(trafficRule).toBeDefined();
    expect(trafficRule?.variableOverrides).toBeDefined();

    // Base comes from rule variables (source remains "rule"), not from schema default.
    expect(trafficRule?.variableOverrides?.config[0].value).toEqual({
      source: "rule",
      nested: { value: 20 },
      list: ["base", "m"],
      rows: [
        { id: 1, label: "one" },
        { id: 15, label: "one-half" },
      ],
      flag: true,
    });

    // Independent override still uses the same rule-level base and preserves order.
    expect(trafficRule?.variableOverrides?.config[1].value).toEqual({
      source: "rule",
      nested: { value: 30 },
      list: ["de", "base"],
      rows: [
        { id: 0, label: "zero" },
        { id: 1, label: "one" },
        { id: 2, label: "two" },
      ],
      flag: true,
    });

    // Full object override passes through unchanged.
    expect(trafficRule?.variableOverrides?.config[2].value).toEqual({
      source: "full",
      nested: { value: 999 },
      list: ["x"],
      rows: [{ id: 7, label: "seven" }],
      flag: false,
    });

    // No rule variable for fallbackConfig -> mutation base is variable schema defaultValue.
    expect(trafficRule?.variableOverrides?.fallbackConfig[0].value).toEqual({
      origin: "default",
      count: 5,
    });

    // Supports stringification for segments + conditions.
    expect(typeof trafficRule?.variableOverrides?.config[0].conditions).toBe("string");
    expect(trafficRule?.variableOverrides?.config[0].conditions).toEqual(
      JSON.stringify({ and: ["mobile", "touch"] }),
    );
    expect(typeof trafficRule?.variableOverrides?.config[1].conditions).toBe("string");
    expect(trafficRule?.variableOverrides?.config[1].conditions).toEqual(
      JSON.stringify([{ attribute: "country", operator: "equals", value: "de" }]),
    );
  });

  test.each([false, true])(
    "precomputeMutations preserves nested first match values (stringify=%s)",
    async (stringify) => {
      const config = createProjectConfig(root, stringify);
      const datasource = createMockDatasource(createFeatureFixture(), {
        europe: {
          key: "europe",
          conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
        } as Segment,
      });
      const defaultValue = {
        label: "default",
        tags: ["a", "a"],
        rows: [{ id: "one", label: "old" }],
        discard: 1,
      };
      const parentValue = {
        label: "parent",
        tags: ["start", "b", "tail"],
        rows: [
          { id: "zero", label: "zero" },
          { id: "one", label: "old" },
          { id: "two", label: "two" },
        ],
      };
      const literal = { label: "literal", tags: [], rows: [] };
      const policy = {
        description: "Nested policy",
        type: "object",
        defaultValue,
        conditions: { variable: "gate", operator: "equals", value: true },
        disabledValue: { label: "disabled" },
        overrides: {
          production: [
            {
              key: "parent",
              conditions: ["europe"],
              mutate: {
                label: "parent",
                "tags:removeValue": "a",
                "tags:appendUnique": "b",
                "tags:prepend": "start",
                "tags:append": "tail",
                "rows[0]:before": { id: "zero", label: "zero" },
                "rows[id=one]:after": { id: "two", label: "two" },
                "discard:remove": true,
              },
              overrides: [
                {
                  key: "child",
                  conditions: { attribute: "city", operator: "equals", value: "amsterdam" },
                  mutate: { "rows[id=one].label": "child", "rows[id=missing].label": "ignored" },
                  overrides: [
                    {
                      key: "reset",
                      conditions: { attribute: "reset", operator: "equals", value: true },
                      value: literal,
                    },
                  ],
                },
                { key: "later-child", conditions: "*", mutate: { label: "fallback-child" } },
              ],
            },
            { key: "later-parent", conditions: "*", value: literal },
          ],
        },
      };
      Object.assign(datasource, {
        listVariables: async () => ["policy", "gate"],
        readVariable: async (key: string) =>
          key === "policy" ? policy : { type: "boolean", defaultValue: true },
      });
      const snapshot = JSON.stringify(policy);
      const builds: DatafileContent[] = [];
      for (const precomputeMutations of [undefined, true, false]) {
        const datafile = await buildDatafile(
          { ...config, precomputeMutations },
          datasource,
          { revision: "1", environment: "production" },
          { features: {} },
        );
        builds.push(datafile);
        expect(Boolean(datafile.variables!.policy.overrideProgram)).toBe(
          precomputeMutations === false,
        );
        expect(Boolean(datafile.variables!.policy.overrides)).toBe(precomputeMutations !== false);
        const f = createFeaturevisor({ datafile, logLevel: "fatal" });
        try {
          expect(f.getVariable("policy", { country: "nl", city: "amsterdam" })).toEqual({
            ...parentValue,
            rows: parentValue.rows.map((row) =>
              row.id === "one" ? { ...row, label: "child" } : row,
            ),
          });
          expect(f.getVariable("policy", { country: "nl", city: "rotterdam" })).toEqual({
            ...parentValue,
            label: "fallback-child",
          });
          expect(f.getVariable("policy", { country: "us" })).toEqual(literal);
          expect(
            f.getVariable("policy", { country: "nl", city: "amsterdam", reset: true }),
          ).toEqual(literal);
          // Repeat evaluation and exercise independent child sticky requirements.
          const child = f.spawn({ country: "nl" }, { stickyVariables: { gate: false } });
          expect(child.getVariable("policy")).toEqual({ label: "disabled" });
          child.close();
          expect(f.getVariable("policy", { country: "us" })).toEqual(literal);
          if (precomputeMutations === false) {
            expect(
              f.evaluateVariable("policy", { country: "nl", city: "amsterdam" })
                .variableOverridePaths,
            ).toEqual([["parent"], ["parent", "child"]]);
          }
        } finally {
          f.close();
        }
      }
      expect(builds[0]).toEqual(builds[1]);
      // Feature variable mutations are unaffected by this global-only option.
      expect(builds[2].features).toEqual(builds[1].features);
      expect(JSON.stringify(policy)).toBe(snapshot);
    },
  );

  test.each([undefined, true, false])(
    "selects runtime programs per variable and environment (precompute=%s)",
    async (precomputeMutations) => {
      const config = { ...createProjectConfig(root), precomputeMutations };
      const datasource = createMockDatasource({});
      const variables = {
        mutated: {
          type: "array",
          defaultValue: [],
          overrides: {
            staging: [
              { key: "first", conditions: "*", mutate: { ":append": "first" } },
              { key: "second", conditions: "*", mutate: { ":append": "second" } },
            ],
            production: [
              { key: "first", conditions: "*", continue: true, mutate: { ":append": "first" } },
              { key: "second", conditions: "*", mutate: { ":append": "second" } },
            ],
          },
        },
        literal: {
          type: "string",
          defaultValue: "default",
          overrides: {
            staging: [{ key: "one", conditions: "*", value: "one" }],
            production: [
              { key: "one", conditions: "*", continue: true, value: "one" },
              { key: "two", conditions: "*", value: "two" },
            ],
          },
        },
        empty: { type: "object", defaultValue: {}, overrides: { staging: [], production: [] } },
      };
      Object.assign(datasource, {
        listVariables: async () => Object.keys(variables),
        readVariable: async (key: keyof typeof variables) => variables[key],
      });
      for (const environment of ["staging", "production"]) {
        const datafile = await buildDatafile(
          config,
          datasource,
          { revision: "1", environment },
          existingState,
        );
        expect(Boolean(datafile.variables!.mutated.overrideProgram)).toBe(
          environment === "production" || precomputeMutations === false,
        );
        expect(Boolean(datafile.variables!.literal.overrideProgram)).toBe(
          environment === "production",
        );
        expect(datafile.variables!.empty.overrideProgram).toBeUndefined();
        const f = createFeaturevisor({ datafile });
        expect(f.getVariable("mutated")).toEqual(
          environment === "production" ? ["first", "second"] : ["first"],
        );
        expect(f.getVariable("literal")).toBe(environment === "production" ? "two" : "one");
        f.close();
      }
      const noEnvironments = { ...config, environments: undefined };
      Object.assign(datasource, {
        listVariables: async () => ["mutated"],
        readVariable: async () => ({
          ...variables.mutated,
          overrides: variables.mutated.overrides.staging,
        }),
      });
      const datafile = await buildDatafile(
        noEnvironments,
        datasource,
        { revision: "1", environment: false },
        existingState,
      );
      expect(Boolean(datafile.variables!.mutated.overrideProgram)).toBe(
        precomputeMutations === false,
      );
      const f = createFeaturevisor({ datafile });
      expect(f.getVariable("mutated")).toEqual(["first"]);
      f.close();
    },
  );

  test.each([
    {
      name: "root append keeps an array as one value",
      initial: [0],
      mutate: { ":append": [1, 2] },
      expected: [0, [1, 2]],
    },
    {
      name: "root prepend keeps an array as one value",
      initial: [0],
      mutate: { ":prepend": [1, 2] },
      expected: [[1, 2], 0],
    },
    {
      name: "nested append copies an object operand",
      initial: { list: [] },
      mutate: { "list:append": { values: [] } },
      expected: { list: [{ values: [] }] },
    },
    {
      name: "unique append distinguishes false and zero",
      initial: [false],
      mutate: { ":appendUnique": 0 },
      expected: [false, 0],
    },
    {
      name: "unique append distinguishes text and number",
      initial: ["1"],
      mutate: { ":appendUnique": 1 },
      expected: ["1", 1],
    },
    {
      name: "unique append preserves existing duplicates",
      initial: [null, null],
      mutate: { ":appendUnique": null },
      expected: [null, null],
    },
    {
      name: "value removal removes every matching null",
      initial: [null, false, 0, "", null],
      mutate: { ":removeValue": null },
      expected: [false, 0, ""],
    },
    {
      name: "value removal does not coerce",
      initial: [0, false, "0", 0],
      mutate: { ":removeValue": 0 },
      expected: [false, "0"],
    },
    {
      name: "set preserves explicit null and empty containers",
      initial: { value: "old", list: [1], object: { x: 1 } },
      mutate: { value: null, list: [], object: {} },
      expected: { value: null, list: [], object: {} },
    },
    {
      name: "indexed before inserts one value",
      initial: ["a", "b"],
      mutate: { "[1]:before": ["x"] },
      expected: ["a", ["x"], "b"],
    },
    {
      name: "selected after sees numeric strings",
      initial: [{ id: "1" }],
      mutate: { "[id=1]:after": { id: 2 } },
      expected: [{ id: "1" }, { id: 2 }],
    },
    {
      name: "selectors observe preceding removal",
      initial: [
        { id: 1, mark: false },
        { id: 1, mark: false },
      ],
      mutate: { "[0]:remove": null, "[id=1].mark": true },
      expected: [{ id: 1, mark: true }],
    },
    {
      name: "selector miss is a no-op",
      initial: { rows: [{ id: 1 }] },
      mutate: { "rows[id=2].label": "missing" },
      expected: { rows: [{ id: 1 }] },
    },
    {
      name: "selector matches null without matching missing",
      initial: [{ id: "absent" }, { id: "present", code: null }],
      mutate: { "[code=null].mark": true },
      expected: [{ id: "absent" }, { id: "present", code: null, mark: true }],
    },
    {
      name: "empty selector matches empty text",
      initial: [{ id: "" }],
      mutate: { "[id=''].mark": true },
      expected: [{ id: "", mark: true }],
    },
    {
      name: "set numeric object property",
      initial: { "0": "old" },
      mutate: { "0": "new" },
      expected: { "0": "new" },
    },
    {
      name: "remove missing object property",
      initial: { preserved: true },
      mutate: { "missing:remove": null },
      expected: { preserved: true },
    },
    { name: "set at array length appends", initial: [1], mutate: { "[1]": 2 }, expected: [1, 2] },
    {
      name: "set beyond array length does not create holes",
      initial: [1],
      mutate: { "[2]": 2 },
      expected: [1],
    },
  ])("preserves mutation compilation parity: $name", async ({ initial, mutate, expected }) => {
    for (const stringify of [false, true]) {
      for (const precomputeMutations of [true, false]) {
        const config = { ...createProjectConfig(root, stringify), precomputeMutations };
        const datasource = createMockDatasource({});
        const variable = {
          type: Array.isArray(initial) ? "array" : "object",
          defaultValue: initial,
          overrides: {
            staging: [
              { key: "first", conditions: "*", mutate },
              { key: "unreachable", conditions: "*", value: initial },
            ],
          },
        };
        const snapshot = JSON.stringify(variable);
        Object.assign(datasource, {
          listVariables: async () => ["policy"],
          readVariable: async () => variable,
        });
        const datafile = await buildDatafile(
          config,
          datasource,
          { revision: "1", environment: "staging" },
          { features: {} },
        );
        expect(Boolean(datafile.variables!.policy.overrideProgram)).toBe(!precomputeMutations);
        const f = createFeaturevisor({ datafile, logLevel: "fatal" });
        try {
          for (let repeat = 0; repeat < 2; repeat++) {
            expect(f.getVariable("policy")).toEqual(expected);
            expect(f.evaluateVariable("policy").variableOverrideKey).toBe("first");
          }
          expect(JSON.stringify(variable)).toBe(snapshot);
        } finally {
          f.close();
        }
      }
    }
  });

  test("builds aligned feature variable overrides while preserving legacy output", async function () {
    const config = createProjectConfig(root, true);
    const feature = createFeatureFixture();
    const rule = (feature.rules as Record<string, any[]>).staging[0];
    rule.variableOverrides.config.push({
      key: "required-mutation",
      description: "Authoring metadata is removed",
      promotable: true,
      conditions: [
        {
          feature: "prerequisite",
          enabled: false,
          variation: "control",
        },
      ],
      mutate: {
        "nested.value": 40,
        "list:append": "required",
      },
    });
    const datasource = createMockDatasource({
      withRuleOverrides: feature,
      prerequisite: {
        key: "prerequisite",
        description: "Prerequisite",
        bucketBy: "userId",
        disabledVariationValue: "control",
        variations: [{ value: "control", weight: 100 }],
        rules: { staging: [{ key: "off", conditions: "*", percentage: 0 }] },
      } as ParsedFeature,
    });

    const result = await buildDatafile(
      config,
      datasource,
      { revision: "1", environment: "staging" },
      existingState,
    );
    const overrides = result.features.withRuleOverrides.traffic[0].variableOverrides!.config;

    expect(overrides[0].key).toBeUndefined();
    expect(overrides[0].value).toEqual(
      expect.objectContaining({ source: "rule", nested: { value: 20 } }),
    );
    expect(overrides[3]).toEqual({
      key: "required-mutation",
      conditions: JSON.stringify([
        { feature: "prerequisite", enabled: false, variation: "control" },
      ]),
      value: {
        source: "rule",
        nested: { value: 40 },
        list: ["base", "required"],
        rows: [
          { id: 1, label: "one" },
          { id: 2, label: "two" },
        ],
        flag: true,
      },
    });
    expect((overrides[3] as any).description).toBeUndefined();
    expect((overrides[3] as any).promotable).toBeUndefined();
    expect((overrides[3] as any).mutate).toBeUndefined();
  });

  test("keeps segments and conditions non-stringified when projectConfig.stringify is false", async function () {
    const config = createProjectConfig(root, false);
    const datasource = createMockDatasource(createFeatureFixture());

    const result = (await buildDatafile(
      config,
      datasource,
      {
        revision: "1",
        environment: "staging",
      },
      existingState,
    )) as DatafileContent;

    const trafficRule = result.features.withRuleOverrides.traffic.find((t) => t.key === "rule1");

    expect(trafficRule?.variableOverrides?.config[0].conditions).toEqual({
      and: ["mobile", "touch"],
    });
    expect(trafficRule?.variableOverrides?.config[1].conditions).toEqual([
      { attribute: "country", operator: "equals", value: "de" },
    ]);
  });

  test("includes features with missing tags when no tag filter is provided", async function () {
    const config = createProjectConfig(root, true);
    const feature = createFeatureFixture();
    delete feature.tags;
    const datasource = createMockDatasource(feature);

    const result = (await buildDatafile(
      config,
      datasource,
      {
        revision: "1",
        environment: "staging",
      },
      existingState,
    )) as DatafileContent;

    expect(result.features.withRuleOverrides).toBeDefined();
  });

  test("excludes features with missing tags when tag filter is provided", async function () {
    const config = createProjectConfig(root, true);
    const feature = createFeatureFixture();
    delete feature.tags;
    const datasource = createMockDatasource(feature);

    const result = (await buildDatafile(
      config,
      datasource,
      {
        revision: "1",
        environment: "staging",
        tag: "all",
      },
      existingState,
    )) as DatafileContent;

    expect(result.features.withRuleOverrides).toBeUndefined();
  });

  test("filters target features by include/exclude patterns and combines them with tags using AND", async function () {
    const config = createProjectConfig(root, true);
    const createFeature = (key: string, tags: string[]) => ({
      ...createFeatureFixture(),
      key,
      description: key,
      tags,
    });
    const datasource = createMockDatasource({
      "checkout.web": createFeature("checkout.web", ["all", "web"]),
      "checkout.mobile": createFeature("checkout.mobile", ["all", "mobile"]),
      "admin.web": createFeature("admin.web", ["all", "web"]),
      "admin.internal": createFeature("admin.internal", ["all", "web"]),
    });

    const filtered = await buildTargetDatafile({
      projectConfig: config,
      datasource,
      target: {
        description: "Selected web features",
        tag: "web",
        includeFeatures: ["checkout*", "admin*"],
        excludeFeatures: ["admin.internal"],
      },
      environment: "staging",
      existingState,
      revision: "1",
    });

    expect(Object.keys(filtered.features).sort()).toEqual(["admin.web", "checkout.web"]);

    const all = await buildTargetDatafile({
      projectConfig: config,
      datasource,
      target: {
        description: "All except admin features",
        includeFeatures: "*",
        excludeFeatures: ["admin*"],
      },
      environment: "staging",
      existingState,
      revision: "1",
    });

    expect(Object.keys(all.features).sort()).toEqual(["checkout.mobile", "checkout.web"]);
  });

  test("builds target datafiles without broadening NOT segment rules", async function () {
    const config = createProjectConfig(root, false);
    const feature: ParsedFeature = {
      key: "targeted",
      description: "Targeted feature",
      tags: ["all"],
      bucketBy: "userId",
      rules: {
        staging: [
          {
            key: "not-web",
            conditions: {
              not: ["web"],
            },
            percentage: 100,
          },
          {
            key: "not-web-and-chrome",
            conditions: {
              not: ["web", "chrome"],
            },
            percentage: 100,
          },
        ],
      },
    } as ParsedFeature;
    const datasource = createMockDatasource(feature, {
      web: {
        conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
      },
      chrome: {
        conditions: [{ attribute: "browser", operator: "equals", value: "chrome" }],
      },
    });

    const webDatafile = await buildTargetDatafile({
      projectConfig: config,
      datasource,
      target: {
        description: "Web target",
        context: { platform: "web" },
      },
      environment: "staging",
      existingState,
      revision: "1",
    });

    expect(webDatafile.features.targeted.traffic[0].conditions).toEqual({
      or: [],
    });
    expect(webDatafile.features.targeted.traffic[1].conditions).toEqual({
      not: ["chrome"],
    });

    const webChromeDatafile = await buildTargetDatafile({
      projectConfig: config,
      datasource,
      target: {
        description: "Web Chrome target",
        context: { platform: "web", browser: "chrome" },
      },
      environment: "staging",
      existingState,
      revision: "1",
    });

    expect(webChromeDatafile.features.targeted.traffic[0].conditions).toEqual({
      or: [],
    });
    expect(webChromeDatafile.features.targeted.traffic[1].conditions).toEqual({
      or: [],
    });
  });

  test("specializes stringified force and variation override expressions", async function () {
    const config = createProjectConfig(root, true);
    const feature: ParsedFeature = {
      key: "targeted",
      description: "Targeted feature",
      tags: ["all"],
      bucketBy: "userId",
      variablesSchema: {
        colour: { type: "string", defaultValue: "black" },
      },
      variations: [
        {
          value: "control",
          weight: 100,
          variableOverrides: {
            colour: [
              { conditions: { or: ["web", "mobile"] }, value: "red" },
              {
                conditions: {
                  or: [
                    { attribute: "platform", operator: "equals", value: "web" },
                    { attribute: "platform", operator: "equals", value: "mobile" },
                  ],
                },
                value: "blue",
              },
            ],
          },
        },
      ],
      force: {
        staging: [
          { conditions: { or: ["web", "mobile"] }, variation: "control" },
          {
            conditions: {
              or: [
                { attribute: "platform", operator: "equals", value: "web" },
                { attribute: "platform", operator: "equals", value: "mobile" },
              ],
            },
            variation: "control",
          },
        ],
      },
      rules: {
        staging: [{ key: "all", conditions: "*", percentage: 100, variation: "control" }],
      },
    } as ParsedFeature;
    const datasource = createMockDatasource(feature, {
      web: {
        conditions: [{ attribute: "platform", operator: "equals", value: "web" }],
      },
      mobile: {
        conditions: [{ attribute: "platform", operator: "equals", value: "mobile" }],
      },
    });

    const result = await buildTargetDatafile({
      projectConfig: config,
      datasource,
      target: { description: "Web", context: { platform: "web" } },
      environment: "staging",
      existingState,
      revision: "1",
    });

    expect(result.features.targeted.force?.[0].conditions).toBe("*");
    expect(result.features.targeted.force?.[1].conditions).toBe("*");
    expect(result.segments.web).toBeUndefined();
    expect(result.features.targeted.variations?.[0].variableOverrides?.colour[0].conditions).toBe(
      "*",
    );
    expect(result.features.targeted.variations?.[0].variableOverrides?.colour[1].conditions).toBe(
      "*",
    );
  });

  test("derives revision hashes from the final target-specialized datafile", async () => {
    const config = createProjectConfig(root, true);
    const datasource = createMockDatasource(
      {
        targeted: {
          key: "targeted",
          description: "Targeted",
          bucketBy: "userId",
          rules: {
            staging: [{ key: "country", conditions: "nl", percentage: 100, enabled: true }],
          },
        } as ParsedFeature,
      },
      {
        nl: {
          conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
        },
      },
    );

    const nl = await buildTargetDatafile({
      projectConfig: config,
      datasource,
      target: { description: "NL", context: { country: "nl" } },
      environment: "staging",
      existingState,
      revision: "source",
      revisionFromHash: true,
    });
    const de = await buildTargetDatafile({
      projectConfig: config,
      datasource,
      target: { description: "DE", context: { country: "de" } },
      environment: "staging",
      existingState,
      revision: "source",
      revisionFromHash: true,
    });

    expect(nl.revision).not.toBe("source");
    expect(de.revision).not.toBe("source");
    expect(nl.revision).not.toBe(de.revision);
  });

  test.each([true, false])(
    "compiles accumulation with dependency collection (stringify=%s)",
    async (stringify) => {
      const config = createProjectConfig(root, stringify);
      const datasource = createMockDatasource({});
      Object.assign(datasource, {
        listVariables: async () => ["policy"],
        readVariable: async () => ({
          description: "Policy",
          type: "array",
          defaultValue: [],
          tags: ["web"],
          overrides: {
            staging: [
              {
                key: "europe",
                conditions: "europe",
                mutate: { ":append": "europe" },
                continue: true,
              },
              {
                key: "country",
                conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
                mutate: { ":append": "nl" },
              },
            ],
          },
        }),
        listSegments: async () => ["europe"],
        readSegment: async () => ({
          conditions: [{ attribute: "continent", operator: "equals", value: "eu" }],
        }),
        listAttributes: async () => ["country", "continent"],
        readAttribute: async () => ({ description: "Attribute", type: "string" }),
      });
      const result = await buildDatafile(
        config,
        datasource,
        { revision: "1", environment: "staging", tag: "web" },
        existingState,
      );
      expect(result.variables!.policy.overrides).toBeUndefined();
      expect(result.variables!.policy.overrideProgram).toHaveLength(2);
      expect(result.variables!.policy.overrideProgram![0].conditions).toBe("europe");
      expect(result.variables!.policy.overrideProgram![0].operations).toEqual([
        { op: "append", path: [], value: "europe" },
      ]);
      expect(Object.keys(result.segments)).toEqual(["europe"]);
      expect(result.schemaVersion).toBe("4");
    },
  );

  test.each([false, true])(
    "ordinary and accumulating mutations produce identical values (stringify=%s)",
    async (stringify) => {
      const config = createProjectConfig(root, stringify);
      const datasource = createMockDatasource({});
      const defaultValue = { tags: ["a", "a"], items: [{ id: "checkout" }] };
      const mutations = {
        "tags:removeValue": "a",
        "tags:appendUnique": "a",
        "items[0]:before": { id: "basket" },
        "items[1]:after": { id: "confirmation" },
        "items[id=checkout]": { id: "payment" },
      };
      Object.assign(datasource, {
        listVariables: async () => ["policy"],
        readVariable: async () => ({
          description: "Policy",
          type: "object",
          defaultValue,
          overrides: {
            staging: [{ key: "all", conditions: "*", mutate: mutations }],
            production: [{ key: "all", conditions: "*", continue: true, mutate: mutations }],
          },
        }),
      });
      for (const environment of ["staging", "production"]) {
        const datafile = await buildDatafile(
          config,
          datasource,
          { revision: "1", environment },
          existingState,
        );
        const f = createFeaturevisor({ datafile, logLevel: "fatal" });
        expect(f.getVariable("policy")).toEqual({
          tags: ["a"],
          items: [{ id: "basket" }, { id: "payment" }, { id: "confirmation" }],
        });
        expect(Boolean(datafile.variables!.policy.overrideProgram)).toBe(
          environment === "production",
        );
        expect(defaultValue).toEqual({ tags: ["a", "a"], items: [{ id: "checkout" }] });
        f.close();
      }
    },
  );

  test("builds tagged global variables with dependencies and resolved mutations", async () => {
    const config = createProjectConfig(root, true);
    const datasource = createMockDatasource({
      checkout: {
        key: "checkout",
        description: "Checkout",
        tags: ["server"],
        bucketBy: "userId",
        rules: { staging: [{ key: "all", conditions: "*", percentage: 100, enabled: true }] },
      } as ParsedFeature,
      account: {
        key: "account",
        description: "Account",
        tags: ["server"],
        bucketBy: "userId",
        rules: { staging: [{ key: "all", conditions: "*", percentage: 100, enabled: true }] },
      } as ParsedFeature,
    });
    Object.assign(datasource, {
      listVariables: async () => ["banner", "serverOnly"],
      readVariable: async (key: string) =>
        key === "banner"
          ? {
              description: "Banner",
              tags: ["web"],
              type: "object",
              properties: {
                title: { type: "string" },
                subtitle: { type: "string" },
              },
              defaultValue: { title: "Hello", subtitle: "Default" },
              conditions: { feature: "checkout" },
              overrides: {
                staging: [
                  {
                    key: "eu",
                    conditions: ["europe", { feature: "account" }],

                    mutate: { title: "Hallo" },
                    overrides: [
                      {
                        key: "nl",
                        conditions: [
                          { attribute: "country", operator: "equals", value: "nl" },
                          { feature: "checkout" },
                        ],

                        mutate: { subtitle: "Hoi" },
                      },
                    ],
                  },
                  {
                    key: "checkout-only",
                    conditions: [
                      { attribute: "country", operator: "equals", value: "nl" },
                      { feature: "checkout" },
                    ],

                    value: { title: "Checkout", subtitle: "Selected" },
                  },
                ],
              },
            }
          : {
              description: "Server only",
              tags: ["server"],
              type: "string",
              defaultValue: "hidden",
            },
      getRequiredFeaturesChainForVariable: async (key: string) =>
        new Set(key === "banner" ? ["checkout", "account"] : []),
      listSegments: async () => ["europe"],
      readSegment: async () => ({
        conditions: [{ attribute: "continent", operator: "equals", value: "eu" }],
      }),
      listAttributes: async () => ["continent", "country"],
      readAttribute: async () => ({ description: "Attribute", type: "string" }),
    });

    const result = await buildDatafile(
      config,
      datasource,
      { revision: "1", environment: "staging", tag: "web" },
      existingState,
    );

    expect(Object.keys(result.variables || {})).toEqual(["banner"]);
    expect(Object.keys(result.features)).toEqual(["checkout", "account"]);
    expect(JSON.parse(result.variables!.banner.conditions as string)).toEqual({
      feature: "checkout",
    });
    expect(result.variables?.banner.overrides?.[0]).toEqual(
      expect.objectContaining({
        key: "nl",
        keyPath: ["eu", "nl"],
        conditions: JSON.stringify([
          "europe",
          { feature: "account" },
          { attribute: "country", operator: "equals", value: "nl" },
          { feature: "checkout" },
        ]),

        value: { title: "Hallo", subtitle: "Hoi" },
      }),
    );
    expect(result.variables?.banner.overrides?.[1]).toEqual(
      expect.objectContaining({
        key: "eu",
        conditions: JSON.stringify(["europe", { feature: "account" }]),

        value: { title: "Hallo", subtitle: "Default" },
      }),
    );
    expect(result.variables?.banner.overrides?.[2]).toEqual(
      expect.objectContaining({
        key: "checkout-only",
        conditions: JSON.stringify([
          { attribute: "country", operator: "equals", value: "nl" },
          { feature: "checkout" },
        ]),

        value: { title: "Checkout", subtitle: "Selected" },
      }),
    );
    expect(result.variables?.banner.hash).toEqual(expect.any(String));
    expect(result.variables?.banner.overrideProgram).toBeUndefined();
    expect(Object.keys(result.segments)).toEqual(["europe"]);
  });

  test("builds a custom variable datafile with the union of requested dependencies", async () => {
    const config = createProjectConfig(root, true);
    const datasource = createMockDatasource({
      requested: {
        key: "requested",
        description: "Requested feature",
        bucketBy: "userId",
        rules: { staging: [{ key: "all", conditions: "*", percentage: 100 }] },
      },
      prerequisite: {
        key: "prerequisite",
        description: "Variable prerequisite",
        bucketBy: "userId",
        rules: { staging: [{ key: "all", conditions: "*", percentage: 100 }] },
      },
      unrelated: {
        key: "unrelated",
        description: "Unrelated feature",
        bucketBy: "userId",
        rules: { staging: [{ key: "all", conditions: "*", percentage: 100 }] },
      },
    });
    Object.assign(datasource, {
      readState: async () => existingState,
      listVariables: async () => ["settings", "unrelatedVariable"],
      readVariable: async (key: string) => ({
        description: key,
        type: "string",
        defaultValue: key,
        conditions: key === "settings" ? { feature: "prerequisite" } : undefined,
      }),
      getRequiredFeaturesChain: async (key: string) => new Set([key]),
      getRequiredFeaturesChainForVariable: async (key: string) =>
        new Set(key === "settings" ? ["prerequisite"] : []),
    });

    const result = await getCustomDatafile({
      featureKey: "requested",
      variableKey: "settings",
      environment: "staging",
      projectConfig: config,
      datasource,
    });

    expect(Object.keys(result.features)).toEqual(["requested", "prerequisite"]);
    expect(Object.keys(result.variables || {})).toEqual(["settings"]);
  });

  test("includes feature variable override dependencies when feature filters are used", async () => {
    const config = createProjectConfig(root, true);
    const datasource = createMockDatasource({
      selected: {
        key: "selected",
        description: "Selected",
        tags: ["all"],
        bucketBy: "userId",
        variablesSchema: { message: { type: "string", defaultValue: "default" } },
        rules: {
          staging: [
            {
              key: "all",
              conditions: "*",
              percentage: 100,
              variableOverrides: {
                message: [{ conditions: { feature: "prerequisite" }, value: "matched" }],
              },
            },
          ],
        },
      } as ParsedFeature,
      prerequisite: {
        key: "prerequisite",
        description: "Prerequisite",
        tags: ["server"],
        bucketBy: "userId",
        rules: { staging: [{ key: "all", conditions: "*", percentage: 100 }] },
      } as ParsedFeature,
    });
    datasource.getRequiredFeaturesChain = async (key: string) =>
      new Set(key === "selected" ? ["selected", "prerequisite"] : [key]);

    const result = await buildDatafile(
      config,
      datasource,
      { revision: "1", environment: "staging", tag: "all" },
      existingState,
    );

    expect(Object.keys(result.features)).toEqual(["selected", "prerequisite"]);
  });

  test("rejects legacy authored feature requirements while retaining canonical requirements", async () => {
    const config = createProjectConfig(root, true);
    const datasource = createMockDatasource({
      prerequisite: {
        key: "prerequisite",
        description: "Prerequisite",
        bucketBy: "userId",
        rules: { staging: [{ key: "all", conditions: "*", percentage: 100, enabled: true }] },
      },
      canonical: {
        key: "canonical",
        description: "Canonical",
        bucketBy: "userId",
        conditions: { feature: "prerequisite" },
        rules: { staging: [{ key: "all", conditions: "*", percentage: 100, enabled: true }] },
      },
      legacy: {
        key: "legacy",
        description: "Legacy",
        bucketBy: "userId",
        required: [{ key: "prerequisite", variation: "control" }],
        rules: { staging: [{ key: "all", conditions: "*", percentage: 100, enabled: true }] },
      } as unknown as ParsedFeature,
    });

    await expect(
      buildDatafile(config, datasource, { revision: "1", environment: "staging" }, existingState),
    ).rejects.toThrow(/Feature "legacy" at required:.*Use `conditions`/);

    const canonicalDatasource = createMockDatasource({
      prerequisite: await datasource.readFeature("prerequisite"),
      canonical: await datasource.readFeature("canonical"),
    });
    const result = await buildDatafile(
      config,
      canonicalDatasource,
      { revision: "1", environment: "staging" },
      existingState,
    );

    expect(JSON.parse(result.features.canonical.conditions as string)).toEqual({
      feature: "prerequisite",
    });
    expect(result.features.canonical).not.toHaveProperty("required");
  });

  test("JSON build leaves stdout valid and emits no mutation order warning", async () => {
    const config = createProjectConfig(root, true);
    const datasource = createBuildDatasource(createOrderingFeature());
    const stdout = jest.spyOn(console, "log").mockImplementation(() => {});
    const stderr = jest.spyOn(console, "error").mockImplementation(() => {});

    await buildProject({ projectConfig: config, datasource } as any, {
      json: true,
      environment: "staging",
      target: "all",
    });

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(() => JSON.parse(String(stdout.mock.calls[0][0]))).not.toThrow();
    expect(stderr).not.toHaveBeenCalled();
  });

  test("target-only build emits no mutation order warning across environments", async () => {
    const config = createProjectConfig(root, true);
    const datasource = createBuildDatasource(createOrderingFeature());
    const stderr = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});

    await buildProject({ projectConfig: config, datasource } as any, {
      target: "all",
      stateFiles: false,
    });

    expect(stderr).not.toHaveBeenCalled();
  });

  test("set builds emit no mutation order warnings", async () => {
    const config = { ...createProjectConfig(root, true), sets: true };
    const alpha = createBuildDatasource(createOrderingFeature("alpha"));
    const beta = createBuildDatasource({
      betaOne: createOrderingFeature("betaOne"),
      betaTwo: createOrderingFeature("betaTwo"),
    });
    alpha.getConfig = () => ({ ...config, sets: false });
    beta.getConfig = () => ({ ...config, sets: false });
    const datasource = {
      listSets: async () => ["alpha", "beta"],
      forSet: (set: string) => (set === "alpha" ? alpha : beta),
      readRevision: async () => "1",
    };
    const stderr = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});

    await buildProjectSets({ projectConfig: config, datasource } as any, {
      target: "all",
      stateFiles: false,
    });

    expect(stderr).not.toHaveBeenCalled();
  });

  test("filters global variables with independent include and exclude patterns", async () => {
    const config = createProjectConfig(root, true);
    const datasource = createMockDatasource({});
    Object.assign(datasource, {
      listVariables: async () => ["checkoutMessage", "checkoutInternal", "supportEmail"],
      readVariable: async (key: string) => ({
        description: key,
        tags: key === "supportEmail" ? ["support"] : ["checkout"],
        type: "string",
        defaultValue: key,
      }),
      getRequiredFeaturesChainForVariable: async () => new Set(),
    });

    const result = await buildDatafile(
      config,
      datasource,
      {
        revision: "1",
        environment: "staging",
        tag: "checkout",
        includeVariables: ["checkout*"],
        excludeVariables: ["*Internal"],
      },
      existingState,
    );

    expect(Object.keys(result.variables || {})).toEqual(["checkoutMessage"]);
  });

  test("emits a non-JSON runtime type for oneOf global variables", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-global-one-of-"));
    fs.mkdirSync(path.join(root, "variables"), { recursive: true });
    const config = createProjectConfig(root);
    const datasource = createMockDatasource({});
    Object.assign(datasource, {
      listVariables: async () => ["union"],
      readVariable: async () => ({
        description: "Union",
        oneOf: [{ type: "string" }, { type: "integer" }],
        defaultValue: "plain-string",
      }),
    });

    const result = await buildDatafile(
      config,
      datasource,
      { revision: "1", environment: "staging" },
      existingState,
    );

    expect(result.variables?.union).toEqual(
      expect.objectContaining({ type: "string", defaultValue: "plain-string" }),
    );
  });
});
