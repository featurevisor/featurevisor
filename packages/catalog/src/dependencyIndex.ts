import { DependencyGraph, fromNodeId, toNodeId } from "./dependencyGraph";
import {
  collectAuthoredReferences,
  compareReferences,
  groupAuthoredReferences,
} from "./dependencyReferences";
import type {
  CatalogEntityType,
  CatalogIndex,
  DirectDependency,
  EntityDetail,
  EntityReference,
  IndirectDependency,
} from "./types";

interface IndexGraph {
  graph: DependencyGraph;
  /** Whether a "type:key" node names an entity in this index. */
  exists: (node: string) => boolean;
}

const graphs = new WeakMap<CatalogIndex, IndexGraph>();

/**
 * The dependency graph of one index, built once from every entity's direct references. Indexes
 * are immutable, so it is kept for as long as the index is.
 */
export function getIndexGraph(index: CatalogIndex): IndexGraph {
  let cached = graphs.get(index);
  if (!cached) {
    const nodes = new Set<string>();
    const edges: Array<[string, string]> = [];
    for (const [type, rows] of Object.entries(index.entities)) {
      for (const row of rows) {
        const id = toNodeId(type as CatalogEntityType, row.key);
        nodes.add(id);
        for (const reference of row.references || []) edges.push([id, reference]);
      }
    }
    cached = { graph: new DependencyGraph(edges), exists: (node) => nodes.has(node) };
    graphs.set(index, cached);
  }
  return cached;
}

export interface EntityDependencies {
  /** What the entity refers to itself, with where and what it checks. */
  uses: DirectDependency[];
  /** What it depends on only through the entities in `uses`. */
  usesIndirectly: IndirectDependency[];
  /** What depends on it only through others, beyond its direct `usedBy`. */
  usedIndirectlyBy: IndirectDependency[];
}

const NO_DEPENDENCIES: EntityDependencies = { uses: [], usesIndirectly: [], usedIndirectlyBy: [] };

/**
 * One entity's dependencies in both directions. Direct ones come from its own definition, read
 * exactly as the exporter reads it, and indirect ones from the index's graph.
 */
export function getEntityDependencies(
  detail: EntityDetail | null | undefined,
  index: CatalogIndex | null | undefined,
): EntityDependencies {
  if (!detail) return NO_DEPENDENCIES;
  const uses = groupAuthoredReferences(
    collectAuthoredReferences(detail.type, detail.entity as Record<string, unknown>),
  );
  if (!index) return { ...NO_DEPENDENCIES, uses };

  const { graph, exists } = getIndexGraph(index);
  const id = toNodeId(detail.type, detail.key);
  return {
    // A reference to a missing entity is a lint error, and has no page to link to.
    uses: uses.filter((entry) => exists(toNodeId(entry.type, entry.key))),
    usesIndirectly: graph.indirect(id, "dependencies", exists).sort(compareReferences),
    usedIndirectlyBy: graph.indirect(id, "dependents", exists).sort(compareReferences),
  };
}

/** Everything an entity depends on, directly or not, as "type:key". */
export function getDependencyNodes(index: CatalogIndex, reference: EntityReference) {
  const { graph, exists } = getIndexGraph(index);
  return [...graph.reach(toNodeId(reference.type, reference.key), "dependencies").keys()].filter(
    exists,
  );
}

/** Everything that depends on an entity, directly or not, as "type:key". */
export function getDependentNodes(index: CatalogIndex, reference: EntityReference) {
  const { graph, exists } = getIndexGraph(index);
  return [...graph.reach(toNodeId(reference.type, reference.key), "dependents").keys()].filter(
    exists,
  );
}

/** The closest features and variables requiring an entity, looking through segments only. */
export function getNearestOwners(index: CatalogIndex, reference: EntityReference) {
  return getIndexGraph(index)
    .graph.nearestOwners(toNodeId(reference.type, reference.key))
    .map(fromNodeId);
}
