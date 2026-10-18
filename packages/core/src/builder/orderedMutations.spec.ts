import * as path from "node:path";
import Ajv from "ajv";
import type {
  ParsedFeature,
  ParsedVariable,
  ParsedVariableOverride,
  VariableMutations,
  VariableValue,
} from "@featurevisor/types";
import { applyVariableOperations, createFeaturevisor } from "@featurevisor/sdk";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { lintProject } from "../linter/lintProject";
import { createTestReport } from "../tester/report";
import { testProject } from "../tester/testProject";
import { buildDatafile } from "./buildDatafile";
import { generateHashForDatafile } from "./hashes";
import { compileVariableOperations } from "./variableOverrideProgram";
import { mutationEntries } from "./mutationEntries";

const entries: Array<[string, VariableValue]> = [
  ["methods", ["card"]],
  ["methods:append", "ideal"],
  ["label", "Checkout"],
];
const map = Object.fromEntries(entries);
const list = entries.map(([key, value]) => ({ [key]: value }));
const initial = { methods: ["default"], label: "Default" };

function override(mutate: VariableMutations): ParsedVariableOverride {
  return { key: "all", conditions: "*", mutate };
}

async function build(
  mutate: VariableMutations,
  precomputeMutations: boolean,
  environment: string | false = "staging",
  continuing = false,
  stringify = false,
) {
  const config = {
    ...getProjectConfig(path.resolve(__dirname, "../../../../examples/example-1")),
    environments: environment ? ["staging", "production"] : undefined,
    plugins: [],
    adapter: {},
    precomputeMutations,
    stringify,
  };
  const scoped = <T>(items: T[]) => (environment ? { staging: items, production: items } : items);
  const parent: ParsedVariableOverride = {
    ...override(mutate),
    key: "parent",
    ...(continuing ? { continue: true } : {}),
    overrides: [
      {
        key: "child",
        conditions: { attribute: "country", operator: "equals", value: "nl" },
        mutate: Array.isArray(mutate)
          ? [{ "methods:append": "child" }]
          : { "methods:append": "child" },
      },
    ],
  };
  const variable: ParsedVariable = {
    type: "object",
    defaultValue: initial,
    overrides: scoped([
      parent,
      {
        ...override(
          Array.isArray(mutate) ? [{ "methods:append": "tail" }] : { "methods:append": "tail" },
        ),
        key: "tail",
      },
    ]),
  };
  const feature: ParsedFeature = {
    key: "orderedMutation",
    description: "Ordered mutation parity",
    tags: ["all"],
    bucketBy: "userId",
    variablesSchema: {
      ruleValue: { type: "object", defaultValue: initial },
      variationValue: { type: "object", defaultValue: initial },
    },
    variations: [
      {
        value: "control",
        weight: 100,
        variableOverrides: { variationValue: [{ key: "variation", conditions: "*", mutate }] },
      },
    ],
    rules: scoped([
      {
        key: "all",
        conditions: "*",
        percentage: 100,
        variableOverrides: { ruleValue: [{ key: "rule", conditions: "*", mutate }] },
      },
    ]),
  };
  const datasource = {
    listSchemas: async () => [],
    listFeatures: async () => [feature.key],
    readFeature: async () => feature,
    listSegments: async () => [],
    listAttributes: async () => ["country"],
    readAttribute: async () => ({ type: "string" }),
    listVariables: async () => ["orderedMutation"],
    readVariable: async () => variable,
    getRequiredFeaturesChain: async (key: string) => new Set([key]),
    getRequiredFeaturesChainForVariable: async () => new Set<string>(),
  } as unknown as Datasource;
  const before = JSON.stringify({ variable, feature });
  const datafile = await buildDatafile(
    config,
    datasource,
    { revision: "ordered", environment },
    { features: {} },
  );
  expect(JSON.stringify({ variable, feature })).toBe(before);
  return datafile;
}

describe("ordered authoring mutations", () => {
  test.each([true, false])(
    "Example1 ordered definitions lint and pass their specs with precompute=%s",
    async (precomputeMutations) => {
      const rootDirectoryPath = path.resolve(__dirname, "../../../../examples/example-1");
      const projectConfig = {
        ...getProjectConfig(rootDirectoryPath),
        plugins: [],
        precomputeMutations,
      };
      const deps = {
        rootDirectoryPath,
        projectConfig,
        datasource: new Datasource(projectConfig, rootDirectoryPath),
        options: {},
      };
      const output = jest.spyOn(console, "log").mockImplementation(() => {});
      try {
        const lint = await lintProject(deps, { keyPattern: "orderedMutation", json: true });
        expect(lint.errors).toEqual([]);
        expect(lint.hasError).toBe(false);
        const report = createTestReport();
        const hasError = await testProject(deps, {
          keyPattern: "orderedMutation",
          quiet: true,
          report,
        });
        expect(
          report.results.flatMap((result) => result.cases).filter((item) => !item.passed),
        ).toEqual([]);
        expect(hasError).toBe(false);
        expect(report.errors).toEqual([]);
        expect(report.summary.assertions).toEqual({ passed: 10, failed: 0 });
      } finally {
        output.mockRestore();
      }
    },
  );

  test("equivalent map and list compile to identical operations", () => {
    expect(compileVariableOperations(override(list))).toEqual(
      compileVariableOperations(override(map)),
    );
    expect(mutationEntries(list)).toEqual(entries);
  });

  test.each(
    [true, false].flatMap((precompute) =>
      [true, false].flatMap((continuing) =>
        [true, false].flatMap((stringify) =>
          (["staging", "production", false] as const).map((environment) => ({
            precompute,
            continuing,
            stringify,
            environment,
          })),
        ),
      ),
    ),
  )(
    "identical datafiles precompute=$precompute continue=$continuing stringify=$stringify environment=$environment",
    async ({ precompute, continuing, stringify, environment }) => {
      const mapDatafile = await build(map, precompute, environment, continuing, stringify);
      const listDatafile = await build(list, precompute, environment, continuing, stringify);
      expect(JSON.stringify(listDatafile)).toBe(JSON.stringify(mapDatafile));
      const sortedKeys = (_key: string, value: unknown) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value;
      expect(JSON.stringify(listDatafile, sortedKeys, 2)).toBe(
        JSON.stringify(mapDatafile, sortedKeys, 2),
      );
      expect(listDatafile.features.orderedMutation.hash).toEqual(expect.any(String));
      expect(listDatafile.variables!.orderedMutation.hash).toEqual(expect.any(String));
      expect(generateHashForDatafile(listDatafile)).toBe(generateHashForDatafile(mapDatafile));
      expect(Boolean(listDatafile.variables!.orderedMutation.overrideProgram)).toBe(
        continuing || !precompute,
      );
      const f = createFeaturevisor({ datafile: listDatafile, logLevel: "fatal" });
      try {
        for (const country of ["nl", "de"]) {
          expect(f.getVariable("orderedMutation", { country })).toEqual({
            methods: [
              "card",
              "ideal",
              ...(country === "nl" ? ["child"] : []),
              ...(continuing ? ["tail"] : []),
            ],
            label: "Checkout",
          });
          expect(f.getVariable("orderedMutation", "ruleValue", { country })).toEqual({
            methods: ["card", "ideal"],
            label: "Checkout",
          });
          expect(f.getVariable("orderedMutation", "variationValue", { country })).toEqual({
            methods: ["card", "ideal"],
            label: "Checkout",
          });
        }
      } finally {
        f.close();
      }
    },
  );

  test.each([true, false])("repeated paths apply twice with precompute=%s", async (precompute) => {
    const mutations = [{ "methods:append": "one" }, { "methods:append": "two" }];
    expect(compileVariableOperations(override(mutations))).toEqual([
      { op: "append", path: ["methods"], value: "one" },
      { op: "append", path: ["methods"], value: "two" },
    ]);
    const datafile = await build(mutations, precompute);
    const f = createFeaturevisor({ datafile, logLevel: "fatal" });
    try {
      expect(f.getVariable("orderedMutation", { country: "de" })).toEqual({
        methods: ["default", "one", "two"],
        label: "Default",
      });
      for (const key of ["ruleValue", "variationValue"]) {
        expect(f.getVariable("orderedMutation", key)).toEqual({
          methods: ["default", "one", "two"],
          label: "Default",
        });
      }
    } finally {
      f.close();
    }
  });

  test.each([true, false])(
    "set and append order changes values with precompute=%s",
    async (precompute) => {
      for (const [mutations, expected] of [
        [
          [{ methods: ["card"] }, { "methods:append": "ideal" }],
          ["card", "ideal"],
        ],
        [[{ "methods:append": "ideal" }, { methods: ["card"] }], ["card"]],
      ] as Array<[VariableMutations, string[]]>) {
        const f = createFeaturevisor({
          datafile: await build(mutations, precompute),
          logLevel: "fatal",
        });
        try {
          expect(f.getVariable("orderedMutation", { country: "de" })).toEqual({
            methods: expected,
            label: "Default",
          });
          for (const key of ["ruleValue", "variationValue"]) {
            expect(f.getVariable("orderedMutation", key)).toEqual({
              methods: expected,
              label: "Default",
            });
          }
        } finally {
          f.close();
        }
      }
    },
  );

  test.each([true, false])(
    "empty map and list are equivalent with precompute=%s",
    async (precompute) => {
      expect(compileVariableOperations(override({}))).toEqual([]);
      expect(compileVariableOperations(override([]))).toEqual([]);
      const mapDatafile = await build({}, precompute);
      const listDatafile = await build([], precompute);
      expect(JSON.stringify(listDatafile)).toBe(JSON.stringify(mapDatafile));
      const f = createFeaturevisor({ datafile: listDatafile, logLevel: "fatal" });
      try {
        expect(f.getVariable("orderedMutation", { country: "de" })).toEqual(initial);
        expect(f.getVariable("orderedMutation", "ruleValue")).toEqual({});
        expect(f.getVariable("orderedMutation", "variationValue")).toEqual({});
      } finally {
        f.close();
      }
    },
  );

  test("integer like map keys retain enumeration order while lists retain written order", () => {
    const authored: Array<[string, VariableValue]> = [
      ["0.label", "child"],
      ["0", { label: "parent" }],
    ];
    const mapOperations = compileVariableOperations(override(Object.fromEntries(authored)));
    const listOperations = compileVariableOperations(
      override(authored.map(([key, value]) => ({ [key]: value }))),
    );
    expect(mapOperations.map((operation) => operation.path)).toEqual([["0"], ["0", "label"]]);
    expect(listOperations.map((operation) => operation.path)).toEqual([["0", "label"], ["0"]]);
    expect(applyVariableOperations({ "0": { label: "default" } }, mapOperations)).toEqual({
      "0": { label: "child" },
    });
    expect(applyVariableOperations({ "0": { label: "default" } }, listOperations)).toEqual({
      "0": { label: "parent" },
    });
  });

  test.each(["feature", "global-variable"])(
    "%s editor schema accepts only single entry list items everywhere",
    (name) => {
      const schema = require("../../json-schema/" + name + ".json");
      const ajv = new Ajv();
      const found: object[] = [];
      const visit = (node: any) => {
        if (!node || typeof node !== "object") return;
        if (node.mutate) found.push(node.mutate);
        Object.values(node).forEach(visit);
      };
      visit(schema);
      expect(found).toHaveLength(name === "feature" ? 4 : 2);
      for (const mutateSchema of found) {
        const validate = ajv.compile({ definitions: schema.definitions, ...mutateSchema });
        for (const value of [
          {},
          [],
          map,
          list,
          [{ "methods:append": "one" }, { "methods:append": "two" }],
        ]) {
          expect(validate(value)).toBe(true);
        }
        for (const value of [
          null,
          "bad",
          42,
          [null],
          ["bad"],
          [42],
          [[]],
          [{}],
          [{ a: 1, b: 2 }],
        ]) {
          expect(validate(value)).toBe(false);
        }
      }
    },
  );
});
