import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ParsedVariable } from "@featurevisor/types";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { buildTargetDatafile } from "./buildProject";
import { validateDependencies } from "../datasource/dependencies";
import { createFeaturevisor } from "@featurevisor/sdk";

describe("composition builder", () => {
  let root: string;
  const write = (directory: string, key: string, value: unknown) => {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(path.join(root, directory, `${key}.yml`), JSON.stringify(value));
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-compose-"));
    fs.writeFileSync(
      path.join(root, "featurevisor.config.js"),
      "module.exports={tags:['web','source']};",
    );
    write("features", "checkout", {
      description: "Checkout",
      tags: ["source"],
      variablesSchema: { label: { type: "string", defaultValue: "Buy" } },
      variations: [{ value: "express", weight: 100 }],
      rules: [{ key: "all", conditions: "*", percentage: 100 }],
    });
    write("variables", "policy", {
      description: "Policy",
      tags: ["source"],
      type: "object",
      defaultValue: { limit: 50 },
    });
    write("variables", "screen", {
      description: "Screen",
      tags: ["web"],
      compose: {
        zFlag: { feature: "checkout" },
        label: { feature: "checkout", variable: "label" },
        aConfig: { variable: "policy" },
      },
    });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const datasource = () => new Datasource(getProjectConfig(root), root);
  const build = async (
    target: Parameters<typeof buildTargetDatafile>[0]["target"] = {
      description: "Web",
      tag: "web",
    },
    extra = {},
  ) => {
    const ds = datasource();
    return buildTargetDatafile({
      projectConfig: ds.getConfig(),
      datasource: ds,
      target,
      environment: false,
      existingState: { features: {} },
      revision: "composition",
      ...extra,
    });
  };
  it("infers shared alias chains with linear visits and a cache scoped to each build", async () => {
    // Long enough to expose quadratic visits, short enough for the runtime handoff limit.
    const length = 250;
    let reads = 0;
    const definitions: Record<string, ParsedVariable> = {};
    for (let index = length - 1; index >= 0; index--) {
      const source = index === 0 ? "source" : `alias${index - 1}`;
      definitions[`alias${index}`] = {
        description: "Alias",
        get compose() {
          reads++;
          return source;
        },
      };
    }
    definitions.source = { description: "Source", type: "integer", defaultValue: 1 };
    const ds = datasource();
    jest.spyOn(ds, "listVariables").mockResolvedValue(Object.keys(definitions));
    jest.spyOn(ds, "listFeatures").mockResolvedValue([]);
    jest.spyOn(ds, "readVariable").mockImplementation(async (key) => definitions[key]);
    const run = () =>
      buildTargetDatafile({
        projectConfig: ds.getConfig(),
        datasource: ds,
        target: { description: "All" },
        environment: false,
        existingState: { features: {} },
        revision: "alias-cache",
      });
    const first = await run();
    expect(Object.values(first.variables!).every((variable) => variable.type === "integer")).toBe(
      true,
    );
    expect(reads).toBeLessThan(length * 20);
    definitions.source = { description: "Changed", type: "boolean", defaultValue: false };
    reads = 0;
    const second = await run();
    expect(Object.values(second.variables!).every((variable) => variable.type === "boolean")).toBe(
      true,
    );
    expect(reads).toBeLessThan(length * 20);
  });
  it.each([
    ["boolean", false],
    ["string", "text"],
    ["integer", 2],
    ["number", 2.5],
    ["array", [1, null]],
    ["object", { limit: 5 }],
    ["json", '{"decoded":true}'],
  ])(
    "inherits %s through alias chains and retains exact getter projections",
    async (type, defaultValue) => {
      write("variables/source", "literal", {
        description: "Source",
        type,
        defaultValue,
        tags: ["source"],
      });
      write("variables", "alias", {
        description: "Alias",
        compose: "source.literal",
        tags: ["source"],
      });
      write("variables", "screen", { description: "Screen", compose: "alias", tags: ["web"] });
      const datafile = await build({
        description: "Web",
        tag: "web",
        excludeVariables: ["source.literal", "alias"],
      });
      expect(datafile.variables!.screen.type).toBe(type);
      expect(datafile.variables!.alias.type).toBe(type);
      expect(datafile.variables!.screen.compose).toBe("alias");
      expect(datafile.variables!.screen).not.toHaveProperty("defaultValue");
      const f = createFeaturevisor({ datafile });
      if (type === "json") expect(f.getVariable("screen")).toEqual({ decoded: true });
      else expect(f.getVariable("screen")).toBe(f.getVariable("source.literal"));
    },
  );
  it("inherits schema types and map composition types through aliases", async () => {
    write("schemas", "count", { type: "integer" });
    write("variables", "policy", { description: "Policy", schema: "count", defaultValue: 2 });
    write("variables", "screen", { description: "Alias", compose: "policy", tags: ["web"] });
    write("variables", "map", {
      description: "Map",
      compose: { count: { variable: "screen" } },
      tags: ["source"],
    });
    write("variables", "mapAlias", { description: "Map alias", compose: "map", tags: ["web"] });
    const datafile = await build();
    expect(datafile.variables!.screen.type).toBe("integer");
    expect(datafile.variables!.mapAlias.type).toBe("object");
    expect(createFeaturevisor({ datafile }).getVariable("mapAlias")).toEqual({ count: 2 });
  });
  it.each([
    { schema: { type: "integer" }, defaultValue: 2, type: "integer" },
    {
      schema: { oneOf: [{ type: "string" }, { type: "boolean" }] },
      defaultValue: false,
      type: "string",
    },
    { schema: { const: "literal" }, defaultValue: "literal", type: "string" },
  ])(
    "infers referenced schema types without selecting a oneOf branch: $type",
    async ({ schema, defaultValue, type }) => {
      write("schemas", "entry", { schema: "terminal" });
      write("schemas", "terminal", schema);
      write("variables", "policy", { description: "Policy", schema: "entry", defaultValue });
      write("variables", "screen", { description: "Alias", compose: "policy", tags: ["web"] });
      const datafile = await build();
      expect(datafile.variables!.screen.type).toBe(type);
      expect(createFeaturevisor({ datafile }).getVariable("screen")).toEqual(defaultValue);
    },
  );
  it.each([true, false])(
    "keeps alias overrides at runtime with precomputeMutations=%s",
    async (precomputeMutations) => {
      fs.writeFileSync(
        path.join(root, "featurevisor.config.js"),
        `module.exports={tags:['web','source'],precomputeMutations:${precomputeMutations}};`,
      );
      write("variables", "screen", {
        description: "Alias",
        compose: "policy",
        tags: ["web"],
        overrides: [
          { key: "change", conditions: "*", continue: true, mutate: { limit: 80 } },
          { key: "replace", conditions: "*", value: { limit: 100 } },
        ],
      });
      const datafile = await build();
      expect(datafile.variables!.screen.overrideProgram).toHaveLength(2);
      expect(datafile.variables!.screen).not.toHaveProperty("defaultValue");
      expect(datafile.variables!.screen).not.toHaveProperty("overrides");
      const f = createFeaturevisor({ datafile });
      expect(f.getVariable("screen")).toEqual({ limit: 100 });
      expect(f.getVariable("policy")).toEqual({ limit: 50 });
      const result = f.getVariable("screen");
      expect(f.getVariable("screen")).toBe(result);
    },
  );
  it("preserves null aliases and accepts decoded JSON replacements and mutations", async () => {
    write("variables", "policy", {
      description: "JSON",
      type: "json",
      defaultValue: "null",
      tags: ["source"],
    });
    write("variables", "screen", { description: "Alias", compose: "policy", tags: ["web"] });
    expect(createFeaturevisor({ datafile: await build() }).getVariable("screen")).toBeNull();
    write("variables", "screen", {
      description: "Alias",
      compose: "policy",
      tags: ["web"],
      overrides: [
        { key: "replace", conditions: "*", value: { decoded: true }, continue: true },
        { key: "change", conditions: "*", mutate: { decoded: false } },
      ],
    });
    const datafile = await build();
    expect(datafile.variables!.screen.type).toBe("json");
    expect(createFeaturevisor({ datafile }).getVariable("screen")).toEqual({ decoded: false });
  });
  it.each(["variable", "feature"])(
    "hashes transitive alias %s dependencies and emits updates",
    async (kind) => {
      write("variables", "alias", { description: "Alias", compose: "policy", tags: ["source"] });
      write(
        "variables",
        "policy",
        kind === "variable"
          ? { description: "Policy", type: "object", defaultValue: { limit: 50 }, tags: ["source"] }
          : {
              description: "Policy",
              compose: { enabled: { feature: "checkout" } },
              tags: ["source"],
            },
      );
      write("variables", "screen", { description: "Screen", compose: "alias", tags: ["web"] });
      const before = await build();
      const f = createFeaturevisor({ datafile: before });
      if (kind === "variable")
        write("variables", "policy", {
          description: "Policy",
          type: "object",
          defaultValue: { limit: 80 },
          tags: ["source"],
        });
      else
        write("features", "checkout", {
          description: "Checkout",
          tags: ["source"],
          rules: [{ key: "all", conditions: "*", percentage: 0 }],
        });
      const after = await build();
      expect(after.variables!.screen.hash).not.toBe(before.variables!.screen.hash);
      expect(after.variables!.alias.hash).not.toBe(before.variables!.alias.hash);
      const events: string[][] = [];
      f.on("datafile_set", (details) => events.push(details.variables));
      f.setDatafile({
        schemaVersion: "2",
        revision: "partial",
        features: kind === "feature" ? after.features : {},
        segments: {},
        variables: kind === "variable" ? { policy: after.variables!.policy } : {},
      });
      expect(events[0]).toEqual(expect.arrayContaining(["screen", "alias"]));
      expect(f.getVariable("screen")).toEqual(
        kind === "variable" ? { limit: 80 } : { enabled: false },
      );
    },
  );
  it.each(["missing", "archived", "hidden"])(
    "fails a selected alias with an unavailable %s source",
    async (reason) => {
      write("variables", "screen", { description: "Screen", compose: "policy", tags: ["web"] });
      if (reason === "missing") fs.unlinkSync(path.join(root, "variables", "policy.yml"));
      if (reason === "archived")
        write("variables", "policy", {
          description: "Policy",
          type: "object",
          defaultValue: {},
          archived: true,
        });
      if (reason === "hidden") {
        write("variables", "policy", {
          description: "Policy",
          compose: { enabled: { feature: "checkout" } },
        });
        write("features", "checkout", { description: "Checkout", expose: false, rules: [] });
      }
      await expect(build()).rejects.toThrow(
        /Composition "screen".*variable "screen" compose -> variable "policy"/,
      );
    },
  );
  it("compiles deterministic property entries and includes excluded sources with different tags", async () => {
    const datafile = await build({
      description: "Web",
      tag: "web",
      excludeFeatures: "*",
      excludeVariables: ["policy"],
    });
    expect(Object.keys(datafile.features)).toEqual(["checkout"]);
    expect(Object.keys(datafile.variables!)).toEqual(["screen", "policy"]);
    expect(datafile.variables!.screen.compose).toEqual([
      { key: "aConfig", variable: "policy" },
      { key: "label", feature: "checkout", variable: "label" },
      { key: "zFlag", feature: "checkout" },
    ]);
    expect(datafile.variables!.screen).not.toHaveProperty("defaultValue");
    expect(createFeaturevisor({ datafile }).getVariable("screen")).toEqual({
      aConfig: { limit: 50 },
      label: "Buy",
      zFlag: true,
    });
  });
  it.each([true, false])(
    "compiles composed overrides to runtime operations with precomputeMutations=%s",
    async (precomputeMutations) => {
      fs.writeFileSync(
        path.join(root, "featurevisor.config.js"),
        `module.exports={tags:['web','source'], precomputeMutations:${precomputeMutations}};`,
      );
      write("attributes", "country", { description: "Country", type: "string" });
      write("segments", "dutch", {
        description: "Dutch",
        conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
      });
      write("variables", "gate", {
        description: "Gate",
        tags: ["source"],
        type: "boolean",
        defaultValue: true,
      });
      write("variables", "screen", {
        description: "Screen",
        tags: ["web"],
        compose: { aConfig: { variable: "policy" }, zFlag: { feature: "checkout" } },
        overrides: [
          {
            key: "parent",
            conditions: ["dutch", { variable: "gate", operator: "equals", value: true }],

            continue: true,
            mutate: { "aConfig.limit": 80 },
            overrides: [{ key: "child", conditions: "*", mutate: { zFlag: false } }],
          },
          {
            key: "last",
            conditions: "dutch",
            mutate: [{ "aConfig.limit": 90 }, { "aConfig.limit": 100 }],
          },
        ],
      });
      const file = await build();
      expect(file.variables!.screen).not.toHaveProperty("defaultValue");
      expect(file.variables!.screen.overrideProgram).toHaveLength(3);
      expect(file.variables!.screen.overrideProgram![2].operations).toEqual([
        { op: "set", path: ["aConfig", "limit"], value: 90 },
        { op: "set", path: ["aConfig", "limit"], value: 100 },
      ]);
      expect(file.variables!.gate).toBeDefined();
      expect(file.segments.dutch).toBeDefined();
      const f = createFeaturevisor({ datafile: file });
      expect(f.getVariable("screen", { country: "nl" })).toEqual({
        aConfig: { limit: 100 },
        zFlag: false,
      });
      expect(f.getVariable("screen", { country: "us" })).toEqual({
        aConfig: { limit: 50 },
        zFlag: true,
      });
      expect(f.evaluateVariable("screen", { country: "nl" }).variableOverridePaths).toEqual([
        ["parent"],
        ["parent", "child"],
        ["last"],
      ]);
    },
  );
  it("selects environment specific composition overrides without changing the composed base", async () => {
    fs.writeFileSync(
      path.join(root, "featurevisor.config.js"),
      "module.exports={environments:['production','staging']};",
    );
    write("variables", "screen", {
      description: "Screen",
      compose: { config: { variable: "policy" } },
      overrides: {
        production: [{ key: "production", conditions: "*", mutate: { "config.limit": 100 } }],
      },
    });
    const prod = await build({ description: "All" }, { environment: "production" });
    const staging = await build({ description: "All" }, { environment: "staging" });
    expect(createFeaturevisor({ datafile: prod }).getVariable("screen")).toEqual({
      config: { limit: 100 },
    });
    expect(createFeaturevisor({ datafile: staging }).getVariable("screen")).toEqual({
      config: { limit: 50 },
    });
    expect(staging.variables!.screen.overrideProgram).toBeUndefined();
  });
  it.each(["segment", "feature", "variable"] as const)(
    "hashes and invalidates dependencies used only by composed overrides: %s",
    async (kind) => {
      write("attributes", "country", { description: "Country", type: "string" });
      write("segments", "qualified", {
        description: "Qualified",
        conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
      });
      write("features", "gateFeature", {
        description: "Gate",
        tags: ["source"],
        rules: [{ key: "all", conditions: "*", percentage: 100 }],
      });
      write("variables", "gateVariable", {
        description: "Gate",
        type: "boolean",
        tags: ["source"],
        defaultValue: true,
      });
      write("variables", "screen", {
        description: "Screen",
        tags: ["web"],
        compose: { config: { variable: "policy" } },
        overrides: [
          {
            key: "qualified",
            conditions: [
              "qualified",
              { feature: "gateFeature" },
              { variable: "gateVariable", operator: "equals", value: true },
            ],

            mutate: { "config.limit": 100 },
          },
        ],
      });
      const before = await build();
      expect(before.features.gateFeature).toBeDefined();
      expect(before.variables!.gateVariable).toBeDefined();
      const f = createFeaturevisor({ logLevel: "fatal", datafile: before });
      expect(f.getVariable("screen", { country: "nl" })).toEqual({ config: { limit: 100 } });
      if (kind === "segment")
        write("segments", "qualified", {
          description: "Changed",
          conditions: [{ attribute: "country", operator: "equals", value: "us" }],
        });
      else if (kind === "feature")
        write("features", "gateFeature", {
          description: "Changed",
          tags: ["source"],
          rules: [{ key: "all", conditions: "*", percentage: 0 }],
        });
      else
        write("variables", "gateVariable", {
          description: "Changed",
          tags: ["source"],
          type: "boolean",
          defaultValue: false,
        });
      const after = await build();
      expect(after.variables!.screen.hash).not.toBe(before.variables!.screen.hash);
      const events: string[][] = [];
      f.on("datafile_set", (details) => events.push(details.variables));
      f.setDatafile({
        schemaVersion: "2",
        revision: "partial",
        features: kind === "feature" ? { gateFeature: after.features.gateFeature } : {},
        segments: kind === "segment" ? { qualified: after.segments.qualified } : {},
        variables: kind === "variable" ? { gateVariable: after.variables!.gateVariable } : {},
      });
      expect(events[0]).toContain("screen");
      expect(f.getVariable("screen", { country: "nl" })).toEqual({ config: { limit: 50 } });
    },
  );
  it("keeps ordinary filtered datafiles byte identical with an unrelated composition present", async () => {
    const target = { description: "Sources", tag: "source" };
    const withComposition = JSON.stringify(await build(target));
    fs.unlinkSync(path.join(root, "variables", "screen.yml"));
    expect(JSON.stringify(await build(target))).toBe(withComposition);
  });
  it.each(["feature", "variable"])(
    "changes a composition hash when its %s source changes",
    async (kind) => {
      const before = await build();
      if (kind === "variable")
        write("variables", "policy", {
          description: "Policy",
          type: "object",
          defaultValue: { limit: 80 },
        });
      else
        write("features", "checkout", {
          description: "Checkout",
          variablesSchema: { label: { type: "string", defaultValue: "Changed" } },
          rules: [{ key: "all", conditions: "*", percentage: 0 }],
        });
      expect((await build()).variables!.screen.hash).not.toBe(before.variables!.screen.hash);
    },
  );
  it.each(["expose", "archived", "missing"])(
    "refuses incomplete %s feature dependencies",
    async (reason) => {
      if (reason === "missing") fs.unlinkSync(path.join(root, "features", "checkout.yml"));
      else
        write("features", "checkout", {
          description: "Checkout",
          rules: [],
          [reason]: reason === "expose" ? false : true,
        });
      await expect(build()).rejects.toThrow(/Composition "screen" property .*checkout/);
    },
  );
  it("refuses missing and archived variable dependencies", async () => {
    write("variables", "policy", {
      description: "Policy",
      type: "object",
      defaultValue: {},
      archived: true,
    });
    await expect(build()).rejects.toThrow(/Composition "screen" property "aConfig"/);
    fs.unlinkSync(path.join(root, "variables", "policy.yml"));
    await expect(build()).rejects.toThrow(/Composition "screen" property "aConfig"/);
  });
  it("reports the actual nested property and prerequisite route without duplicate identities", async () => {
    write("variables", "screen", {
      description: "Screen",
      tags: ["web"],
      compose: { "outer.property": { variable: "nested" } },
    });
    write("variables", "nested", {
      description: "Nested",
      compose: { "inner/property": { feature: "checkout" } },
    });
    write("features", "checkout", {
      description: "Checkout",
      rules: [],
      conditions: { feature: "hidden" },
    });
    write("features", "hidden", { description: "Hidden", rules: [], expose: false });
    await expect(build()).rejects.toThrow(
      'variable "screen" compose property "outer.property" -> variable "nested" compose property "inner/property" -> feature "checkout" conditions -> feature "hidden"',
    );
  });
  it("checks feature variable references reached through ordinary requirements", async () => {
    write("variables", "policy", {
      description: "Policy",
      type: "boolean",
      defaultValue: true,
      conditions: { feature: "checkout", variable: "missing", operator: "exists" },
    });
    await expect(build()).rejects.toThrow(
      'variable "screen" compose property "aConfig" -> variable "policy" conditions -> feature "checkout" variable "missing"',
    );
  });
  it("keeps exposure tags authoritative even for structurally included sources", async () => {
    write("features", "checkout", {
      description: "Checkout",
      rules: [],
      expose: ["source"],
      variablesSchema: { label: { type: "string", defaultValue: "Buy" } },
    });
    await expect(build()).rejects.toThrow(/exposure/);
  });
  it("preserves compositions during specialization, inflation and runtime mutation configuration", async () => {
    const base = await build();
    const contextual = await build(
      { description: "Web", tag: "web", context: { country: "nl" } },
      { inflate: 2 },
    );
    expect(contextual.variables!["screen-0"].compose).toEqual(base.variables!.screen.compose);
    expect(createFeaturevisor({ datafile: contextual }).getVariable("screen-0")).toEqual(
      createFeaturevisor({ datafile: base }).getVariable("screen"),
    );
    const config = datasource().getConfig();
    config.precomputeMutations = false;
    const ds = new Datasource(config, root);
    const runtime = await buildTargetDatafile({
      projectConfig: config,
      datasource: ds,
      target: { description: "Web", tag: "web" },
      environment: false,
      existingState: { features: {} },
      revision: "composition",
    });
    expect(runtime).toEqual(base);
  });
  it.each(["self", "indirect", "requirement", "override"])(
    "rejects %s mixed dependency cycles",
    async (kind) => {
      write("variables", "screen", {
        description: "Screen",
        compose:
          kind === "self"
            ? { self: { variable: "screen" } }
            : kind === "indirect"
              ? { other: { variable: "other" } }
              : { label: { feature: "checkout", variable: "label" } },
      });
      if (kind === "indirect")
        write("variables", "other", {
          description: "Other",
          compose: { back: { variable: "screen" } },
        });
      if (kind === "requirement")
        write("features", "checkout", {
          description: "Checkout",
          conditions: { variable: "screen", operator: "notNull" },
          variablesSchema: { label: { type: "string", defaultValue: "Buy" } },
          rules: [],
        });
      if (kind === "override")
        write("features", "checkout", {
          description: "Checkout",
          variablesSchema: { label: { type: "string", defaultValue: "Buy" } },
          rules: [
            {
              key: "all",
              conditions: "*",
              percentage: 100,
              variableOverrides: {
                label: [
                  {
                    conditions: { variable: "screen", operator: "notNull" },
                    value: "Cycle",
                  },
                ],
              },
            },
          ],
        });
      await expect(validateDependencies(datasource())).rejects.toThrow(/circular dependency/);
    },
  );
  it("allows acyclic composition chains without an additional configuration switch", async () => {
    write("variables", "parent", {
      description: "Parent",
      tags: ["web"],
      compose: { screen: { variable: "screen" } },
    });
    await expect(validateDependencies(datasource())).resolves.toBeUndefined();
    expect(createFeaturevisor({ datafile: await build() }).getVariable("parent")).toEqual({
      screen: { aConfig: { limit: 50 }, label: "Buy", zFlag: true },
    });
  });
});
