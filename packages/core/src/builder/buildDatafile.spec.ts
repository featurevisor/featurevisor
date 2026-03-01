import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { DatafileContent, ExistingState, ParsedFeature } from "@featurevisor/types";

import type { ProjectConfig } from "../config";
import { parsers } from "../parsers";
import { buildDatafile } from "./buildDatafile";

function createProjectConfig(root: string, stringify = true): ProjectConfig {
  return {
    featuresDirectoryPath: path.join(root, "features"),
    segmentsDirectoryPath: path.join(root, "segments-missing"),
    attributesDirectoryPath: path.join(root, "attributes-missing"),
    groupsDirectoryPath: path.join(root, "groups-missing"),
    schemasDirectoryPath: path.join(root, "schemas-missing"),
    testsDirectoryPath: path.join(root, "tests-missing"),
    stateDirectoryPath: path.join(root, ".featurevisor"),
    datafilesDirectoryPath: path.join(root, "datafiles"),
    datafileNamePattern: "featurevisor-%s.json",
    revisionFileName: "REVISION",
    siteExportDirectoryPath: path.join(root, "out"),
    environmentsDirectoryPath: path.join(root, "environments"),
    environments: ["staging", "production"],
    splitByEnvironment: false,
    tags: ["all"],
    scopes: [],
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

function createMockDatasource(feature: ParsedFeature) {
  return {
    listSchemas: async () => [],
    readSchema: async () => {
      throw new Error("readSchema should not be called");
    },
    listFeatures: async () => ["withRuleOverrides"],
    readFeature: async () => feature,
    listSegments: async () => [],
    readSegment: async () => {
      throw new Error("readSegment should not be called");
    },
    listAttributes: async () => [],
    readAttribute: async () => {
      throw new Error("readAttribute should not be called");
    },
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
          segments: "*",
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
                segments: { and: ["mobile", "touch"] },
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
          segments: "*",
          percentage: 100,
        },
      ],
    },
  } as ParsedFeature;
}

describe("core: buildDatafile", function () {
  let root: string;
  let existingState: ExistingState;

  beforeEach(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-buildDatafile-"));
    fs.mkdirSync(path.join(root, "features"), { recursive: true });
    existingState = { features: {} };
  });

  afterEach(function () {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("resolves rule variableOverrides mutations using rule variables as base and default fallback when missing", async function () {
    const config = createProjectConfig(root, true);
    const datasource = createMockDatasource(createFeatureFixture());

    const result = (await buildDatafile(
      config,
      datasource,
      {
        schemaVersion: "2",
        revision: "1",
        environment: "staging",
      },
      existingState,
    )) as DatafileContent;

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
    expect(typeof trafficRule?.variableOverrides?.config[0].segments).toBe("string");
    expect(trafficRule?.variableOverrides?.config[0].segments).toEqual(
      JSON.stringify({ and: ["mobile", "touch"] }),
    );
    expect(typeof trafficRule?.variableOverrides?.config[1].conditions).toBe("string");
    expect(trafficRule?.variableOverrides?.config[1].conditions).toEqual(
      JSON.stringify([{ attribute: "country", operator: "equals", value: "de" }]),
    );
  });

  test("keeps segments and conditions non-stringified when projectConfig.stringify is false", async function () {
    const config = createProjectConfig(root, false);
    const datasource = createMockDatasource(createFeatureFixture());

    const result = (await buildDatafile(
      config,
      datasource,
      {
        schemaVersion: "2",
        revision: "1",
        environment: "staging",
      },
      existingState,
    )) as DatafileContent;

    const trafficRule = result.features.withRuleOverrides.traffic.find((t) => t.key === "rule1");

    expect(trafficRule?.variableOverrides?.config[0].segments).toEqual({
      and: ["mobile", "touch"],
    });
    expect(trafficRule?.variableOverrides?.config[1].conditions).toEqual([
      { attribute: "country", operator: "equals", value: "de" },
    ]);
  });
});
