import type { Condition, ConditionLeaf, Conditions, VariableCondition } from "@featurevisor/types";

export type ConditionPath = (string | number)[];

/** Decode compiled expressions without treating bare segment keys as JSON. */
export function parseConditions(value: Conditions): Conditions {
  if (typeof value === "string" && /^[\[{]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      /* A literal segment key. */
    }
  }
  return value;
}

/** Walk every branch in authored order, including negated references. */
export function walkConditionLeaves(
  value: Conditions | undefined,
  visit: (leaf: ConditionLeaf, path: ConditionPath) => void,
  path: ConditionPath = [],
): void {
  if (value === undefined) return;
  value = parseConditions(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkConditionLeaves(entry, visit, [...path, index]));
  } else if (typeof value === "string") {
    if (value !== "*") visit(value, path);
  } else if (value && typeof value === "object") {
    if ("and" in value) walkConditionLeaves(value.and, visit, [...path, "and"]);
    else if ("or" in value) walkConditionLeaves(value.or, visit, [...path, "or"]);
    else if ("not" in value) walkConditionLeaves(value.not, visit, [...path, "not"]);
    else visit(value, path);
  }
}

export function compileConditionPath(
  path: VariableCondition["path"],
): (string | number)[] | undefined {
  if (path === undefined) return undefined;
  if (Array.isArray(path)) return [...path];
  return path.split(".").map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part));
}

/** Preserve expression shape and order. Only variable paths change representation. */
export function compileConditions(
  value: Conditions | undefined,
  stringify = false,
): Conditions | undefined {
  if (value === undefined) return undefined;
  const compile = (entry: Conditions): Conditions => {
    if (Array.isArray(entry)) return entry.map((child) => compile(child) as Condition);
    if (typeof entry === "string") return entry;
    if ("and" in entry) return { and: entry.and.map((child) => compile(child) as Condition) };
    if ("or" in entry) return { or: entry.or.map((child) => compile(child) as Condition) };
    if ("not" in entry) return { not: entry.not.map((child) => compile(child) as Condition) };
    if ("variable" in entry && entry.path !== undefined)
      return { ...entry, path: compileConditionPath(entry.path) };
    return { ...entry };
  };
  const compiled = compile(value);
  return stringify && typeof compiled !== "string" ? JSON.stringify(compiled) : compiled;
}

export function getConditionReferences(value: Conditions | undefined): {
  segments: Set<string>;
  features: Set<string>;
  variables: Set<string>;
  featureVariables: Array<{ feature: string; variable: string }>;
  attributes: Set<string>;
} {
  const result = {
    segments: new Set<string>(),
    features: new Set<string>(),
    variables: new Set<string>(),
    featureVariables: [] as Array<{ feature: string; variable: string }>,
    attributes: new Set<string>(),
  };
  const seen = new Set<string>();
  walkConditionLeaves(value, (leaf) => {
    if (typeof leaf === "string") result.segments.add(leaf);
    else if ("attribute" in leaf) result.attributes.add(leaf.attribute);
    else if ("variable" in leaf) {
      if (leaf.feature === undefined) result.variables.add(leaf.variable);
      else {
        result.features.add(leaf.feature);
        const id = JSON.stringify([leaf.feature, leaf.variable]);
        if (!seen.has(id))
          result.featureVariables.push({ feature: leaf.feature, variable: leaf.variable });
        seen.add(id);
      }
    } else if ("feature" in leaf) result.features.add(leaf.feature);
  });
  return result;
}

export function combineConditions(
  inherited: Conditions | undefined,
  own: Conditions | undefined,
): Conditions | undefined {
  if (inherited === undefined || inherited === "*") return own;
  if (own === undefined || own === "*") return inherited;
  return [
    ...(Array.isArray(inherited) ? inherited : [inherited]),
    ...(Array.isArray(own) ? own : [own]),
  ];
}
