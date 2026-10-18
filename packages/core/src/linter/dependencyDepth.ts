import { readableDependencyNode } from "../datasource/dependencies";

/** SDKs fail an evaluation needing more internal handoffs than this, and evaluate this many. */
export const DEPENDENCY_HANDOFF_LIMIT = 256;

/**
 * Release builds of every SDK evaluate this many handoffs on a 512 KB thread. Debug
 * builds and smaller host stacks can fail sooner, so this is advice, not a guarantee.
 */
export const PORTABLE_DEPENDENCY_HANDOFFS = 32;

export interface DependencyDepth {
  root: string;
  handoffs: number;
  nodes: string[];
}

/**
 * Longest runtime dependency chain from each getter, counted as SDK sessions count it.
 * Feature, feature variable and global variable getters and non terminal segments
 * each open a frame. A feature variable reads its own flag inside the same frame,
 * and a segment with only attribute or wildcard leaves does not open one.
 * The graph must be acyclic. Only the outermost entity of each deep chain is
 * returned, so one long chain produces one report.
 */
// Graphs are not changed after they are built, and every Target build checks the same one.
const results = new WeakMap<Map<string, Set<string>>, Map<number, DependencyDepth[]>>();

export function findDeepDependencyChains(
  graph: Map<string, Set<string>>,
  threshold: number,
): DependencyDepth[] {
  let byThreshold = results.get(graph);
  if (!byThreshold) results.set(graph, (byThreshold = new Map()));
  let result = byThreshold.get(threshold);
  if (!result) byThreshold.set(threshold, (result = computeDeepDependencyChains(graph, threshold)));
  return result;
}

function computeDeepDependencyChains(
  graph: Map<string, Set<string>>,
  threshold: number,
): DependencyDepth[] {
  const parsed = new Map<string, string[]>();
  const parse = (node: string) => {
    let tuple = parsed.get(node);
    if (!tuple) {
      tuple = JSON.parse(node) as string[];
      parsed.set(node, tuple);
    }
    return tuple;
  };
  const weight = (node: string) =>
    parse(node)[0] === "segment" && !(graph.get(node)?.size || 0) ? 0 : 1;
  const sameFrame = (node: string, dependency: string) => {
    const tuple = parse(node);
    return tuple[0] === "feature-variable" && dependency === JSON.stringify(["flag", tuple[1]]);
  };

  // Iterative post order keeps very long chains away from the JavaScript stack.
  const longest = new Map<string, { length: number; next?: string }>();
  for (const start of graph.keys()) {
    if (longest.has(start)) continue;
    const pending: Array<{ node: string; expanded: boolean }> = [{ node: start, expanded: false }];
    while (pending.length) {
      const frame = pending[pending.length - 1];
      if (longest.has(frame.node)) {
        pending.pop();
        continue;
      }
      const dependencies = [...(graph.get(frame.node) || [])].sort();
      if (!frame.expanded) {
        frame.expanded = true;
        for (const dependency of dependencies)
          if (!longest.has(dependency)) pending.push({ node: dependency, expanded: false });
        continue;
      }
      let best: { length: number; next?: string } = { length: weight(frame.node) };
      for (const dependency of dependencies) {
        const child = longest.get(dependency);
        if (!child) continue;
        const length =
          weight(frame.node) + child.length - (sameFrame(frame.node, dependency) ? 1 : 0);
        if (length > best.length) best = { length, next: dependency };
      }
      longest.set(frame.node, best);
      pending.pop();
    }
  }

  const handoffs = (node: string) => Math.max(0, (longest.get(node)?.length || 0) - 1);
  const isGetter = (node: string) => parse(node)[0] !== "segment";
  const deep = new Set(
    [...graph.keys()].filter((node) => isGetter(node) && handoffs(node) > threshold),
  );
  const coveredByDependent = new Set<string>();
  for (const node of deep) {
    for (const dependency of graph.get(node) || []) {
      if (deep.has(dependency)) coveredByDependent.add(dependency);
    }
  }

  return [...deep]
    .filter((node) => !coveredByDependent.has(node))
    .sort()
    .map((root) => {
      const nodes = [root];
      for (let next = longest.get(root)?.next; next; next = longest.get(next)?.next)
        nodes.push(next);
      return { root, handoffs: handoffs(root), nodes };
    });
}

export function describeDependencyChain(nodes: string[]): string {
  const names = nodes.map(readableDependencyNode);
  const shown = names.length > 7 ? [...names.slice(0, 4), "…", ...names.slice(-2)] : names;
  return shown.join(" -> ");
}
