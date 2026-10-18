import type { CatalogEntityType, EntityReference, IndirectDependency } from "./types";

/** Graph nodes are "type:key", for features, global variables, segments and attributes. */
export function toNodeId(type: CatalogEntityType, key: string) {
  return `${type}:${key}`;
}

export function fromNodeId(id: string): EntityReference {
  const separator = id.indexOf(":");
  return { type: id.slice(0, separator) as CatalogEntityType, key: id.slice(separator + 1) };
}

export type DependencyDirection = "dependencies" | "dependents";

/**
 * Direct references between features, global variables, segments and attributes, and what each
 * one reaches through them. Searches are breadth first, so every reported chain is a shortest
 * one, and neighbours are visited in sorted order, so exports are stable.
 *
 * Everything reachable counts, through features and variables as well as segments. That is the
 * same closure Core uses to complete a Target's datafile and SDKs use to report changes.
 */
export class DependencyGraph {
  private readonly edges: Record<DependencyDirection, Map<string, string[]>> = {
    dependencies: new Map(),
    dependents: new Map(),
  };
  private readonly forwardReach = new Map<string, Map<string, string>>();

  constructor(edges: Iterable<[owner: string, reference: string]>) {
    const forward = new Map<string, Set<string>>();
    const backward = new Map<string, Set<string>>();
    const add = (map: Map<string, Set<string>>, from: string, to: string) => {
      const set = map.get(from) || new Set<string>();
      set.add(to);
      map.set(from, set);
    };
    for (const [owner, reference] of edges) {
      if (owner === reference) continue;
      add(forward, owner, reference);
      add(backward, reference, owner);
    }
    for (const [direction, map] of [
      ["dependencies", forward],
      ["dependents", backward],
    ] as const) {
      for (const [node, neighbours] of map) {
        this.edges[direction].set(node, [...neighbours].sort());
      }
    }
  }

  direct(id: string, direction: DependencyDirection): string[] {
    return this.edges[direction].get(id) || [];
  }

  /**
   * Every node reached from `id`, each mapped to the node it was first reached from, in breadth
   * first order. Dependencies are kept for reuse, since every Target and summary needs them and
   * their total size matches the relationship lists. Dependents are searched on demand.
   */
  reach(
    id: string,
    direction: DependencyDirection,
    through?: (node: string) => boolean,
  ): Map<string, string> {
    const cacheable = direction === "dependencies" && !through;
    const cached = cacheable ? this.forwardReach.get(id) : undefined;
    if (cached) return cached;

    const parents = new Map<string, string>();
    const queue = [id];
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index];
      if (index > 0 && through && !through(node)) continue;
      for (const next of this.direct(node, direction)) {
        if (next === id || parents.has(next)) continue;
        parents.set(next, node);
        queue.push(next);
      }
    }

    if (cacheable) this.forwardReach.set(id, parents);
    return parents;
  }

  /** Nodes between `id` and `other`, ordered from the dependent towards the dependency. */
  chain(parents: Map<string, string>, id: string, other: string, direction: DependencyDirection) {
    const path: string[] = [];
    let node = parents.get(other);
    while (node !== undefined && node !== id) {
      path.push(node);
      node = parents.get(node);
    }
    // Searching dependencies walks back from the dependency, so its path reads in reverse.
    return direction === "dependencies" ? path.reverse() : path;
  }

  /** Nodes reached only through others, each with its chain, nearest first. */
  indirect(
    id: string,
    direction: DependencyDirection,
    exists: (node: string) => boolean,
  ): IndirectDependency[] {
    const direct = new Set(this.direct(id, direction));
    const parents = this.reach(id, direction);
    const result: IndirectDependency[] = [];
    for (const node of parents.keys()) {
      if (direct.has(node) || !exists(node)) continue;
      result.push({
        ...fromNodeId(node),
        via: this.chain(parents, id, node, direction).map(fromNodeId),
      });
    }
    return result;
  }

  /**
   * The closest features and variables that depend on `id`, looking through segments only.
   * Segments are shared conditions, so the feature or variable using one is what requires it.
   */
  nearestOwners(id: string): string[] {
    const owners: string[] = [];
    for (const node of this.reach(id, "dependents", (node) => node.startsWith("segment:")).keys()) {
      if (node.startsWith("feature:") || node.startsWith("variable:")) owners.push(node);
    }
    return owners.sort();
  }
}
