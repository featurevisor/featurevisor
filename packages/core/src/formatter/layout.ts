import type { FormatLayout, FormatPath } from "@featurevisor/parsers";
import type { EntityType } from "@featurevisor/types";

import { HOUSE_STYLE } from "./style";

/**
 * Where each kind of object sits in a definition, so the house style in style.ts reaches the
 * right maps and lists. A parser's `format` receives the result as a FormatLayout.
 *
 * This file keeps the promise that formatting never changes a datafile. Only objects the
 * builder rebuilds key by key are given a key order here: features, rules, force entries,
 * variations, variablesSchema entries, segments, global variables and their overrides, and
 * everything in test specs, which datafiles never hold. Values stay as written: variable
 * values, context, condition leaves, compose references, and maps keyed by the author, such
 * as variablesSchema or properties. Lists are never reordered, since rules, overrides,
 * variations, conditions and mutations depend on their order.
 */

/** Every kind of definition fmt formats, in the order it formats them */
export const FORMAT_ENTITY_TYPES: EntityType[] = [
  "attribute",
  "schema",
  "segment",
  "feature",
  "variable",
  "target",
  "test",
  "scenario",
];

type Shape =
  /** Featurevisor's own keys, written in `order`, with the shapes of some of their values */
  | { kind: "map"; order: string[]; space: boolean; children: () => Record<string, Shape> }
  /** Keys chosen by the author, every value of the same shape */
  | { kind: "dict"; value: Shape; space: boolean }
  | { kind: "list"; item: Shape; space: boolean }
  /** A list, or a map of environments to lists */
  | { kind: "byEnvironment"; item: Shape; space: boolean; spaceEnvironments: boolean }
  /** A value, left as written */
  | { kind: "value" };

const VALUE: Shape = { kind: "value" };

/** Children are given as a function, so a shape can hold itself, as schemas and overrides do */
function map(order: string[], space = false, children?: () => Record<string, Shape>): Shape {
  let resolved: Record<string, Shape> | undefined;
  return { kind: "map", order, space, children: () => (resolved ??= children?.() ?? {}) };
}

function dict(value: Shape, space = false): Shape {
  return { kind: "dict", value, space };
}

function list(item: Shape, space = false): Shape {
  return { kind: "list", item, space };
}

function byEnvironment(item: Shape, space: boolean, spaceEnvironments: boolean): Shape {
  return { kind: "byEnvironment", item, space, spaceEnvironments };
}

const { keyOrder, blankLines } = HOUSE_STYLE;

/** A whole file */
function file(order: string[], children?: () => Record<string, Shape>): Shape {
  return map(order, blankLines.topLevelKeys, children);
}

const schema: Shape = map(keyOrder.schema, false, () => schemaChildren());

function schemaChildren(): Record<string, Shape> {
  return {
    properties: dict(schema, blankLines.schemaProperties),
    items: schema,
    oneOf: list(schema),
  };
}

const featureVariableOverrides = dict(
  list(map(keyOrder.featureVariableOverride), blankLines.featureVariableOverrides),
);

const variableOverride: Shape = map(keyOrder.variableOverride, false, () => ({
  overrides: list(variableOverride, blankLines.variableOverrides),
}));

const check: Shape = map(keyOrder.check, false, () => ({
  and: list(check, blankLines.checks),
  or: list(check, blankLines.checks),
  not: list(check, blankLines.checks),
}));

function assertionChildren(): Record<string, Shape> {
  return {
    checks: list(check, blankLines.checks),
    children: list(assertion, blankLines.assertionChildren),
  };
}

const assertion: Shape = map(keyOrder.assertion, false, assertionChildren);

const SHAPES: Record<EntityType, Shape> = {
  attribute: file(keyOrder.attribute, schemaChildren),
  schema: file(keyOrder.schema, schemaChildren),
  segment: file(keyOrder.segment),
  feature: file(keyOrder.feature, () => ({
    variablesSchema: dict(
      map(keyOrder.variableSchema, false, schemaChildren),
      blankLines.variablesSchema,
    ),
    variations: list(
      map(keyOrder.variation, false, () => ({ variableOverrides: featureVariableOverrides })),
      blankLines.variations,
    ),
    force: byEnvironment(map(keyOrder.force), blankLines.force, blankLines.forceEnvironments),
    rules: byEnvironment(
      map(keyOrder.rule, false, () => ({ variableOverrides: featureVariableOverrides })),
      blankLines.rules,
      blankLines.ruleEnvironments,
    ),
  })),
  variable: file(keyOrder.variable, () => ({
    ...schemaChildren(),
    overrides: byEnvironment(
      variableOverride,
      blankLines.variableOverrides,
      blankLines.variableOverrideEnvironments,
    ),
  })),
  target: file(keyOrder.target),
  test: file(keyOrder.test, () => ({ assertions: list(assertion, blankLines.assertions) })),
  // a scenario spec is one assertion at the top level of its file
  scenario: file(keyOrder.assertion, assertionChildren),
};

function childShape(shape: Shape, key: string | number): Shape {
  switch (shape.kind) {
    case "map":
      return typeof key === "string" ? shape.children()[key] || VALUE : VALUE;
    case "dict":
      return typeof key === "string" ? shape.value : VALUE;
    case "list":
      return typeof key === "number" ? shape.item : VALUE;
    case "byEnvironment":
      // a list's item, or an environment's list
      return typeof key === "number" ? shape.item : list(shape.item, shape.space);
    default:
      return VALUE;
  }
}

function shapeAt(entityType: EntityType, path: FormatPath): Shape {
  let shape = SHAPES[entityType];
  for (const key of path) {
    shape = childShape(shape, key);
    if (shape.kind === "value") return shape;
  }
  return shape;
}

/** The keys of the map at `path` in house order, then any others as they were written */
export function getKeyOrder(
  entityType: EntityType,
  path: FormatPath,
  keys: string[],
): string[] | undefined {
  const shape = shapeAt(entityType, path);
  if (shape.kind !== "map") return undefined;
  const known = new Set(shape.order);
  return [
    ...shape.order.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !known.has(key)),
  ];
}

/** Whether the map at `path` has a blank line between its entries */
export function isSpacedMap(entityType: EntityType, path: FormatPath): boolean {
  const shape = shapeAt(entityType, path);
  if (shape.kind === "map" || shape.kind === "dict") return shape.space;
  // the node at a byEnvironment path is a map only when it groups lists by environment
  if (shape.kind === "byEnvironment") return shape.spaceEnvironments;
  return false;
}

/** Whether the list at `path` has a blank line between its items */
export function isSpacedList(entityType: EntityType, path: FormatPath): boolean {
  const shape = shapeAt(entityType, path);
  return (shape.kind === "list" || shape.kind === "byEnvironment") && shape.space;
}

/** The key order applied to a parsed value, for parsers that write from values */
export function orderValue(entityType: EntityType, value: unknown, path: FormatPath = []): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => orderValue(entityType, item, [...path, index]));
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const keys = getKeyOrder(entityType, path, Object.keys(record)) || Object.keys(record);
  return Object.fromEntries(
    keys.map((key) => [key, orderValue(entityType, record[key], [...path, key])]),
  );
}

/** The layout a parser's `format` applies to one kind of definition */
export function getFormatLayout(entityType: EntityType, extension?: string): FormatLayout {
  const formats: Record<string, object | undefined> = HOUSE_STYLE.formats;
  return {
    indent: HOUSE_STYLE.indent,
    orderKeys: (path, keys) => getKeyOrder(entityType, path, keys),
    spaceEntries: (path) => isSpacedMap(entityType, path),
    spaceItems: (path) => isSpacedList(entityType, path),
    orderValue: <T>(value: T) => orderValue(entityType, value) as T,
    options: { ...(extension ? formats[extension] : undefined) },
  };
}
