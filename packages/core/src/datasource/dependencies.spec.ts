import {
  buildDependencyGraph,
  collectDependencyClosure,
  featureFlagNode,
  featureVariableNode,
  variableNode,
  isDependencyCycleError,
  findUnavailableCompositionDependency,
  findDependencyCycles,
  validateDependencies,
  DependencyCycleError,
} from "./dependencies";
import type { DependencyEvaluationNode } from "./dependencies";
import { compileConditions, getConditionReferences } from "./conditions";

describe("dependencies", () => {
  it.each<{ node: DependencyEvaluationNode }>([
    { node: ["flag", "checkout"] },
    { node: ["feature-variable", "checkout", "title"] },
    { node: ["variable", "policy"] },
    { node: ["segment", "audience"] },
  ])("uses generic cycle diagnostics for $node", ({ node }) => {
    const error = new DependencyCycleError(node, [node, node]);
    expect(error).toBeInstanceOf(Error);
    expect(isDependencyCycleError(error)).toBe(true);
    expect(isDependencyCycleError(new Error("unrelated"))).toBe(false);
    expect(error.code).toBe("circular_dependency");
    expect(error.name).toBe("DependencyCycleError");
    expect(error.message).toMatch(/^circular dependency found: .+ -> .+$/);
    expect(error.message).not.toContain("circular variable dependency");
  });
  it("collects disconnected cycles, overlapping back edges and self references deterministically", async () => {
    const definitions: Record<string, any> = {
      alpha: { compose: { first: { variable: "beta" }, self: { variable: "alpha" } } },
      beta: { compose: { back: { variable: "alpha" }, next: { variable: "gamma" } } },
      gamma: { conditions: { variable: "alpha", operator: "exists" } },
      other: { conditions: { variable: "other", operator: "isNull" } },
      tail: { compose: { link: { variable: "alpha" } } },
    };
    const run = (keys: string[]) =>
      findDependencyCycles({
        listVariables: async () => keys,
        readFeature: jest.fn(),
        readVariable: async (key) => definitions[key],
      });
    const result = await run(Object.keys(definitions));
    expect(result.map((issue) => issue.cycle)).toEqual([
      [
        ["variable", "alpha"],
        ["variable", "alpha"],
      ],
      [
        ["variable", "alpha"],
        ["variable", "beta"],
        ["variable", "alpha"],
      ],
      [
        ["variable", "alpha"],
        ["variable", "beta"],
        ["variable", "gamma"],
        ["variable", "alpha"],
      ],
      [
        ["variable", "other"],
        ["variable", "other"],
      ],
    ]);
    expect(result.map((issue) => issue.path)).toEqual([
      ["compose", "self"],
      ["compose", "first"],
      ["compose", "first"],
      ["conditions"],
    ]);
    expect((await run(Object.keys(definitions).reverse())).map((issue) => issue.message)).toEqual(
      result.map((issue) => issue.message),
    );
    expect(new Set(result.map((issue) => issue.message)).size).toBe(result.length);
    expect(result[1].message).toContain('compose property "first"');
    for (const issue of result) {
      expect(issue.message).not.toContain('["variable",');
      expect(issue.message).not.toContain("Dependency chain:");
    }
  });
  it("reuses a supplied acyclic graph without rereading definitions", async () => {
    const datasource = { readFeature: jest.fn(), readVariable: jest.fn() };
    expect(
      await findDependencyCycles(datasource, new Map([[variableNode("source"), new Set()]])),
    ).toEqual([]);
    expect(datasource.readVariable).not.toHaveBeenCalled();
    expect(datasource.readFeature).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "locates a composed override cycle at the authored path with environments=%s",
    async (withEnvironments) => {
      const requirement = { variable: "self", operator: "isNull" };
      const overrides = [
        {
          key: "parent",
          conditions: "*",
          mutate: { source: false },
          overrides: [{ key: "cycle", conditions: requirement, mutate: { source: true } }],
        },
      ];
      const definitions = {
        self: {
          compose: { source: { variable: "source" } },
          overrides: withEnvironments ? { production: overrides } : overrides,
        },
        source: { type: "boolean", defaultValue: true },
      };
      await expect(
        validateDependencies({
          listVariables: async () => ["self", "source"],
          readFeature: jest.fn(),
          readVariable: async (key) => definitions[key] as any,
        }),
      ).rejects.toMatchObject({
        path: [
          "overrides",
          ...(withEnvironments ? ["production"] : []),
          0,
          "overrides",
          0,
          "conditions",
        ],
      });
    },
  );
  it.each<{ compose: unknown }>([
    { compose: [{ variable: "self" }] },
    { compose: { "": { variable: "self" } } },
    { compose: { constructor: { variable: "self" } } },
  ])(
    "ignores invalid composition maps and properties %j during graph validation",
    async ({ compose }) => {
      await expect(
        validateDependencies({
          listVariables: async () => ["self"],
          readVariable: async () => ({ compose }) as any,
          readFeature: jest.fn(),
        }),
      ).resolves.toBeUndefined();
    },
  );
  it("walks a deep shared composition graph once without reading definitions again", async () => {
    const graph = new Map<string, Set<string>>();
    const depth = 12000;
    for (let index = 0; index < depth; index++) {
      graph.set(
        variableNode(String(index)),
        new Set(index + 1 < depth ? [variableNode(String(index + 1))] : []),
      );
    }
    const unavailable = jest.fn(() => undefined);
    expect(
      findUnavailableCompositionDependency(graph, [...graph.keys()], unavailable),
    ).toBeUndefined();
    expect(unavailable).toHaveBeenCalledTimes(depth);
    const datasource = { readFeature: jest.fn(), readVariable: jest.fn() };
    const closure = await collectDependencyClosure(datasource, [...graph.keys()], {
      graph,
    });
    expect(closure.variables.size).toBe(depth);
    expect(datasource.readVariable).not.toHaveBeenCalled();
    await expect(
      validateDependencies({
        ...datasource,
        listVariables: async () => Array.from({ length: depth }, (_, index) => String(index)),
        readVariable: async (key) => ({
          description: key,
          compose:
            Number(key) + 1 < depth
              ? { next: { variable: String(Number(key) + 1) } }
              : { leaf: { feature: "leaf" } },
        }),
      }),
    ).resolves.toBeUndefined();
  });
  it.each([
    { variable: "self", variation: true },
    { variable: "self", unknown: true },
    { feature: "checkout", variable: "self", variation: true },
  ])("does not invent graph edges for malformed composition references %j", async (reference) => {
    const graph = await buildDependencyGraph({
      listVariables: async () => ["self"],
      readVariable: async () => ({ compose: { bad: reference } }) as any,
      readFeature: jest.fn(),
    });
    expect(graph.get(variableNode("self"))).toEqual(new Set());
  });
  it("labels mixed composition cycles with literal properties while retaining node identities", async () => {
    const datasource: any = {
      listFeatures: async () => ["checkout"],
      listVariables: async () => ["screen"],
      readFeature: async () => ({ conditions: { variable: "screen", operator: "exists" } }),
      readVariable: async () => ({ compose: { "flag/property": { feature: "checkout" } } }),
    };
    await expect(validateDependencies(datasource)).rejects.toThrow(
      'feature "checkout" conditions -> variable "screen" compose property "flag/property" -> feature "checkout"',
    );
  });
  it("distinguishes string aliases from literal map properties in one cycle", async () => {
    const definitions = {
      alias: { compose: "map" },
      map: { compose: { "policy/eu.current": { variable: "alias" } } },
    };
    const cycles = await findDependencyCycles({
      listVariables: async () => Object.keys(definitions),
      readFeature: jest.fn(),
      readVariable: async (key) => definitions[key] as any,
    });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].path).toEqual(["compose"]);
    expect(cycles[0].message).toContain(
      'variable "alias" compose -> variable "map" compose property "policy/eu.current" -> variable "alias"',
    );
  });
  it("compiles outer arrays and paths while preserving boolean groups", () => {
    const input: any = [
      { variable: "settings", path: "items.0.name", operator: "equals", value: "A" },
      { or: [{ variable: "mode", path: ["01", 2], operator: "notEquals", value: "off" }] },
    ];
    expect(compileConditions(input)).toEqual([
      { variable: "settings", path: ["items", 0, "name"], operator: "equals", value: "A" },
      { or: [{ variable: "mode", path: ["01", 2], operator: "notEquals", value: "off" }] },
    ]);
    expect([...getConditionReferences(input).variables]).toEqual(["settings", "mode"]);
  });

  it("builds evaluation granular mixed closures without conflating feature variables", async () => {
    const datasource: any = {
      listFeatures: async () => ["checkout"],
      listVariables: async () => ["region"],
      readFeature: async () => ({
        variablesSchema: { currency: {}, message: {} },
        conditions: { variable: "region", operator: "equals", value: "eu" },
        rules: [
          {
            conditions: "*",
            variableOverrides: {
              message: [
                {
                  conditions: {
                    feature: "checkout",
                    variable: "currency",
                    operator: "equals",
                    value: "EUR",
                  },
                  value: "hi",
                },
              ],
            },
          },
        ],
      }),
      readVariable: async () => ({ defaultValue: "eu" }),
    };
    const graph = await buildDependencyGraph(datasource);
    expect(graph.get(featureVariableNode("checkout", "currency"))).toEqual(
      new Set([featureFlagNode("checkout")]),
    );
    expect(graph.get(featureVariableNode("checkout", "message"))).toEqual(
      new Set([featureFlagNode("checkout"), featureVariableNode("checkout", "currency")]),
    );
    const closure = await collectDependencyClosure(datasource, [featureFlagNode("checkout")]);
    expect(closure.features).toEqual(new Set(["checkout"]));
    expect(closure.variables).toEqual(new Set(["region"]));
    await expect(validateDependencies(datasource)).resolves.toBeUndefined();
  });

  it("rejects genuine mixed cycles through the implicit feature flag evaluation", async () => {
    const datasource: any = {
      listFeatures: async () => ["checkout"],
      listVariables: async () => [],
      readFeature: async () => ({
        variablesSchema: { currency: {} },
        conditions: {
          feature: "checkout",
          variable: "currency",
          operator: "equals",
          value: "EUR",
        },
      }),
    };
    await expect(validateDependencies(datasource)).rejects.toThrow(
      'feature "checkout" conditions -> feature "checkout" variable "currency" -> feature "checkout"',
    );
  });

  it("keeps namespaced feature and variable identities distinct", () => {
    expect(featureVariableNode("variablePolicySource", "config.policy")).not.toBe(
      featureVariableNode("variablePolicySource.config", "policy"),
    );
    expect(variableNode("config.policy")).not.toBe(featureVariableNode("config", "policy"));
  });

  it("detects mixed feature and variable dependency cycles", async () => {
    const datasource: any = {
      listFeatures: async () => ["checkout"],
      listVariables: async () => ["gate"],
      readFeature: async () => ({
        variablesSchema: {},
        conditions: { variable: "gate", operator: "equals", value: true },
      }),
      readVariable: async () => ({ defaultValue: true, conditions: { feature: "checkout" } }),
    };
    try {
      await validateDependencies(datasource);
      throw new Error("expected dependency validation to fail");
    } catch (error) {
      expect(isDependencyCycleError(error)).toBe(true);
      if (!isDependencyCycleError(error)) throw error;
      expect(error.origin).toEqual(["flag", "checkout"]);
      expect(error.cycle).toEqual([
        ["flag", "checkout"],
        ["variable", "gate"],
        ["flag", "checkout"],
      ]);
      expect(error.message).toContain(
        'feature "checkout" conditions -> variable "gate" conditions -> feature "checkout"',
      );
    }
  });
});
