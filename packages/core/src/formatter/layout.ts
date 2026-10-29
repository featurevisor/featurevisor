import type { FormatLayout, FormatPath } from "@featurevisor/parsers";
import type { EntityType } from "@featurevisor/types";

/**
 * Featurevisor's house layout for definitions, whatever their file format: the indentation,
 * the order of Featurevisor's own keys, and where blank lines go. It reaches a parser's
 * `format` as a FormatLayout, and each parser applies what its format can express. Only what
 * is particular to one format, such as YAML's quotes, belongs in the parser.
 *
 * Key order only reaches objects the builder rebuilds key by key, so formatting never changes
 * a datafile. Values stay as written: variable values, context, condition leaves, compose
 * references, and maps keyed by the author, such as variablesSchema or properties. Lists are
 * never reordered, because rules, overrides, variations, conditions and mutations depend on
 * their order.
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

/** Spaces per level of nesting */
export const INDENT = 2;

type ListShape = { kind: "list"; item: Shape; spaceItems: boolean };

type Shape =
  /** A map of Featurevisor's own keys, written in `order`, with known children */
  | { kind: "map"; order: string[]; children?: Record<string, Shape>; spaceEntries: boolean }
  /** A map keyed by the author, each value of the same shape */
  | { kind: "dict"; value: Shape }
  | ListShape
  /** A list, or a map of environments to lists */
  | { kind: "byEnvironment"; list: ListShape; spaceEnvironments: boolean }
  /** A value, left as written */
  | { kind: "value" };

const VALUE: Shape = { kind: "value" };

/** A whole file: a blank line between its top level keys */
function definition(order: string[], children?: Record<string, Shape>): Shape {
  return { kind: "map", order, children, spaceEntries: true };
}

function map(order: string[], children?: Record<string, Shape>): Shape {
  return { kind: "map", order, children, spaceEntries: false };
}

function list(item: Shape, options: { spaceItems?: boolean } = {}): ListShape {
  return { kind: "list", item, spaceItems: options.spaceItems === true };
}

function dict(value: Shape): Shape {
  return { kind: "dict", value };
}

function byEnvironment(
  item: Shape,
  options: { spaceItems?: boolean; spaceEnvironments?: boolean } = {},
): Shape {
  return {
    kind: "byEnvironment",
    list: list(item, options),
    spaceEnvironments: options.spaceEnvironments === true,
  };
}

const LIFECYCLE = ["archived", "deprecated", "promotable"];

const SCHEMA_KEYS = [
  "type",
  "schema",
  "oneOf",
  "format",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "properties",
  "required",
  "additionalProperties",
];

// schemas nest, so their children are filled in after the shape exists
const schema = map(["description", ...SCHEMA_KEYS]);
(schema as { children?: Record<string, Shape> }).children = {
  properties: dict(schema),
  items: schema,
  oneOf: list(schema),
};

const featureVariableOverride = map([
  "key",
  "description",
  "promotable",
  "conditions",
  "value",
  "mutate",
]);

const variableOverrides = dict(list(featureVariableOverride));

const variableSchema = map(
  [
    "key",
    "description",
    "deprecated",
    ...SCHEMA_KEYS,
    "defaultValue",
    "disabledValue",
    "useDefaultWhenDisabled",
  ],
  { properties: dict(schema), items: schema, oneOf: list(schema) },
);

const variation = map(["value", "description", "weight", "variables", "variableOverrides"], {
  variableOverrides,
});

const rule = map(
  [
    "key",
    "description",
    "promotable",
    "conditions",
    "percentage",
    "enabled",
    "variation",
    "variationWeights",
    "variables",
    "variableOverrides",
  ],
  { variableOverrides },
);

const force = map(["conditions", "enabled", "variation", "variables"]);

const feature = definition(
  [
    ...LIFECYCLE,
    "description",
    "tags",
    "bucketBy",
    "conditions",
    "disabledVariationValue",
    "variablesSchema",
    "variations",
    "force",
    "rules",
    "expose",
  ],
  {
    variablesSchema: dict(variableSchema),
    variations: list(variation),
    force: byEnvironment(force),
    // a blank line between rules, and between the environments that group them
    rules: byEnvironment(rule, { spaceItems: true, spaceEnvironments: true }),
  },
);

const globalVariableOverride = map([
  "key",
  "description",
  "promotable",
  "conditions",
  "continue",
  "value",
  "mutate",
  "overrides",
]);
(globalVariableOverride as { children?: Record<string, Shape> }).children = {
  overrides: list(globalVariableOverride),
};

const variable = definition(
  [
    ...LIFECYCLE,
    "description",
    "tags",
    "compose",
    ...SCHEMA_KEYS,
    "defaultValue",
    "conditions",
    "disabledValue",
    "useDefaultWhenDisabled",
    "overrides",
  ],
  {
    properties: dict(schema),
    items: schema,
    oneOf: list(schema),
    overrides: byEnvironment(globalVariableOverride),
  },
);

const segment = definition([...LIFECYCLE, "description", "conditions"]);

const attribute = definition([...LIFECYCLE, "description", ...SCHEMA_KEYS], {
  properties: dict(schema),
  items: schema,
  oneOf: list(schema),
});

const schemaFile = definition([...LIFECYCLE, "description", ...SCHEMA_KEYS], {
  properties: dict(schema),
  items: schema,
  oneOf: list(schema),
});

const target = definition([
  "promotable",
  "description",
  "tag",
  "tags",
  "includeFeatures",
  "excludeFeatures",
  "includeVariables",
  "excludeVariables",
  "context",
  "schemaVersion",
]);

const CHECK_ORDER = [
  "feature",
  "segment",
  "variable",
  "key",
  "description",
  "path",
  "operator",
  "value",
  "compareTo",
  "regexFlags",
  "enabled",
  "variation",
  "matches",
];

const check = map(CHECK_ORDER);

const ASSERTION_ORDER = [
  "key",
  "description",
  "promotable",
  "matrix",
  "environment",
  "target",
  "at",
  "context",
  "stickyFeatures",
  "stickyVariables",
  "defaultVariationValue",
  "defaultVariableValues",
  "defaultVariableValue",
  "expectedToBeEnabled",
  "expectedToMatch",
  "expectedVariation",
  "expectedVariables",
  "expectedValue",
  "expectedEvaluations",
  "expectedEvaluation",
  "checks",
  "children",
];

const assertion = map(ASSERTION_ORDER);
(assertion as { children?: Record<string, Shape> }).children = {
  checks: list(check),
  // a blank line between assertions, as between rules
  children: list(assertion, { spaceItems: true }),
};

const test = definition(
  ["feature", "segment", "variable", "key", "promotable", "description", "assertions"],
  { assertions: list(assertion, { spaceItems: true }) },
);

const scenario = definition(["scenario", ...ASSERTION_ORDER], {
  checks: list(check),
  children: list(assertion, { spaceItems: true }),
});

const SHAPES: Record<EntityType, Shape> = {
  attribute,
  segment,
  feature,
  variable,
  schema: schemaFile,
  target,
  test,
  scenario,
};

function childShape(shape: Shape, segment: string | number): Shape {
  switch (shape.kind) {
    case "map":
      return typeof segment === "string" ? shape.children?.[segment] || VALUE : VALUE;
    case "dict":
      return typeof segment === "string" ? shape.value : VALUE;
    case "list":
      return typeof segment === "number" ? shape.item : VALUE;
    case "byEnvironment":
      // a list's item, or an environment's list
      return typeof segment === "number" ? shape.list.item : shape.list;
    default:
      return VALUE;
  }
}

function shapeAt(entityType: EntityType, path: FormatPath): Shape {
  let shape = SHAPES[entityType];
  for (const segment of path) {
    shape = childShape(shape, segment);
    if (shape.kind === "value") return shape;
  }
  return shape;
}

/** Known keys in house order, then any others in the order they were written. */
function orderedKeys(order: string[], keys: string[]): string[] {
  const known = new Set(order);
  return [...order.filter((key) => keys.includes(key)), ...keys.filter((key) => !known.has(key))];
}

export function getKeyOrder(
  entityType: EntityType,
  path: FormatPath,
  keys: string[],
): string[] | undefined {
  const shape = shapeAt(entityType, path);
  return shape.kind === "map" ? orderedKeys(shape.order, keys) : undefined;
}

/** Whether the map at `path` has a blank line between its entries */
export function isSpacedMap(entityType: EntityType, path: FormatPath): boolean {
  const shape = shapeAt(entityType, path);
  if (shape.kind === "map") return shape.spaceEntries;
  // the node at a byEnvironment path is a map only when it groups lists by environment
  if (shape.kind === "byEnvironment") return shape.spaceEnvironments;
  return false;
}

/** Whether the list at `path` has a blank line between its items */
export function isSpacedList(entityType: EntityType, path: FormatPath): boolean {
  const shape = shapeAt(entityType, path);
  if (shape.kind === "list") return shape.spaceItems;
  if (shape.kind === "byEnvironment") return shape.list.spaceItems;
  return false;
}

/** The layout a parser's `format` applies to one kind of definition. */
export function getFormatLayout(entityType: EntityType): FormatLayout {
  return {
    indent: INDENT,
    orderKeys: (path, keys) => getKeyOrder(entityType, path, keys),
    spaceEntries: (path) => isSpacedMap(entityType, path),
    spaceItems: (path) => isSpacedList(entityType, path),
    orderValue: <T>(value: T) => orderValue(entityType, value) as T,
  };
}

/** The key order applied to a parsed value, for parsers that write from values. */
export function orderValue(entityType: EntityType, value: unknown, path: FormatPath = []): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => orderValue(entityType, item, [...path, index]));
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const order = getKeyOrder(entityType, path, keys) || keys;
  const result: Record<string, unknown> = {};
  for (const key of order) {
    result[key] = orderValue(entityType, record[key], [...path, key]);
  }
  return result;
}
