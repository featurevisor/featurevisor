import type { ConditionLocation } from "../config";

export type ConditionPath = (string | number)[];

export type ConditionLocationVisitor = (
  location: ConditionLocation,
  conditions: unknown,
  path: ConditionPath,
) => void;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Visits every `conditions` value a segment, feature or global variable authors, with its
 * location as named in `allowedConditions` and its path in the definition. The one walker
 * for authored condition locations, so every check and expression expansion see the same places.
 */
export function visitConditionLocations(
  entityType: "segment" | "feature" | "variable" | "schema",
  definition: unknown,
  visit: ConditionLocationVisitor,
) {
  if (!isObject(definition)) return;

  // Lists of rules, force entries and overrides, keyed by environment or not.
  const visitList = (
    value: unknown,
    path: ConditionPath,
    each: (entry: Record<string, unknown>, at: ConditionPath) => void,
  ) => {
    if (Array.isArray(value)) {
      value.forEach((entry, i) => isObject(entry) && each(entry, [...path, i]));
    } else if (isObject(value)) {
      for (const [environment, entries] of Object.entries(value)) {
        if (Array.isArray(entries))
          entries.forEach((entry, i) => isObject(entry) && each(entry, [...path, environment, i]));
      }
    }
  };
  const visitFeatureVariableOverrides = (value: unknown, path: ConditionPath) => {
    if (!isObject(value)) return;
    for (const [variableKey, overrides] of Object.entries(value)) {
      if (!Array.isArray(overrides)) continue;
      overrides.forEach(
        (override, i) =>
          isObject(override) &&
          visit("featureVariableOverrides", override.conditions, [
            ...path,
            variableKey,
            i,
            "conditions",
          ]),
      );
    }
  };
  const visitGlobalOverrides = (value: unknown, path: ConditionPath) =>
    visitList(value, path, (override, at) => {
      visit("variableOverrides", override.conditions, [...at, "conditions"]);
      if (override.overrides !== undefined)
        visitGlobalOverrides(override.overrides, [...at, "overrides"]);
    });

  if (entityType === "segment") {
    visit("segments", definition.conditions, ["conditions"]);
  }

  if (entityType === "feature") {
    visit("features", definition.conditions, ["conditions"]);
    visitList(definition.rules, ["rules"], (rule, at) => {
      visit("rules", rule.conditions, [...at, "conditions"]);
      visitFeatureVariableOverrides(rule.variableOverrides, [...at, "variableOverrides"]);
    });
    visitList(definition.force, ["force"], (entry, at) =>
      visit("force", entry.conditions, [...at, "conditions"]),
    );
    if (Array.isArray(definition.variations))
      definition.variations.forEach(
        (variation, i) =>
          isObject(variation) &&
          visitFeatureVariableOverrides(variation.variableOverrides, [
            "variations",
            i,
            "variableOverrides",
          ]),
      );
  }

  if (entityType === "variable") {
    visit("variables", definition.conditions, ["conditions"]);
    visitGlobalOverrides(definition.overrides, ["overrides"]);
  }

  // A schema's mutations and issues, at any node a value is validated against.
  if (entityType === "schema") {
    // Entries nest: a mutation holds its own `mutations`, and an issue its own `issues`.
    const visitEntries = (list: unknown, path: ConditionPath, nested: string) =>
      visitList(list, path, (entry, at) => {
        visit("schemas", entry.conditions, [...at, "conditions"]);
        if (entry[nested] !== undefined) visitEntries(entry[nested], [...at, nested], nested);
      });
    const walk = (node: unknown, path: ConditionPath) => {
      if (!isObject(node)) return;
      // Mutations are a list, or at the root a list per environment.
      for (const list of ["mutations", "issues"]) visitEntries(node[list], [...path, list], list);
      if (isObject(node.properties))
        for (const [key, property] of Object.entries(node.properties))
          walk(property, [...path, "properties", key]);
      if (isObject(node.items)) walk(node.items, [...path, "items"]);
      if (isObject(node.additionalProperties))
        walk(node.additionalProperties, [...path, "additionalProperties"]);
      if (Array.isArray(node.oneOf))
        node.oneOf.forEach((branch, i) => walk(branch, [...path, "oneOf", i]));
    };
    walk(definition, []);
  }
}
