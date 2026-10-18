/** Count distinct immediate dependency edges reachable in one memoized request. */
export function estimateDependencyExpansion(
  graph: Map<string, Set<string>>,
  threshold = 1000,
): Array<{ root: string; cost: number }> {
  const neighbours = new Map<string, Set<string>>();
  for (const [node, children] of graph) {
    if (!neighbours.has(node)) neighbours.set(node, new Set());
    for (const child of children) {
      if (!neighbours.has(child)) neighbours.set(child, new Set());
      neighbours.get(node)!.add(child);
      neighbours.get(child)!.add(node);
    }
  }

  const seen = new Set<string>();
  const warnings: Array<{ root: string; cost: number }> = [];
  for (const start of neighbours.keys()) {
    if (seen.has(start)) continue;
    const cluster: string[] = [];
    const pending = [start];
    seen.add(start);
    while (pending.length > 0) {
      const node = pending.pop()!;
      cluster.push(node);
      for (const neighbour of neighbours.get(node) || []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        pending.push(neighbour);
      }
    }

    // A cluster with at most threshold edges cannot exceed this static estimate.
    const edgeCount = cluster.reduce((count, node) => count + (graph.get(node)?.size || 0), 0);
    if (edgeCount <= threshold) continue;

    for (const root of cluster) {
      const visited = new Set([root]);
      const reachable = [root];
      let cost = 0;
      while (reachable.length > 0 && cost <= threshold) {
        for (const child of graph.get(reachable.pop()!) || []) {
          cost++;
          if (!visited.has(child)) {
            visited.add(child);
            reachable.push(child);
          }
        }
      }
      if (cost > threshold) {
        warnings.push({ root, cost: Math.min(cost, threshold + 1) });
        break;
      }
    }
  }
  return warnings;
}
