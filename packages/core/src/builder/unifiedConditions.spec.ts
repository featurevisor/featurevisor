import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Conditions, DatafileContent } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { buildDatafile } from "./buildDatafile";
import { buildProject } from "./buildProject";
import { buildDependencyGraph } from "../datasource/dependencies";
import { getSegmentHashes, refreshDatafileHashes } from "./hashes";

describe("conditions only datafile builds", () => {
  let root: string;
  const write = (kind: string, key: string, value: unknown) => {
    fs.mkdirSync(path.join(root, kind), { recursive: true });
    fs.writeFileSync(path.join(root, kind, `${key}.yml`), JSON.stringify(value));
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-unified-builder-"));
    fs.writeFileSync(
      path.join(root, "featurevisor.config.js"),
      "module.exports={tags:['selected','hidden']};",
    );
  });
  afterEach(() => fs.rmSync(root, { force: true, recursive: true }));

  const cycleKinds = [
    "segment",
    "feature",
    "feature-variable",
    "mixed",
    "composition",
    "mixed-composition",
  ] as const;
  function cyclicProject(kind: (typeof cycleKinds)[number]) {
    const feature: any = {
      description: "Root",
      tags: ["selected"],
      rules: [{ key: "all", conditions: "*", percentage: 100 }],
    };
    if (kind === "segment") {
      feature.conditions = "audience";
      write("segments", "audience", { conditions: "audience" });
    } else if (kind === "feature") {
      feature.conditions = { feature: "other" };
      write("features", "other", { ...feature, conditions: { feature: "root" } });
    } else if (kind === "feature-variable") {
      feature.variablesSchema = { copy: { type: "string", defaultValue: "Hello" } };
      feature.rules[0].conditions = { feature: "root", variable: "copy", operator: "exists" };
    } else if (kind === "composition") {
      write("variables", "a", { compose: "b" });
      write("variables", "b", { compose: { back: { variable: "a" } } });
    } else {
      feature.conditions = "audience";
      write("segments", "audience", { conditions: { variable: "a", operator: "notNull" } });
      write(
        "variables",
        "a",
        kind === "mixed"
          ? { type: "boolean", defaultValue: true, conditions: { feature: "root" } }
          : { compose: "b" },
      );
      if (kind === "mixed-composition")
        write("variables", "b", {
          type: "boolean",
          defaultValue: true,
          conditions: { feature: "root" },
        });
    }
    write("features", "root", feature);
    write("targets", "all", { description: "All", excludeFeatures: "*", excludeVariables: "*" });
    const projectConfig = getProjectConfig(root);
    return {
      projectConfig,
      datasource: new Datasource(projectConfig, root),
      rootDirectoryPath: root,
      options: {},
    };
  }

  it.each(cycleKinds)(
    "rejects %s cycles without lint before any build or state writes",
    async (kind) => {
      const deps = cyclicProject(kind);
      const state = { features: { saved: { traffic: [{ key: "stable", percentage: 50000 }] } } };
      const before = structuredClone(state);
      jest.spyOn(deps.datasource, "readState").mockResolvedValue(state);
      const writes = [
        jest.spyOn(deps.datasource, "writeDatafile"),
        jest.spyOn(deps.datasource, "writeState"),
        jest.spyOn(deps.datasource, "writeRevision"),
      ];
      const log = jest.spyOn(console, "log").mockImplementation(() => {});
      try {
        await expect(buildProject(deps)).rejects.toMatchObject({
          code: "circular_dependency",
        });
        writes.forEach((write) => expect(write).not.toHaveBeenCalled());
        expect(state).toEqual(before);
        expect(fs.existsSync(deps.projectConfig.datafilesDirectoryPath)).toBe(false);
        expect(fs.existsSync(deps.projectConfig.stateDirectoryPath)).toBe(false);
      } finally {
        log.mockRestore();
      }
    },
  );

  it("checks a supplied mixed graph without rereading its definitions", async () => {
    const deps = cyclicProject("mixed-composition");
    const graph = await buildDependencyGraph(deps.datasource);
    const expected =
      'feature "root" conditions -> segment "audience" conditions -> variable "a" compose -> variable "b" conditions -> feature "root"';
    const reads = [
      jest.spyOn(deps.datasource, "readFeature"),
      jest.spyOn(deps.datasource, "readVariable"),
      jest.spyOn(deps.datasource, "readSegment"),
    ];
    const state = { features: {} };
    await expect(
      buildDatafile(
        deps.projectConfig,
        deps.datasource,
        {
          environment: false,
          revision: "cycle",
          dependencyGraph: graph,
        },
        state,
      ),
    ).rejects.toThrow(expected);
    reads.forEach((read) => expect(read).not.toHaveBeenCalled());
    expect(state).toEqual({ features: {} });
    // Reversing graph insertion order must not change the selected cycle witness.
    await expect(
      buildDatafile(
        deps.projectConfig,
        deps.datasource,
        {
          environment: false,
          revision: "cycle",
          dependencyGraph: new Map([...graph].reverse()),
        },
        state,
      ),
    ).rejects.toMatchObject({
      cycle: [
        ["flag", "root"],
        ["segment", "audience"],
        ["variable", "a"],
        ["variable", "b"],
        ["flag", "root"],
      ],
    });
  });

  it.each([false, true])(
    "includes mixed segment dependencies despite Target exclusions, stringify=%s",
    async (stringify) => {
      write("features", "checkout", {
        description: "Checkout",
        tags: ["selected"],
        conditions: [
          "outer",
          { variable: "policy", path: "routing.enabled", operator: "equals", value: true },
        ],
        rules: [
          { key: "all", conditions: { or: [{ feature: "pricing" }, "inner"] }, percentage: 100 },
        ],
        force: [
          {
            conditions: { variable: "policy", path: "force.0", operator: "equals", value: true },
            enabled: true,
          },
        ],
      });
      write("features", "pricing", {
        description: "Pricing",
        tags: ["hidden"],
        rules: [{ key: "all", conditions: "*", percentage: 100 }],
      });
      write("segments", "outer", { conditions: ["inner", { feature: "pricing" }] });
      write("segments", "inner", {
        conditions: {
          variable: "policy",
          path: "routing.enabled",
          operator: "equals",
          value: true,
        },
      });
      write("variables", "policy", {
        description: "Policy",
        type: "object",
        tags: ["hidden"],
        defaultValue: { routing: { enabled: true }, force: [false] },
      });
      const config = { ...getProjectConfig(root), stringify };
      const datasource = new Datasource(config, root);
      const result = await buildDatafile(
        config,
        datasource,
        {
          revision: "conditions",
          environment: false,
          tag: "selected",
          excludeFeatures: ["pricing"],
          excludeVariables: "*",
        },
        { features: {} },
      );
      expect(result.schemaVersion).toBe("4");
      expect(Object.keys(result.features)).toEqual(["checkout", "pricing"]);
      expect(Object.keys(result.variables!)).toEqual(["policy"]);
      expect(Object.keys(result.segments).sort()).toEqual(["inner", "outer"]);
      const decode = (value: Conditions) =>
        stringify && typeof value === "string" && /^[\[{]/.test(value) ? JSON.parse(value) : value;
      expect(decode(result.features.checkout.conditions!)).toEqual([
        "outer",
        { variable: "policy", path: ["routing", "enabled"], operator: "equals", value: true },
      ]);
      expect(decode(result.features.checkout.force![0].conditions!)).toEqual({
        variable: "policy",
        path: ["force", 0],
        operator: "equals",
        value: true,
      });
      expect(decode(result.segments.inner.conditions)).toEqual({
        variable: "policy",
        path: ["routing", "enabled"],
        operator: "equals",
        value: true,
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('"requiredFeatures"');
      expect(serialized).not.toContain('"requiredVariables"');
      expect((serialized.match(/"segments":/g) || []).length).toBe(1);
      expect(
        createFeaturevisor({ datafile: result, logLevel: "fatal" }).isEnabled("checkout"),
      ).toBe(true);
    },
  );

  const gates = [false, true].flatMap((stringify) =>
    [false, true].flatMap((alias) =>
      [false, true].map((disabled) => ({ stringify, alias, disabled })),
    ),
  );
  it.each(gates)(
    "gates composition before source reads, stringify=$stringify alias=$alias disabledValue=$disabled",
    async ({ stringify, alias, disabled }) => {
      write("variables", "source", {
        description: "Source",
        type: "object",
        defaultValue: { limit: 50 },
        tags: ["hidden"],
      });
      write("variables", "guard", {
        description: "Guard",
        type: "object",
        defaultValue: { enabled: false },
        tags: ["hidden"],
      });
      const disabledValue = alias ? { limit: 0 } : { policy: { limit: 0 } };
      write("variables", "screen", {
        description: "Screen",
        tags: ["selected"],
        compose: alias ? "source" : { policy: { variable: "source" } },
        conditions: { variable: "guard", path: "enabled", operator: "equals", value: true },
        ...(disabled ? { disabledValue } : {}),
      });
      const config = { ...getProjectConfig(root), stringify };
      const result = await buildDatafile(
        config,
        new Datasource(config, root),
        { environment: false, revision: "gate", tag: "selected" },
        { features: {} },
      );
      expect(result.variables!.screen).not.toHaveProperty("defaultValue");
      if (disabled) expect(result.variables!.screen.disabledValue).toEqual(disabledValue);
      const raw = result.variables!.screen.conditions!;
      expect(stringify ? JSON.parse(raw as string) : raw).toEqual({
        variable: "guard",
        path: ["enabled"],
        operator: "equals",
        value: true,
      });
      const reads: string[] = [];
      const f = createFeaturevisor({
        datafile: result,
        logLevel: "fatal",
        modules: [
          {
            beforeEvaluation(options) {
              if (options.dependencyPurpose)
                reads.push(`${options.dependencyPurpose}:${options.variableKey}`);
              return options;
            },
          },
        ],
      });
      expect(f.getVariable("screen")).toEqual(disabled ? disabledValue : null);
      expect(reads).toEqual(["condition:guard"]);
      f.setStickyVariables({ guard: { enabled: true } });
      reads.length = 0;
      expect(f.getVariable("screen")).toEqual(alias ? { limit: 50 } : { policy: { limit: 50 } });
      expect(reads).toEqual(["condition:guard", "composition:source"]);
    },
  );
});

describe("mixed segment hashes", () => {
  it.each([false, true])(
    "propagates changes through every mixed reference, stringify=%s",
    (stringify) => {
      const conditions = (value: Conditions) =>
        stringify && typeof value !== "string" ? JSON.stringify(value) : value;
      const datafile: DatafileContent = {
        schemaVersion: "4",
        revision: "mixed",
        features: {
          checkout: { bucketBy: "id", conditions: conditions("outer"), traffic: [] },
          pricing: {
            bucketBy: "id",
            conditions: conditions({ variable: "source", operator: "exists" }),
            traffic: [],
          },
        },
        segments: {
          outer: { conditions: conditions(["inner"]) },
          inner: {
            conditions: conditions({
              feature: "pricing",
              variable: "currency",
              operator: "equals",
              value: "EUR",
            }),
          },
        },
        variables: {
          source: { type: "boolean", defaultValue: true },
          consumer: { type: "string", defaultValue: "Hello", conditions: conditions("outer") },
        },
      };
      refreshDatafileHashes(datafile);
      const before = {
        feature: datafile.features.checkout.hash,
        variable: datafile.variables!.consumer.hash,
        segments: getSegmentHashes(datafile.segments, datafile.features, datafile.variables),
      };
      datafile.variables!.source.defaultValue = false;
      refreshDatafileHashes(datafile);
      expect(datafile.features.checkout.hash).not.toBe(before.feature);
      expect(datafile.variables!.consumer.hash).not.toBe(before.variable);
      const after = getSegmentHashes(datafile.segments, datafile.features, datafile.variables);
      expect(after.outer).not.toBe(before.segments.outer);
      expect(after.inner).not.toBe(before.segments.inner);
    },
  );
});
