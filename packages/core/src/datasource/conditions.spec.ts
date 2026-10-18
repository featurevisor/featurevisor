import type { Conditions } from "@featurevisor/types";
import {
  combineConditions,
  compileConditions,
  getConditionReferences,
  walkConditionLeaves,
} from "./conditions";
import {
  buildDependencyGraph,
  collectDependencyClosure,
  featureFlagNode,
  findDependencyCycles,
  segmentNode,
  variableNode,
} from "./dependencies";

describe("unified condition utilities", () => {
  const conditions: Conditions = [
    "audience",
    { attribute: "country", operator: "equals", value: "nl" },
    {
      or: [
        { feature: "checkout" },
        { not: [{ variable: "policy", path: "items.0.enabled", operator: "equals", value: true }] },
      ],
    },
    { feature: "pricing", variable: "currency", path: ["01", 2], operator: "exists" },
  ];
  it.each([false, true])(
    "compiles paths and authored order without mutating input, stringify=%s",
    (stringify) => {
      const before = structuredClone(conditions);
      const compiled = compileConditions(conditions, stringify)!;
      const decoded = stringify ? JSON.parse(compiled as string) : compiled;
      expect(decoded).toEqual([
        "audience",
        { attribute: "country", operator: "equals", value: "nl" },
        {
          or: [
            { feature: "checkout" },
            {
              not: [
                {
                  variable: "policy",
                  path: ["items", 0, "enabled"],
                  operator: "equals",
                  value: true,
                },
              ],
            },
          ],
        },
        { feature: "pricing", variable: "currency", path: ["01", 2], operator: "exists" },
      ]);
      expect(conditions).toEqual(before);
      expect(compileConditions("audience", stringify)).toBe("audience");
      expect(compileConditions("*", stringify)).toBe("*");
      expect(compileConditions(undefined, stringify)).toBeUndefined();
    },
  );
  it("walks every leaf and reports exact ordered locations", () => {
    const paths: (string | number)[][] = [];
    walkConditionLeaves(conditions, (_leaf, path) => paths.push(path));
    expect(paths).toEqual([[0], [1], [2, "or", 0], [2, "or", 1, "not", 0], [3]]);
  });
  it.each([conditions, JSON.stringify(conditions)])(
    "collects all reference kinds from %j",
    (value) => {
      const references = getConditionReferences(value);
      expect([...references.segments]).toEqual(["audience"]);
      expect([...references.features]).toEqual(["checkout", "pricing"]);
      expect([...references.variables]).toEqual(["policy"]);
      expect(references.featureVariables).toEqual([{ feature: "pricing", variable: "currency" }]);
      expect([...references.attributes]).toEqual(["country"]);
      expect(getConditionReferences("*").segments.size).toBe(0);
    },
  );
  it("ANDs ancestors before descendants without inserting nested wildcards", () => {
    expect(combineConditions("*", { feature: "child" })).toEqual({ feature: "child" });
    expect(combineConditions({ feature: "parent" }, "*")).toEqual({ feature: "parent" });
    expect(combineConditions(["parent"], { not: ["child"] })).toEqual([
      "parent",
      { not: ["child"] },
    ]);
  });
});

describe("mixed condition dependency graph", () => {
  it("collects every OR and NOT branch without changing authoring", async () => {
    const expression = { or: [{ feature: "a" }, { not: [{ feature: "b" }] }] };
    const features: Record<string, any> = { root: { conditions: expression }, a: {}, b: {} };
    const datasource = {
      listFeatures: async () => Object.keys(features),
      readFeature: async (key: string) => features[key],
      readVariable: jest.fn(),
    };
    const result = await collectDependencyClosure(datasource, [featureFlagNode("root")]);
    expect([...result.features]).toEqual(["root", "a", "b"]);
    expect(expression).toEqual({ or: [{ feature: "a" }, { not: [{ feature: "b" }] }] });
  });
  it.each(["or", "not"] as const)(
    "rejects feature cycles hidden under %s without changing the expression",
    async (group) => {
      const expression =
        group === "or"
          ? { or: [{ feature: "source" }, { feature: "other" }] }
          : { not: [{ feature: "source" }] };
      const before = structuredClone(expression);
      const features: Record<string, any> = {
        root: { conditions: expression },
        source: { conditions: { not: [{ feature: "root" }] } },
        other: {},
      };
      const issues = await findDependencyCycles({
        listFeatures: async () => Object.keys(features),
        readFeature: async (key) => features[key],
        readVariable: jest.fn(),
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].cycle).toEqual([
        ["flag", "root"],
        ["flag", "source"],
        ["flag", "root"],
      ]);
      expect(issues[0].path).toEqual(["conditions", group, 0]);
      expect(expression).toEqual(before);
      expect([...getConditionReferences(expression).features]).toEqual(
        group === "or" ? ["source", "other"] : ["source"],
      );
    },
  );
  function datasource(reverse = false) {
    const features: Record<string, any> = {
      checkout: { variablesSchema: { copy: {} }, rules: { production: [{ conditions: "beta" }] } },
      pricing: { conditions: { variable: "policy", operator: "exists" } },
    };
    const segments: Record<string, any> = {
      beta: { conditions: ["region", { feature: "pricing" }] },
      region: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
    };
    const variables: Record<string, any> = {
      policy: { compose: "source" },
      source: { defaultValue: true },
    };
    const keys = (value: object) => (reverse ? Object.keys(value).reverse() : Object.keys(value));
    return {
      features,
      segments,
      variables,
      listFeatures: async () => keys(features),
      listSegments: async () => keys(segments),
      listVariables: async () => keys(variables),
      readFeature: async (key: string) => features[key],
      readSegment: async (key: string) => segments[key],
      readVariable: async (key: string) => variables[key],
    };
  }
  it("closes through nested segments, feature gates and compositions", async () => {
    const ds = datasource();
    const closure = await collectDependencyClosure(ds, [featureFlagNode("checkout")]);
    expect([...closure.features]).toEqual(["checkout", "pricing"]);
    expect([...closure.segments]).toEqual(["beta", "region"]);
    expect([...closure.variables]).toEqual(["policy", "source"]);
  });
  it("reports deterministic mixed cycle chains with rule and segment locations", async () => {
    const run = async (reverse: boolean) => {
      const ds = datasource(reverse);
      ds.variables.source.conditions = { feature: "checkout" };
      ds.segments.region.conditions = "region";
      return findDependencyCycles(ds);
    };
    const issues = await run(false);
    expect(issues).toHaveLength(2);
    expect(issues[0].path).toEqual(["rules", "production", 0, "conditions"]);
    expect(issues[0].message).toContain(
      'feature "checkout" rules.production[0].conditions -> segment "beta" conditions[1] -> feature "pricing" conditions -> variable "policy" compose -> variable "source" conditions -> feature "checkout"',
    );
    expect(issues[1].origin).toEqual(["segment", "region"]);
    expect((await run(true)).map((issue) => issue.message)).toEqual(
      issues.map((issue) => issue.message),
    );
  });
  it.each(["rules", "force"])("rejects self references in %s", async (field) => {
    const ds = datasource();
    ds.features.checkout[field] = [
      { conditions: { feature: "checkout", variable: "copy", operator: "exists" } },
    ];
    const issues = await findDependencyCycles(ds);
    expect(issues.some((issue) => issue.cycle.some((node) => node[0] === "feature-variable"))).toBe(
      true,
    );
  });
  it("retains graph identities and promotable override filtering", async () => {
    const ds = datasource();
    ds.variables.source.overrides = [{ promotable: false, conditions: "beta" }];
    const graph = await buildDependencyGraph(ds, {
      includeOverride: (entry) => entry.promotable !== false,
    });
    expect(graph.get(variableNode("source"))).toEqual(new Set());
    expect(graph.get(segmentNode("beta"))).toEqual(
      new Set([segmentNode("region"), featureFlagNode("pricing")]),
    );
  });

  it("locates a gate before a composition that references the same source", async () => {
    const ds = datasource();
    ds.variables.policy.conditions = { variable: "source", operator: "exists" };
    ds.variables.source.conditions = { variable: "policy", operator: "exists" };
    const issues = await findDependencyCycles(ds);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["conditions"]);
    expect(issues[0].message).toContain(
      'variable "policy" conditions -> variable "source" conditions -> variable "policy"',
    );
    expect(issues[0].message).not.toContain(" compose");
  });
});
