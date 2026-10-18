import {
  featureFlagNode,
  featureVariableNode,
  segmentNode,
  variableNode,
} from "../datasource/dependencies";
import { describeDependencyChain, findDeepDependencyChains } from "./dependencyDepth";

function graphOf(edges: Array<[string, string[]]>): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const [node, dependencies] of edges) {
    graph.set(node, new Set(dependencies));
    for (const dependency of dependencies)
      if (!graph.has(dependency)) graph.set(dependency, new Set());
  }
  return graph;
}

function featureChain(length: number): Map<string, Set<string>> {
  return graphOf(
    Array.from({ length }, (_, index) => [
      featureFlagNode(`f${index}`),
      index === 0 ? [] : [featureFlagNode(`f${index - 1}`)],
    ]),
  );
}

describe("findDeepDependencyChains", () => {
  test("counts handoffs between getters and reports only the outermost entity", () => {
    const chains = findDeepDependencyChains(featureChain(10), 5);
    expect(chains).toHaveLength(1);
    expect(chains[0].root).toBe(featureFlagNode("f9"));
    expect(chains[0].handoffs).toBe(9);
    expect(chains[0].nodes).toHaveLength(10);
    expect(findDeepDependencyChains(featureChain(10), 9)).toEqual([]);
  });

  test("terminal segments open no frame, segments with references do", () => {
    const graph = graphOf([
      [featureFlagNode("a"), [segmentNode("outer")]],
      [segmentNode("outer"), [segmentNode("inner")]],
      [segmentNode("inner"), []],
    ]);
    expect(findDeepDependencyChains(graph, 0)[0].handoffs).toBe(1);
  });

  test("a feature variable reads its own flag in the same frame", () => {
    const graph = graphOf([
      [featureVariableNode("a", "title"), [featureFlagNode("a")]],
      [featureFlagNode("a"), [featureFlagNode("b")]],
      [featureFlagNode("b"), []],
      [variableNode("global"), [featureVariableNode("a", "title")]],
    ]);
    const [chain] = findDeepDependencyChains(graph, 0);
    expect(chain.root).toBe(variableNode("global"));
    expect(chain.handoffs).toBe(2);
  });

  test("matches the SDK boundary of 256 handoffs", () => {
    // f0 to f256 needs 256 handoffs, which every SDK evaluates on its main thread.
    expect(findDeepDependencyChains(featureChain(257), 256)).toEqual([]);
    const [chain] = findDeepDependencyChains(featureChain(258), 256);
    expect(chain.handoffs).toBe(257);
  });

  test("handles chains longer than the JavaScript stack would allow recursively", () => {
    const [chain] = findDeepDependencyChains(featureChain(20000), 255);
    expect(chain.handoffs).toBe(19999);
  });

  test("abbreviates long chains", () => {
    const [chain] = findDeepDependencyChains(featureChain(10), 0);
    expect(describeDependencyChain(chain.nodes)).toBe(
      'feature "f9" -> feature "f8" -> feature "f7" -> feature "f6" -> … -> feature "f1" -> feature "f0"',
    );
  });
});
