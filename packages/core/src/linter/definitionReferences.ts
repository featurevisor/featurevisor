import type {
  Attribute,
  Conditions,
  ParsedFeature,
  ParsedVariable,
  Segment,
} from "@featurevisor/types";

import { walkConditionLeaves } from "../datasource/conditions";

type Path = (string | number)[];

export interface ReferenceIssue {
  path: Path;
  message: string;
}

/** Every definition lint can resolve a reference to, archived or not. */
export interface ReferenceIndex {
  attributes: Record<string, Attribute | undefined>;
  segments: Record<string, Segment | undefined>;
  features: Record<string, ParsedFeature | undefined>;
  variables: Record<string, ParsedVariable | undefined>;
}

type Kind = "attribute" | "segment" | "feature" | "variable";

export type ReferringEntityType =
  | "segment"
  | "feature"
  | "variable"
  | "test"
  | "scenario"
  | "target";

export interface DefinitionReference {
  kind: Kind;
  key: string;
  /** A variable inside the feature named by `key`, for feature variable references. */
  featureVariable?: string;
  path: Path;
  /** The spec is about this definition, rather than only referring to it. */
  owner?: boolean;
}

const own = (value: unknown, key: PropertyKey): boolean =>
  !!value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Every key a definition, spec, scenario or target refers to, with its authored path. */
export function collectReferences(
  entityType: ReferringEntityType,
  definition: unknown,
): DefinitionReference[] {
  if (!isObject(definition)) return [];

  const references: DefinitionReference[] = [];
  const add = (kind: Kind, key: unknown, path: Path, extra: Partial<DefinitionReference> = {}) => {
    if (typeof key === "string") references.push({ kind, key, path, ...extra });
  };
  // `{ feature, variable }` names the feature, then one of its variables.
  const addFeatureOrVariable = (source: Record<string, unknown>, path: Path) => {
    if (typeof source.feature === "string") {
      add("feature", source.feature, [...path, "feature"]);
      if (typeof source.variable === "string")
        add("feature", source.feature, [...path, "variable"], {
          featureVariable: source.variable,
        });
    } else add("variable", source.variable, [...path, "variable"]);
  };

  const visitConditions = (conditions: unknown, path: Path) => {
    if (conditions === undefined) return;
    walkConditionLeaves(conditions as Conditions, (leaf, leafPath) => {
      const at = [...path, ...leafPath];
      if (typeof leaf === "string") return add("segment", leaf, at);
      if (!isObject(leaf)) return;
      if (typeof leaf.attribute === "string")
        return add("attribute", leaf.attribute.split(".")[0], [...at, "attribute"]);
      if (typeof leaf.feature === "string" || typeof leaf.variable === "string")
        addFeatureOrVariable(leaf, at);
    });
  };

  // Lists of rules, force entries and overrides, keyed by environment or not.
  const visitList = (
    value: unknown,
    path: Path,
    visit: (entry: Record<string, unknown>, at: Path) => void,
  ) => {
    if (Array.isArray(value)) {
      value.forEach((entry, i) => isObject(entry) && visit(entry, [...path, i]));
    } else if (isObject(value)) {
      for (const [environment, entries] of Object.entries(value)) {
        if (Array.isArray(entries))
          entries.forEach((entry, i) => isObject(entry) && visit(entry, [...path, environment, i]));
      }
    }
  };
  const visitFeatureVariableOverrides = (value: unknown, path: Path) => {
    if (!isObject(value)) return;
    for (const [variableKey, overrides] of Object.entries(value)) {
      if (!Array.isArray(overrides)) continue;
      overrides.forEach(
        (override, i) =>
          isObject(override) &&
          visitConditions(override.conditions, [...path, variableKey, i, "conditions"]),
      );
    }
  };
  const visitGlobalOverrides = (value: unknown, path: Path) =>
    visitList(value, path, (override, at) => {
      visitConditions(override.conditions, [...at, "conditions"]);
      if (override.overrides !== undefined)
        visitGlobalOverrides(override.overrides, [...at, "overrides"]);
    });

  if (entityType === "segment") {
    visitConditions(definition.conditions, ["conditions"]);
  }

  if (entityType === "feature") {
    visitConditions(definition.conditions, ["conditions"]);
    const bucketBy = definition.bucketBy;
    if (typeof bucketBy === "string") add("attribute", bucketBy, ["bucketBy"]);
    else if (Array.isArray(bucketBy))
      bucketBy.forEach((key, i) => add("attribute", key, ["bucketBy", i]));
    else if (isObject(bucketBy) && Array.isArray(bucketBy.or))
      bucketBy.or.forEach((key, i) => add("attribute", key, ["bucketBy", "or", i]));
    visitList(definition.rules, ["rules"], (rule, at) => {
      visitConditions(rule.conditions, [...at, "conditions"]);
      visitFeatureVariableOverrides(rule.variableOverrides, [...at, "variableOverrides"]);
    });
    visitList(definition.force, ["force"], (entry, at) =>
      visitConditions(entry.conditions, [...at, "conditions"]),
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
    visitConditions(definition.conditions, ["conditions"]);
    const compose = definition.compose;
    if (typeof compose === "string") add("variable", compose, ["compose"]);
    else if (isObject(compose)) {
      for (const [property, source] of Object.entries(compose)) {
        if (isObject(source)) addFeatureOrVariable(source, ["compose", property]);
      }
    }
    visitGlobalOverrides(definition.overrides, ["overrides"]);
  }

  if (entityType === "test" || entityType === "scenario") {
    add("feature", definition.feature, ["feature"], { owner: true });
    add("segment", definition.segment, ["segment"], { owner: true });
    add("variable", definition.variable, ["variable"], { owner: true });

    const visitOperand = (operand: unknown, path: Path) => {
      if (isObject(operand)) addFeatureOrVariable(operand, path);
    };
    const visitChecks = (checks: unknown, path: Path) => {
      if (!Array.isArray(checks)) return;
      checks.forEach((entry, i) => {
        if (!isObject(entry)) return;
        const at = [...path, i];
        for (const group of ["and", "or", "not"]) {
          if (own(entry, group)) return visitChecks(entry[group], [...at, group]);
        }
        if (typeof entry.segment === "string")
          return add("segment", entry.segment, [...at, "segment"]);
        visitOperand(entry, at);
        if (own(entry, "compareTo")) visitOperand(entry.compareTo, [...at, "compareTo"]);
      });
    };
    const visitStickyKeys = (value: unknown, kind: Kind, path: Path) => {
      if (isObject(value)) for (const key of Object.keys(value)) add(kind, key, [...path, key]);
    };
    const visitAssertion = (assertion: unknown, path: Path) => {
      if (!isObject(assertion)) return;
      visitStickyKeys(assertion.stickyFeatures, "feature", [...path, "stickyFeatures"]);
      visitStickyKeys(assertion.stickyVariables, "variable", [...path, "stickyVariables"]);
      visitChecks(assertion.checks, [...path, "checks"]);
      if (Array.isArray(assertion.children))
        assertion.children.forEach((child, i) => visitAssertion(child, [...path, "children", i]));
    };
    if (entityType === "scenario") visitAssertion(definition, []);
    else if (Array.isArray(definition.assertions))
      definition.assertions.forEach((assertion, i) => visitAssertion(assertion, ["assertions", i]));
  }

  if (entityType === "target") {
    // Only exact keys name a definition. Patterns with `*` may match archived ones harmlessly.
    for (const [field, kind] of [
      ["includeFeatures", "feature"],
      ["excludeFeatures", "feature"],
      ["includeVariables", "variable"],
      ["excludeVariables", "variable"],
    ] as const) {
      const patterns = definition[field];
      if (Array.isArray(patterns))
        patterns.forEach(
          (pattern, i) =>
            typeof pattern === "string" && !pattern.includes("*") && add(kind, pattern, [field, i]),
        );
    }
  }

  return references;
}

function lookup(index: ReferenceIndex, kind: Kind, key: string) {
  const collection =
    kind === "attribute"
      ? index.attributes
      : kind === "segment"
        ? index.segments
        : kind === "feature"
          ? index.features
          : index.variables;
  return own(collection, key)
    ? (collection[key] as { archived?: boolean; deprecated?: boolean } | undefined)
    : undefined;
}

/**
 * Archived definitions are left out of datafiles, so a reference to one silently
 * stops matching, and under `not` can match everyone. Only definitions, specs and
 * targets that are themselves active are checked: archived ones may refer to each other.
 */
export function getArchivedReferenceIssues(
  entityType: ReferringEntityType,
  definition: unknown,
  index: ReferenceIndex,
): ReferenceIssue[] {
  if (!isObject(definition) || definition.archived === true) return [];

  return collectReferences(entityType, definition)
    .filter(
      (reference) =>
        reference.featureVariable === undefined &&
        lookup(index, reference.kind, reference.key)?.archived === true,
    )
    .map(({ kind, key, path, owner }) => ({
      path,
      message: `Archived ${kind} "${key}" cannot be referenced. ${
        owner ? "Delete this spec" : "Remove the reference"
      }, or unarchive the ${kind}.`,
    }));
}

/**
 * Deprecated features, feature variables and global variables still evaluate, but are
 * on their way to being archived. Active definitions that are not deprecated themselves
 * get a warning for each reference, so they move off before it becomes an error.
 */
export function getDeprecatedReferenceWarnings(
  entityType: "segment" | "feature" | "variable",
  definition: unknown,
  index: ReferenceIndex,
): ReferenceIssue[] {
  if (!isObject(definition) || definition.archived === true || definition.deprecated === true)
    return [];

  const warnings: ReferenceIssue[] = [];
  for (const { kind, key, featureVariable, path } of collectReferences(entityType, definition)) {
    const target = lookup(index, kind, key);
    if (!target) continue;
    if (featureVariable !== undefined) {
      const variablesSchema = (target as ParsedFeature).variablesSchema;
      const variable = own(variablesSchema, featureVariable)
        ? (variablesSchema as Record<string, { deprecated?: boolean }>)[featureVariable]
        : undefined;
      if (variable?.deprecated === true)
        warnings.push({
          path,
          message: `Deprecated variable "${featureVariable}" of feature "${key}" is referenced. Remove or replace the reference before the variable is removed.`,
        });
    } else if ((kind === "feature" || kind === "variable") && target.deprecated === true) {
      const label = kind === "feature" ? "feature" : "global variable";
      warnings.push({
        path,
        message: `Deprecated ${label} "${key}" is referenced. Remove or replace the reference before the ${label} is archived.`,
      });
    }
  }
  return warnings;
}
