import type { YmlLayout, YmlPath } from "@featurevisor/parsers";

/**
 * The house order of Featurevisor's own keys, and which lists get a blank line between items.
 *
 * Only objects the builder rebuilds key by key are ordered here, so formatting never changes
 * a datafile. Values stay as written: variable values, context, condition leaves, compose
 * references, and maps keyed by the author, such as variablesSchema or properties. Lists are
 * never reordered, because rules, overrides, variations, conditions and mutations depend on
 * their order.
 */

export type FormatEntityType =
  | "attribute"
  | "segment"
  | "feature"
  | "variable"
  | "schema"
  | "target"
  | "test"
  | "scenario";

type Shape =
  /** A map of Featurevisor's own keys, written in `order`, with known children */
  | { kind: "map"; order: string[]; children?: Record<string, Shape> }
  /** A map keyed by the author, each value of the same shape */
  | { kind: "dict"; value: Shape }
  | { kind: "list"; item: Shape; spaced?: boolean }
  /** A list, or a map of environments to lists */
  | { kind: "byEnvironment"; list: Extract<Shape, { kind: "list" }> }
  /** A value, left as written */
  | { kind: "value" };

const VALUE: Shape = { kind: "value" };

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

function map(order: string[], children?: Record<string, Shape>): Shape {
  return { kind: "map", order, children };
}

function list(item: Shape, spaced = false): Extract<Shape, { kind: "list" }> {
  return { kind: "list", item, spaced };
}

function dict(value: Shape): Shape {
  return { kind: "dict", value };
}

function byEnvironment(item: Shape, spaced = false): Shape {
  return { kind: "byEnvironment", list: list(item, spaced) };
}

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

const feature = map(
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
    rules: byEnvironment(rule, true),
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

const variable = map(
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

const segment = map([...LIFECYCLE, "description", "conditions"]);

const attribute = map([...LIFECYCLE, "description", ...SCHEMA_KEYS], {
  properties: dict(schema),
  items: schema,
  oneOf: list(schema),
});

const schemaFile = map([...LIFECYCLE, "description", ...SCHEMA_KEYS], {
  properties: dict(schema),
  items: schema,
  oneOf: list(schema),
});

const target = map([
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
  children: list(assertion, true),
};

const test = map(
  ["feature", "segment", "variable", "key", "promotable", "description", "assertions"],
  {
    assertions: list(assertion, true),
  },
);

const scenario = map(["scenario", ...ASSERTION_ORDER], {
  checks: list(check),
  children: list(assertion, true),
});

const SHAPES: Record<FormatEntityType, Shape> = {
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

function shapeAt(entityType: FormatEntityType, path: YmlPath): Shape {
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
  entityType: FormatEntityType,
  path: YmlPath,
  keys: string[],
): string[] | undefined {
  const shape = shapeAt(entityType, path);
  return shape.kind === "map" ? orderedKeys(shape.order, keys) : undefined;
}

export function isSpacedList(entityType: FormatEntityType, path: YmlPath): boolean {
  const shape = shapeAt(entityType, path);
  if (shape.kind === "list") return shape.spaced === true;
  if (shape.kind === "byEnvironment") return shape.list.spaced === true;
  return false;
}

export function getYmlLayout(entityType: FormatEntityType): YmlLayout {
  return {
    orderKeys: (path, keys) => getKeyOrder(entityType, path, keys),
    spaceItems: (path) => isSpacedList(entityType, path),
  };
}

/** The same key order for a parsed value, for JSON and custom parsers. */
export function orderValue(
  entityType: FormatEntityType,
  value: unknown,
  path: YmlPath = [],
): unknown {
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
