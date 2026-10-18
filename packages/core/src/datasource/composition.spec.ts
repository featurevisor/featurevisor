import type { ParsedVariable } from "@featurevisor/types";
import { getCompositionEntries } from "./composition";
import {
  buildDependencyGraph,
  collectDependencyClosure,
  findDependencyCycles,
  findUnavailableCompositionDependency,
  readableDependencyChain,
  variableNode,
} from "./dependencies";

describe("composition sources", () => {
  it("normalizes exact source keys without a synthetic wrapper property", () => {
    expect(getCompositionEntries({ compose: "config/source.literal:label" })).toEqual([
      [undefined, { variable: "config/source.literal:label" }],
    ]);
    expect(getCompositionEntries({ compose: { literal: { variable: "source" } } })).toEqual([
      ["literal", { variable: "source" }],
    ]);
  });
  it.each([undefined, "", null, [], 42])(
    "ignores malformed input %j during graph collection",
    (compose) => {
      expect(getCompositionEntries({ compose } as ParsedVariable)).toEqual([]);
    },
  );
  it("retains alias, map and override dependencies in the same closure", async () => {
    const definitions: Record<string, ParsedVariable> = {
      root: {
        compose: "nested",
        overrides: [
          {
            key: "guard",
            conditions: [{ variable: "guard", operator: "exists" }],
            value: null,
          },
        ],
      },
      nested: { compose: { value: { variable: "config/source.literal" } } },
      "config/source.literal": { type: "boolean", defaultValue: false },
      guard: { type: "string", defaultValue: "yes" },
    };
    const datasource = {
      listVariables: async () => Object.keys(definitions),
      readVariable: async (key: string) => definitions[key],
      readFeature: jest.fn(),
    };
    const graph = await buildDependencyGraph(datasource);
    const closure = await collectDependencyClosure(datasource, [variableNode("root")], { graph });
    expect([...closure.variables].sort()).toEqual([
      "config/source.literal",
      "guard",
      "nested",
      "root",
    ]);
    const unavailable = findUnavailableCompositionDependency(
      graph,
      [variableNode("root")],
      (node) => (node[1] === "config/source.literal" ? "missing" : undefined),
    )!;
    expect(unavailable.alias).toBeUndefined();
    expect(readableDependencyChain(graph, unavailable.nodes)).toBe(
      'variable "root" compose -> variable "nested" compose property "value" -> variable "config/source.literal"',
    );
  });
  it.each(["self", "alias", "map", "requirement", "override"])(
    "reports %s cycles at compose, without a synthetic alias",
    async (kind) => {
      const definitions: Record<string, ParsedVariable> = {
        alpha: { compose: kind === "self" ? "alpha" : "beta" },
        beta:
          kind === "alias"
            ? { compose: "alpha" }
            : kind === "map"
              ? { compose: { back: { variable: "alpha" } } }
              : {
                  type: "boolean",
                  defaultValue: true,
                  ...(kind === "requirement"
                    ? { conditions: { variable: "alpha", operator: "exists" } }
                    : {
                        overrides: [
                          {
                            key: "cycle",
                            conditions: [{ variable: "alpha", operator: "exists" }],
                            value: false,
                          },
                        ],
                      }),
                },
      };
      const issues = await findDependencyCycles({
        listVariables: async () => Object.keys(definitions),
        readVariable: async (key) => definitions[key],
        readFeature: jest.fn(),
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toEqual(["compose"]);
      expect(issues[0].message).toContain('variable "alpha" compose -> variable');
      expect(issues[0].message).not.toContain("compose[0]");
    },
  );
});
