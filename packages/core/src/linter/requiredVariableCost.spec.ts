import { estimateDependencyExpansion } from "./requiredVariableCost";

describe("dependency expansion advisory", () => {
  it("counts shared diamond edges once and does not warn for cheap cycles", () => {
    const graph = new Map<string, Set<string>>();
    for (let i = 0; i < 18; i++) {
      graph.set(`a${i}`, new Set([`a${i + 1}`, `b${i + 1}`]));
      graph.set(`b${i}`, new Set([`a${i + 1}`, `b${i + 1}`]));
    }
    expect(estimateDependencyExpansion(graph)).toEqual([]);
    expect(estimateDependencyExpansion(new Map([["a", new Set(["a"])]]))).toEqual([]);
  });

  it("warns once per connected cluster only above 1000 reachable edges", () => {
    const graph = new Map<string, Set<string>>();
    for (let i = 0; i < 1001; i++) graph.set(`n${i}`, new Set([`n${i + 1}`]));
    graph.set("other", new Set(["n500"]));
    graph.set("isolated", new Set());
    expect(estimateDependencyExpansion(graph)).toEqual([{ root: "n0", cost: 1001 }]);
    expect(estimateDependencyExpansion(graph, 1001)).toEqual([]);
  });

  it("includes segment and mixed condition edges in the shared graph estimate", () => {
    const flag = JSON.stringify(["feature", "checkout"]);
    const segment = JSON.stringify(["segment", "audience"]);
    const source = JSON.stringify(["variable", "policy"]);
    const dependency = JSON.stringify(["feature", "source"]);
    const graph = new Map([
      [flag, new Set([segment])],
      [segment, new Set([source, dependency])],
      [source, new Set([dependency])],
    ]);
    expect(estimateDependencyExpansion(graph, 3)).toEqual([{ root: flag, cost: 4 }]);
    expect(estimateDependencyExpansion(graph, 4)).toEqual([]);
  });
});
