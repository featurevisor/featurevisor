import type {
  Conditions,
  VariableCondition,
  ParsedFeature,
  ParsedVariable,
  ParsedVariableOverride,
  FeatureKey,
  VariableKey,
  Segment,
} from "@featurevisor/types";
import { getCompositionEntries } from "./composition";
import { walkConditionLeaves } from "./conditions";

export type DependencyEvaluationNode =
  | ["flag", FeatureKey]
  | ["feature-variable", FeatureKey, string]
  | ["variable", VariableKey]
  | ["segment", string];

export class DependencyCycleError extends Error {
  readonly code = "circular_dependency";
  constructor(
    readonly origin: DependencyEvaluationNode,
    readonly cycle: DependencyEvaluationNode[],
    chain?: string,
    readonly path: (string | number)[] = ["conditions"],
  ) {
    super(
      `circular dependency found: ${chain || cycle.map((node) => readableDependencyNode(dependencyNodeId(node))).join(" -> ")}`,
    );
    this.name = "DependencyCycleError";
  }
}
export function isDependencyCycleError(error: unknown): error is DependencyCycleError {
  return error instanceof DependencyCycleError;
}
export function dependencyNodeId(node: DependencyEvaluationNode): string {
  return JSON.stringify(node);
}
export const featureFlagNode = (feature: FeatureKey) => dependencyNodeId(["flag", feature]);
export const featureVariableNode = (feature: FeatureKey, variable: string) =>
  dependencyNodeId(["feature-variable", feature, variable]);
export const variableNode = (variable: VariableKey) => dependencyNodeId(["variable", variable]);
export const segmentNode = (segment: string) => dependencyNodeId(["segment", segment]);
export function variableConditionIdentity(condition: VariableCondition): string {
  return condition.feature !== undefined
    ? featureVariableNode(condition.feature, condition.variable)
    : variableNode(condition.variable);
}
type Graph = Map<string, Set<string>>;
type Paths = Map<string, Map<string, (string | number)[]>>;
const dependencyLocations = new WeakMap<Graph, Paths>();
const compositionAliases = new WeakMap<Graph, Map<string, Map<string, string | undefined>>>();

export function readableDependencyNode(node: string): string {
  const tuple = JSON.parse(node) as DependencyEvaluationNode;
  if (tuple[0] === "variable" || tuple[0] === "segment")
    return `${tuple[0]} ${JSON.stringify(tuple[1])}`;
  if (tuple[0] === "flag") return `feature ${JSON.stringify(tuple[1])}`;
  return `feature ${JSON.stringify(tuple[1])} variable ${JSON.stringify(tuple[2])}`;
}
function readablePath(path: (string | number)[]): string {
  return path.reduce<string>(
    (text, part) =>
      typeof part === "number" ? `${text}[${part}]` : text ? `${text}.${part}` : part,
    "",
  );
}
export function readableDependencyChain(graph: Graph, nodes: string[]): string {
  return nodes
    .map((node, index) => {
      const next = nodes[index + 1];
      const members = compositionAliases.get(graph)?.get(node);
      if (members?.has(next)) {
        const alias = members.get(next);
        return `${readableDependencyNode(node)} compose${alias === undefined ? "" : ` property ${JSON.stringify(alias)}`}`;
      }
      const path = dependencyLocations.get(graph)?.get(node)?.get(next);
      return `${readableDependencyNode(node)}${path ? ` ${readablePath(path)}` : ""}`;
    })
    .join(" -> ");
}
export interface DependencyDatasource {
  listFeatures?(): Promise<FeatureKey[]>;
  listVariables?(): Promise<VariableKey[]>;
  listSegments?(): Promise<string[]>;
  readSegment?(key: string): Promise<Segment>;
  readFeature(key: FeatureKey): Promise<ParsedFeature>;
  readVariable(key: VariableKey): Promise<ParsedVariable>;
}

/** One structural graph for conditions and composition, independent of environment. */
export async function buildDependencyGraph(
  datasource: DependencyDatasource,
  options: { includeOverride?: (override: { promotable?: boolean }) => boolean } = {},
): Promise<Graph> {
  const graph: Graph = new Map();
  const locations: Paths = new Map();
  const aliases = new Map<string, Map<string, string | undefined>>();
  dependencyLocations.set(graph, locations);
  compositionAliases.set(graph, aliases);
  const includeOverride = options.includeOverride || (() => true);
  const add = (owner: string, dependency: string, path?: (string | number)[]) => {
    if (!graph.has(owner)) graph.set(owner, new Set());
    graph.get(owner)!.add(dependency);
    if (path) {
      if (!locations.has(owner)) locations.set(owner, new Map());
      if (!locations.get(owner)!.has(dependency)) locations.get(owner)!.set(dependency, path);
    }
  };
  const conditions = (owner: string, value: Conditions | undefined, path: (string | number)[]) => {
    walkConditionLeaves(value, (leaf, relative) => {
      const dependency =
        typeof leaf === "string"
          ? segmentNode(leaf)
          : "variable" in leaf
            ? variableConditionIdentity(leaf)
            : "feature" in leaf
              ? featureFlagNode(leaf.feature)
              : undefined;
      if (dependency) add(owner, dependency, [...path, ...relative]);
    });
  };
  const groups = <T>(
    value: T[] | Record<string, T[]> | undefined,
    field: string,
  ): Array<[T[], (string | number)[]]> =>
    Array.isArray(value)
      ? [[value, [field]]]
      : Object.entries(value || {}).map(([environment, entries]) => [
          entries,
          [field, environment],
        ]);
  for (const key of datasource.listSegments ? await datasource.listSegments() : []) {
    const node = segmentNode(key);
    graph.set(node, new Set());
    conditions(node, (await datasource.readSegment!(key)).conditions, ["conditions"]);
  }
  for (const key of datasource.listFeatures ? await datasource.listFeatures() : []) {
    const feature = await datasource.readFeature(key);
    if (Object.prototype.hasOwnProperty.call(feature, "required")) {
      throw new Error(
        "Legacy feature `required` was removed. Use `conditions` and rename `{ key }` to `{ feature }`.",
      );
    }
    const flag = featureFlagNode(key);
    graph.set(flag, new Set());
    conditions(flag, feature.conditions, ["conditions"]);
    for (const variable of Object.keys(feature.variablesSchema || {})) {
      const node = featureVariableNode(key, variable);
      graph.set(node, new Set());
      add(node, flag);
    }
    const overrides = (
      value: Record<string, import("@featurevisor/types").VariableOverride[]> | undefined,
      path: (string | number)[],
    ) => {
      for (const [variable, entries] of Object.entries(value || {})) {
        const node = featureVariableNode(key, variable);
        if (!graph.has(node)) add(node, flag);
        entries.forEach((entry, index) => {
          if (includeOverride(entry))
            conditions(node, entry.conditions, [...path, variable, index, "conditions"]);
        });
      }
    };
    for (const [rules, path] of groups(feature.rules, "rules"))
      rules.forEach((rule, index) => {
        conditions(flag, rule.conditions, [...path, index, "conditions"]);
        overrides(rule.variableOverrides, [...path, index, "variableOverrides"]);
      });
    for (const [force, path] of groups(feature.force, "force"))
      force.forEach((entry, index) =>
        conditions(flag, entry.conditions, [...path, index, "conditions"]),
      );
    (feature.variations || []).forEach((variation, index) =>
      overrides(variation.variableOverrides, ["variations", index, "variableOverrides"]),
    );
  }
  for (const key of datasource.listVariables ? await datasource.listVariables() : []) {
    const variable = await datasource.readVariable(key);
    const node = variableNode(key);
    graph.set(node, new Set());
    conditions(node, variable.conditions, ["conditions"]);
    const members = new Map<string, string | undefined>();
    for (const [alias, entry] of getCompositionEntries(variable)) {
      // Invalid authoring belongs to lint, not secondary dependency errors.
      if (
        (alias !== undefined &&
          (!alias || ["__proto__", "prototype", "constructor"].includes(alias))) ||
        !entry ||
        Array.isArray(entry) ||
        typeof entry !== "object" ||
        (entry.feature !== undefined && typeof entry.feature !== "string") ||
        (entry.variable !== undefined && typeof entry.variable !== "string") ||
        (entry.feature === undefined && entry.variable === undefined) ||
        entry.feature === "" ||
        entry.variable === "" ||
        Object.keys(entry).some((key) => !["feature", "variable", "variation"].includes(key)) ||
        (entry.variation !== undefined &&
          (entry.variation !== true || entry.feature === undefined || entry.variable !== undefined))
      )
        continue;
      const dependency =
        entry.feature === undefined
          ? variableNode(entry.variable!)
          : entry.variable === undefined
            ? featureFlagNode(entry.feature)
            : featureVariableNode(entry.feature, entry.variable);
      const firstReference = !graph.get(node)!.has(dependency);
      add(node, dependency, alias === undefined ? ["compose"] : ["compose", alias]);
      if (firstReference) members.set(dependency, alias);
    }
    if (members.size) aliases.set(node, members);
    const overrides = (entries: ParsedVariableOverride[], path: (string | number)[]) => {
      entries.forEach((entry, index) => {
        if (!includeOverride(entry)) return;
        conditions(node, entry.conditions, [...path, index, "conditions"]);
        overrides(entry.overrides || [], [...path, index, "overrides"]);
      });
    };
    for (const [entries, path] of groups(variable.overrides, "overrides")) overrides(entries, path);
  }
  return graph;
}

export async function validateDependencies(datasource: DependencyDatasource): Promise<void> {
  const errors = await findDependencyCycles(datasource);
  if (errors.length) throw errors[0];
}

/** Deterministic DFS witnesses cover disconnected cycles without exponential routes. */
export async function findDependencyCycles(
  datasource: DependencyDatasource,
  inputGraph?: Graph,
): Promise<DependencyCycleError[]> {
  const graph = inputGraph ?? (await buildDependencyGraph(datasource));
  const errors: DependencyCycleError[] = [];
  const complete = new Set<string>();
  const visiting: string[] = [];
  const positions = new Map<string, number>();
  const compare = (left: string, right: string) => {
    const rank = (node: string) => (node.startsWith('["flag",') ? 0 : 1);
    return rank(left) - rank(right) || (left < right ? -1 : left > right ? 1 : 0);
  };
  const enter = (node: string) => {
    positions.set(node, visiting.length);
    visiting.push(node);
    return { node, dependencies: [...(graph.get(node) || [])].sort(compare).values() };
  };
  for (const root of [...graph.keys()].sort(compare)) {
    if (complete.has(root)) continue;
    const pending = [enter(root)];
    while (pending.length) {
      const frame = pending[pending.length - 1];
      const next = frame.dependencies.next();
      if (next.done) {
        complete.add(frame.node);
        positions.delete(frame.node);
        visiting.pop();
        pending.pop();
        continue;
      }
      const node = next.value;
      const start = positions.get(node);
      if (start !== undefined) {
        const nodes = [...visiting.slice(start), node];
        const cycle = nodes.map((entry) => JSON.parse(entry) as DependencyEvaluationNode);
        errors.push(
          new DependencyCycleError(
            cycle[0],
            cycle,
            readableDependencyChain(graph, nodes),
            dependencyLocations.get(graph)?.get(nodes[0])?.get(nodes[1]) || ["conditions"],
          ),
        );
        continue;
      }
      if (!complete.has(node)) pending.push(enter(node));
    }
  }
  return errors;
}

interface GraphIndex {
  ownerVariables: Map<FeatureKey, string[]>;
  parse: (node: string) => DependencyEvaluationNode;
}

// A graph is not changed after it is built, and one build collects closures from it more
// than once, so its owner index and parsed node names are derived once per graph.
const graphIndexes = new WeakMap<Map<string, Set<string>>, GraphIndex>();

function getGraphIndex(graph: Map<string, Set<string>>): GraphIndex {
  let index = graphIndexes.get(graph);
  if (index) return index;
  const parsed = new Map<string, DependencyEvaluationNode>();
  const parse = (node: string) => {
    let tuple = parsed.get(node);
    if (!tuple) {
      tuple = JSON.parse(node) as DependencyEvaluationNode;
      parsed.set(node, tuple);
    }
    return tuple;
  };
  const ownerVariables = new Map<FeatureKey, string[]>();
  for (const node of graph.keys()) {
    const tuple = parse(node);
    if (tuple[0] !== "feature-variable") continue;
    const owned = ownerVariables.get(tuple[1]) || [];
    owned.push(node);
    ownerVariables.set(tuple[1], owned);
  }
  index = { ownerVariables, parse };
  graphIndexes.set(graph, index);
  return index;
}

/** Walk shared structural dependencies once, retaining the actual route to a failed source. */
export function findUnavailableCompositionDependency(
  graph: Map<string, Set<string>>,
  roots: string[],
  unavailable: (node: DependencyEvaluationNode) => string | undefined,
): { root: string; alias?: string; nodes: string[]; reason: string } | undefined {
  if (roots.length === 0) return undefined;
  const { ownerVariables, parse } = getGraphIndex(graph);
  const visited = new Set<string>();
  type Route = { node: string; parent?: Route };
  for (const root of roots) {
    const pending: Route[] = [{ node: root }];
    while (pending.length) {
      const route = pending.pop()!;
      if (visited.has(route.node)) continue;
      visited.add(route.node);
      const tuple = parse(route.node);
      const reason = unavailable(tuple);
      if (reason) {
        const nodes: string[] = [];
        for (let cursor: Route | undefined = route; cursor; cursor = cursor.parent)
          nodes.push(cursor.node);
        nodes.reverse();
        return {
          root,
          alias: compositionAliases.get(graph)?.get(root)?.get(nodes[1]),
          nodes,
          reason,
        };
      }
      const dependencies = new Set(graph.get(route.node));
      if (tuple[0] === "flag") {
        for (const owned of ownerVariables.get(tuple[1]) || []) dependencies.add(owned);
      }
      for (const node of [...dependencies].reverse()) pending.push({ node, parent: route });
    }
  }
  return undefined;
}

export async function collectDependencyClosure(
  datasource: DependencyDatasource,
  roots: string[],
  options: {
    includeOwnedFeatureVariables?: boolean;
    graph?: Map<string, Set<string>>;
  } = {},
): Promise<{ features: Set<FeatureKey>; variables: Set<VariableKey>; segments: Set<string> }> {
  const graph = options.graph || (await buildDependencyGraph(datasource));
  const { ownerVariables, parse } = getGraphIndex(graph);
  const result = {
    features: new Set<FeatureKey>(),
    variables: new Set<VariableKey>(),
    segments: new Set<string>(),
  };
  const visited = new Set<string>();
  const pending = [...roots].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    const tuple = parse(node);
    const dependencies = [...(graph.get(node) || [])];
    if (tuple[0] === "flag") {
      const featureKey = tuple[1];
      result.features.add(featureKey);
      if (options.includeOwnedFeatureVariables !== false) {
        dependencies.unshift(...(ownerVariables.get(featureKey) || []));
      }
    } else if (tuple[0] === "variable") result.variables.add(tuple[1]);
    else if (tuple[0] === "segment") result.segments.add(tuple[1]);
    else result.features.add(tuple[1]);
    for (let index = dependencies.length - 1; index >= 0; index--)
      pending.push(dependencies[index]);
  }
  return result;
}
