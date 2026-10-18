import type { Conditions, ParsedFeature, ParsedVariable, Segment } from "@featurevisor/types";
import {
  buildDependencyGraph,
  featureFlagNode,
  findDependencyCycles,
  segmentNode,
  validateDependencies,
  variableNode,
} from "../datasource/dependencies";

function createDatasource(
  features: Record<string, { conditions?: Conditions }>,
  variables: Record<string, ParsedVariable> = {},
  segments: Record<string, Segment> = {},
) {
  return {
    listFeatures: async () => Object.keys(features),
    listVariables: async () => Object.keys(variables),
    listSegments: async () => Object.keys(segments),
    readFeature: jest.fn(async (key: string) => features[key] as ParsedFeature),
    readVariable: async (key: string) => variables[key],
    readSegment: async (key: string) => segments[key],
  };
}

describe("shared condition dependency graph validation", () => {
  it("reports the exact cycle without unrelated sibling branches", async () => {
    const datasource = createDatasource({
      checkout: { conditions: [{ feature: "pricing" }, { feature: "shipping" }] },
      pricing: {},
      shipping: { conditions: [{ feature: "checkout" }] },
    });
    const cycles = await findDependencyCycles(datasource);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toEqual([
      ["flag", "checkout"],
      ["flag", "shipping"],
      ["flag", "checkout"],
    ]);
    expect(cycles[0].message).toBe(
      'circular dependency found: feature "checkout" conditions[1] -> feature "shipping" conditions[0] -> feature "checkout"',
    );
    expect(cycles[0].message).not.toContain("pricing");
  });

  it("reports a nested cycle that does not return to the starting feature", async () => {
    const datasource = createDatasource({
      checkout: { conditions: [{ feature: "pricing" }] },
      pricing: { conditions: [{ feature: "shipping" }] },
      shipping: { conditions: [{ feature: "pricing" }] },
    });
    const cycles = await findDependencyCycles(datasource);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toEqual([
      ["flag", "pricing"],
      ["flag", "shipping"],
      ["flag", "pricing"],
    ]);
    expect(cycles[0].message).not.toContain("checkout");
    await expect(validateDependencies(datasource)).rejects.toThrow(cycles[0].message);
  });

  it("allows shared dependencies and reads each definition only once", async () => {
    const datasource = createDatasource({
      checkout: { conditions: [{ feature: "pricing" }, { feature: "shipping" }] },
      pricing: { conditions: [{ feature: "currency" }] },
      shipping: { conditions: [{ feature: "currency" }] },
      currency: {},
    });
    const graph = await buildDependencyGraph(datasource);
    expect(await findDependencyCycles(datasource, graph)).toEqual([]);
    expect(graph.get(featureFlagNode("pricing"))).toEqual(new Set([featureFlagNode("currency")]));
    expect(graph.get(featureFlagNode("shipping"))).toEqual(new Set([featureFlagNode("currency")]));
    expect(datasource.readFeature.mock.calls.filter(([key]) => key === "currency")).toHaveLength(1);
  });

  it("visits every mixed OR and NOT branch without changing the expression", async () => {
    const expression: Conditions = {
      or: [
        { feature: "a" },
        { not: [{ feature: "b" }, "audience", { variable: "policy", operator: "exists" }] },
      ],
    };
    const snapshot = JSON.stringify(expression);
    const datasource = createDatasource(
      { root: { conditions: expression }, a: {}, b: {} },
      { policy: { description: "Policy", type: "boolean", defaultValue: true } },
      { audience: { description: "Audience", conditions: "*" } },
    );
    const graph = await buildDependencyGraph(datasource);
    expect(graph.get(featureFlagNode("root"))).toEqual(
      new Set([
        featureFlagNode("a"),
        featureFlagNode("b"),
        segmentNode("audience"),
        variableNode("policy"),
      ]),
    );
    expect(await findDependencyCycles(datasource, graph)).toEqual([]);
    expect(JSON.stringify(expression)).toBe(snapshot);
  });

  it("rejects a cycle hidden in OR and NOT branches", async () => {
    const datasource = createDatasource({
      root: { conditions: { or: [{ feature: "a" }, { feature: "b" }] } },
      a: { conditions: { not: [{ feature: "root" }] } },
      b: {},
    });
    const cycles = await findDependencyCycles(datasource);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toEqual([
      ["flag", "a"],
      ["flag", "root"],
      ["flag", "a"],
    ]);
    expect(cycles[0].message).toContain("conditions.not[0]");
    expect(cycles[0].message).toContain("conditions.or[0]");
    expect(cycles[0].message).not.toContain('feature "b"');
  });
});
