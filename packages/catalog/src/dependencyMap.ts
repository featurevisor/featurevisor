import { fromNodeId, toNodeId, type DependencyDirection } from "./dependencyGraph";
import { getEntityDependencies, getIndexGraph } from "./dependencyIndex";
import type { CatalogEntityType, CatalogIndex, EntityDetail, EntityReference } from "./types";

export interface DependencyMapNode extends EntityReference {
  /** "type:key" */
  id: string;
}

/** A line from what is depended on to what depends on it, left to right on the map */
export interface DependencyMapEdge {
  from: string;
  to: string;
}

/**
 * One entity's dependencies laid out in columns: what it depends on to its left, what depends on
 * it to its right, each column one step further out than the one before.
 */
export interface DependencyMap {
  center: DependencyMapNode;
  /** Columns left of the entity, nearest first. The first holds what it refers to itself. */
  dependencies: DependencyMapNode[][];
  /** Columns right of the entity, nearest first. The first holds what refers to it directly. */
  dependents: DependencyMapNode[][];
  edges: DependencyMapEdge[];
  /** How many entities each side leaves out for space, until the reader asks to see more */
  more: Record<DependencyMapSide, number>;
}

/** What an entity depends on, to its left, or what depends on it, to its right */
export type DependencyMapSide = "dependencies" | "dependents";

export interface DependencyMapLimits {
  /** Columns on each side */
  levels: number;
  /** Entities in one column */
  perColumn: number;
}

/** Large enough that most maps show everything and drag, small enough to stay quick to draw */
export const DEPENDENCY_MAP_LIMITS: DependencyMapLimits = { levels: 4, perColumn: 24 };

/**
 * A side's limits once the reader has asked to see more `step` times: four more columns each
 * time, and four times as many entities in a column, so one ask shows most of what was left out
 * and a very large project never draws everything at once.
 */
export function getRevealedLimits(step: number): DependencyMapLimits {
  return {
    levels: DEPENDENCY_MAP_LIMITS.levels * (step + 1),
    perColumn: DEPENDENCY_MAP_LIMITS.perColumn * 4 ** step,
  };
}

const TYPE_ORDER: Partial<Record<CatalogEntityType, number>> = {
  feature: 0,
  variable: 1,
  segment: 2,
  attribute: 3,
  schema: 4,
};

function compareNodes(left: string, right: string) {
  const a = fromNodeId(left);
  const b = fromNodeId(right);
  return (
    (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) ||
    a.key.localeCompare(b.key, undefined, { numeric: true })
  );
}

function toNode(id: string): DependencyMapNode {
  return { id, ...fromNodeId(id) };
}

/** Each entity's rows from the middle of its column, as the map centres every column */
function offsets(column: string[]) {
  return new Map(column.map((id, index) => [id, index - (column.length - 1) / 2]));
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Reorders one side's columns so each entity sits level with the entities it connects to, which
 * keeps lines short and crossings few. Sweeps inwards then outwards, twice, moving each entity to
 * the average place of its neighbours in the column it is ordered against. An entity with no
 * neighbour there keeps its place, and ties keep the order they had.
 */
function untangle(columns: string[][], edges: DependencyMapEdge[], direction: DependencyDirection) {
  const outerOf = new Map<string, string[]>();
  const innerOf = new Map<string, string[]>();
  for (const edge of edges) {
    const [outer, inner] =
      direction === "dependencies" ? [edge.from, edge.to] : [edge.to, edge.from];
    outerOf.set(inner, [...(outerOf.get(inner) || []), outer]);
    innerOf.set(outer, [...(innerOf.get(outer) || []), inner]);
  }
  const reorder = (index: number, against: string[], neighbours: Map<string, string[]>) => {
    const place = offsets(against);
    const current = offsets(columns[index]);
    const key = (id: string) => {
      const found = (neighbours.get(id) || []).filter((other) => place.has(other));
      return found.length ? average(found.map((other) => place.get(other)!)) : current.get(id)!;
    };
    const keys = new Map(columns[index].map((id) => [id, key(id)]));
    columns[index] = [...columns[index]].sort(
      (left, right) =>
        keys.get(left)! - keys.get(right)! || current.get(left)! - current.get(right)!,
    );
  };
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let index = columns.length - 2; index >= 0; index--) {
      reorder(index, columns[index + 1], outerOf);
    }
    for (let index = 1; index < columns.length; index++) {
      reorder(index, columns[index - 1], innerOf);
    }
  }
}

/**
 * Walks one side outwards from the entity, a column per step. Each entity sits in the column of
 * its shortest path, so a diamond meets in one place. Columns after the first are ordered by
 * where their neighbours sit in the column before, which keeps lines from crossing needlessly.
 */
function walkSide(
  center: string,
  first: string[],
  direction: DependencyDirection,
  next: (id: string, direction: DependencyDirection) => string[],
  seen: Set<string>,
  limits: DependencyMapLimits,
) {
  const columns: string[][] = [];
  const edges: DependencyMapEdge[] = [];
  const link = (outer: string, inner: string) =>
    edges.push(
      direction === "dependencies" ? { from: outer, to: inner } : { from: inner, to: outer },
    );

  let candidates = new Map<string, string[]>();
  for (const id of first) {
    if (!seen.has(id)) candidates.set(id, [center]);
  }
  let previous: string[] = [center];
  for (let level = 0; level < limits.levels && candidates.size > 0; level++) {
    const position = new Map(previous.map((id, index) => [id, index]));
    const barycenter = (inner: string[]) =>
      inner.reduce((sum, id) => sum + (position.get(id) ?? 0), 0) / inner.length;
    const ordered = [...candidates.keys()].sort(
      (left, right) =>
        (level === 0
          ? 0
          : barycenter(candidates.get(left)!) - barycenter(candidates.get(right)!)) ||
        compareNodes(left, right),
    );
    // Everything found here is placed here or left out, never moved further out
    ordered.forEach((id) => seen.add(id));
    const shown = ordered.slice(0, limits.perColumn);
    for (const id of shown) {
      for (const inner of candidates.get(id)!) link(id, inner);
    }
    columns.push(shown);

    const following = new Map<string, string[]>();
    for (const id of shown) {
      for (const neighbour of next(id, direction)) {
        if (seen.has(neighbour)) continue;
        const inner = following.get(neighbour);
        if (inner) inner.push(id);
        else following.set(neighbour, [id]);
      }
    }
    candidates = following;
    previous = shown;
  }

  untangle(columns, edges, direction);

  // Everything this side reaches, to say how much the map leaves out
  const reached = new Set<string>(first);
  const queue = [...first];
  for (let index = 0; index < queue.length; index++) {
    for (const neighbour of next(queue[index], direction)) {
      if (neighbour === center || reached.has(neighbour)) continue;
      reached.add(neighbour);
      queue.push(neighbour);
    }
  }
  reached.delete(center);
  const shownCount = columns.reduce((sum, column) => sum + column.length, 0);

  return {
    columns: columns.map((column) => column.map(toNode)),
    edges,
    more: Math.max(0, reached.size - shownCount),
  };
}

/**
 * The dependency map of one entity, from its own definition and the index's graph. Without an
 * index only its direct dependencies and dependents are known. Undefined when it has neither.
 * The limits apply to both sides, or to each side apart.
 */
export function getDependencyMap(
  detail: EntityDetail,
  index: CatalogIndex | null | undefined,
  limits:
    | DependencyMapLimits
    | Record<DependencyMapSide, DependencyMapLimits> = DEPENDENCY_MAP_LIMITS,
): DependencyMap | undefined {
  const sides = "levels" in limits ? { dependencies: limits, dependents: limits } : limits;
  const center = toNodeId(detail.type, detail.key);
  const indexGraph = index ? getIndexGraph(index) : undefined;
  const exists = (id: string) => !indexGraph || indexGraph.exists(id);
  const next = (id: string, direction: DependencyDirection) =>
    indexGraph ? indexGraph.graph.direct(id, direction).filter(exists) : [];

  // The same direct entities the Depends on and Used by rows list
  const uses = getEntityDependencies(detail, index).uses.map((entry) =>
    toNodeId(entry.type, entry.key),
  );
  const usedBy = [
    ...(detail.usedBy || []).map((entry) => toNodeId(entry.type, entry.key)),
    ...next(center, "dependents"),
  ].filter(exists);

  const seen = new Set([center]);
  const left = walkSide(center, [...new Set(uses)], "dependencies", next, seen, sides.dependencies);
  const right = walkSide(center, [...new Set(usedBy)], "dependents", next, seen, sides.dependents);
  if (left.columns.length === 0 && right.columns.length === 0) return undefined;

  return {
    center: toNode(center),
    dependencies: left.columns,
    dependents: right.columns,
    edges: [...left.edges, ...right.edges],
    more: { dependencies: left.more, dependents: right.more },
  };
}
