import { getMutationOrderChanges } from "../linter/mutationOrder";

/**
 * The v3 to v4 rewrites of parsed definitions. Each keeps what the definition means: selectors
 * convert as v4 SDKs read v3 datafiles, and mutation maps keep the values v3 resolved.
 */

export type Path = (string | number)[];
type Plain = Record<string, unknown>;

/** Keys a rewrite renamed, or merged into one, so a writer can keep their comments */
export interface Rename {
  path: Path;
  from: string[];
  to: string;
}

export interface Note {
  path: Path;
  message: string;
  /** The section of the v4 migration guide that explains it */
  section: string;
}

export class Migration {
  changes = new Set<string>();
  renames: Rename[] = [];
  notes: Note[] = [];

  change(name: string) {
    this.changes.add(name);
  }

  note(path: Path, message: string, section: string) {
    this.notes.push({ path, message, section });
  }
}

/** Attribute schemas by key, after their types are migrated */
export type Attributes = Record<string, unknown>;

/** A map, as parsers give them, but not a list or a date */
export function isPlain(value: unknown): value is Plain {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Equal as JSON, with keys in the same order, whatever objects a parser makes */
export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const has = (value: Plain, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Rebuilds an object with `key` replaced, or removed when `value` is undefined */
function withKey(value: Plain, key: string, next: unknown): Plain {
  const result: Plain = {};
  for (const [name, item] of Object.entries(value)) {
    if (name !== key) result[name] = item;
    else if (next !== undefined) result[name] = next;
  }
  return result;
}

// Types

const TYPES: Record<string, { type: string; format?: string }> = {
  double: { type: "number" },
  date: { type: "string", format: "date-time" },
  semver: { type: "string", format: "semver" },
};

/** `double`, `date` and `semver` become JSON Schema types, through every nested schema */
export function migrateSchema(schema: unknown, path: Path, migration: Migration): unknown {
  if (!isPlain(schema)) return schema;
  let result = schema;

  const target = typeof schema.type === "string" ? TYPES[schema.type] : undefined;
  if (target) {
    if (target.format && has(schema, "format") && schema.format !== target.format) {
      migration.note(
        [...path, "format"],
        `type: ${schema.type} becomes a string with format: ${target.format}, but the schema already has format: ${String(schema.format)}. Choose one.`,
        "attribute-and-schema-types",
      );
    } else {
      result = {};
      for (const [key, value] of Object.entries(schema)) {
        if (key === "format" && target.format) continue;
        result[key] = key === "type" ? target.type : value;
        if (key === "type" && target.format) result.format = target.format;
      }
      migration.change("types");
    }
  }

  if (isPlain(result.properties)) {
    const properties: Plain = {};
    for (const [key, value] of Object.entries(result.properties)) {
      properties[key] = migrateSchema(value, [...path, "properties", key], migration);
    }
    result = withKey(result, "properties", properties);
  }
  if (isPlain(result.items)) {
    result = withKey(result, "items", migrateSchema(result.items, [...path, "items"], migration));
  }
  if (Array.isArray(result.oneOf)) {
    const oneOf = result.oneOf.map((item, index) =>
      migrateSchema(item, [...path, "oneOf", index], migration),
    );
    result = withKey(result, "oneOf", oneOf);
  }
  return same(result, schema) ? schema : result;
}

// Selectors, as packages/sdk/src/normalize.ts reads them from v3 datafiles

/** v3 read an empty list or `and` group as everyone, where v4 reads it as no one */
function legacySegments(value: unknown, nested = false): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => legacySegments(item, true));
    if (items.length === 0) return "*";
    // a list inside a list is an AND, which v4 writes as a group
    return nested ? { and: items } : items;
  }
  if (!isPlain(value)) return value;
  if (Array.isArray(value.and)) {
    return value.and.length ? { and: value.and.map((item) => legacySegments(item, true)) } : "*";
  }
  if (Array.isArray(value.or)) return { or: value.or.map((item) => legacySegments(item, true)) };
  if (Array.isArray(value.not)) return { not: value.not.map((item) => legacySegments(item, true)) };
  return value;
}

/** A required feature becomes a feature condition. v3's `required` named it `key`. */
function legacyFeature(value: unknown): unknown {
  if (typeof value === "string") return { feature: value };
  if (!isPlain(value)) return value;
  if (Array.isArray(value.and))
    return value.and.length ? { and: value.and.map(legacyFeature) } : "*";
  if (Array.isArray(value.or)) return { or: value.or.map(legacyFeature) };
  if (Array.isArray(value.not)) return { not: value.not.map(legacyFeature) };
  if (!has(value, "feature") && typeof value.key === "string") {
    const { key, ...rest } = value;
    return { feature: key, ...rest };
  }
  return value;
}

const asList = (value: unknown) => (Array.isArray(value) ? value : [value]);

/**
 * `"*"` is only valid as a whole expression in v4. Inside an AND it changes nothing, so it is
 * dropped, and an OR holding it matches everyone.
 */
function tidy(conditions: unknown, path: Path, migration: Migration): unknown {
  const list = (items: unknown[]) => items.map((item) => tidy(item, path, migration));
  if (Array.isArray(conditions)) {
    const items = list(conditions).filter((item) => item !== "*");
    return items.length ? items : "*";
  }
  if (!isPlain(conditions)) return conditions;
  if (Array.isArray(conditions.and)) {
    const items = list(conditions.and).filter((item) => item !== "*");
    return items.length ? { and: items } : "*";
  }
  if (Array.isArray(conditions.or)) {
    const items = list(conditions.or);
    if (items.includes("*")) return "*";
    if (!items.length) {
      migration.note(
        path,
        "An empty `or` group never matches. Remove the selector or give it conditions.",
        "strings-are-segments",
      );
    }
    return { or: items };
  }
  if (Array.isArray(conditions.not)) {
    const items = list(conditions.not).filter((item) => item !== "*");
    if (!items.length) {
      migration.note(
        path,
        "This `not` group never matches. Remove the selector or give it conditions.",
        "strings-are-segments",
      );
      return conditions;
    }
    return { not: items };
  }
  return conditions;
}

const SELECTOR_KEYS = [
  "conditions",
  "segments",
  "requiredFeatures",
  "required",
  "requiredVariables",
];

type Location =
  | "feature"
  | "variable"
  | "rule"
  | "force"
  | "featureVariableOverride"
  | "variableOverride";

/**
 * Moves a selector's v3 fields into `conditions`, ANDed in the order v4 SDKs read them from a
 * v3 datafile: `conditions`, `segments`, then required features and variables. `conditions`
 * takes the place of the first of them.
 */
export function migrateSelector(
  entry: unknown,
  path: Path,
  location: Location,
  migration: Migration,
): unknown {
  if (!isPlain(entry)) return entry;
  // v3 named required features `required` at a feature's root only. Elsewhere, such as in a
  // global variable's schema, `required` lists object properties.
  const present = SELECTOR_KEYS.filter(
    (key) => has(entry, key) && (key !== "required" || location === "feature"),
  );
  const roots: Location[] = ["feature", "variable", "rule"];
  // v4 SDKs read v3 conditions on force entries and overrides as v3 read them
  const legacy = !roots.includes(location);

  if (present.length === 0) {
    if (location === "variableOverride") {
      // an override without a selector matched everyone, as v4 SDKs still read it
      migration.change("conditions");
      const result: Plain = {};
      if (has(entry, "key")) result.key = entry.key;
      return Object.assign(result, { conditions: "*" }, entry);
    }
    if (location !== "feature" && location !== "variable") {
      migration.note(
        path,
        "This selector has no conditions, so it never matches in v4. Give it `conditions`.",
        "unified-conditions",
      );
    }
    return entry;
  }

  const parts: unknown[] = [];
  if (has(entry, "conditions"))
    parts.push(legacy ? legacySegments(entry.conditions) : entry.conditions);
  if (has(entry, "segments")) parts.push(legacySegments(entry.segments));
  for (const key of ["requiredFeatures", "required"]) {
    if (!has(entry, key)) continue;
    const features = asList(entry[key]);
    if (features.length) parts.push(features.map(legacyFeature));
  }
  if (has(entry, "requiredVariables")) {
    const variables = asList(entry.requiredVariables);
    if (variables.length) parts.push(variables);
  }

  let conditions: unknown;
  if (parts.length === 0) conditions = "*";
  else if (parts.length === 1) conditions = parts[0];
  else conditions = parts.flatMap((part) => (Array.isArray(part) ? part : [part]));
  conditions = tidy(conditions, [...path, "conditions"], migration);

  if (present.length === 1 && present[0] === "conditions" && same(conditions, entry.conditions)) {
    return entry;
  }

  const result: Plain = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!present.includes(key)) result[key] = value;
    else if (!has(result, "conditions")) result.conditions = conditions;
  }
  migration.change("conditions");
  migration.renames.push({ path, from: present, to: "conditions" });
  if (present.includes("required")) {
    migration.note(
      [...path, "required"],
      "v4 SDKs ignore `required` in datafiles the v3 CLI built. Publish datafiles built with `requiredFeatures` by the v3 CLI before upgrading SDKs.",
      "prepare-while-still-on-v3",
    );
  }
  return result;
}

/** Each entry of a list, or of a map of environments to lists */
function eachEntry(value: unknown, path: Path, migrate: (entry: unknown, path: Path) => unknown) {
  if (Array.isArray(value)) return value.map((entry, index) => migrate(entry, [...path, index]));
  if (!isPlain(value)) return value;
  const result: Plain = {};
  for (const [environment, entries] of Object.entries(value)) {
    result[environment] = Array.isArray(entries)
      ? entries.map((entry, index) => migrate(entry, [...path, environment, index]))
      : entries;
  }
  return result;
}

// Conditions that v4 lint rejects for an attribute's type

const DATE_OPERATORS = ["before", "after", "exists", "notExists", "isNull", "notNull"];

function attributeSchema(attributes: Attributes, name: string): unknown {
  const [key, ...properties] = name.split(".");
  let schema = attributes[key];
  for (const property of properties) {
    schema =
      isPlain(schema) && isPlain(schema.properties) ? schema.properties[property] : undefined;
  }
  return schema;
}

/** Whether every value the schema allows is a number or a boolean */
function isNotString(schema: unknown): boolean {
  if (!isPlain(schema)) return false;
  if (Array.isArray(schema.oneOf))
    return schema.oneOf.length > 0 && schema.oneOf.every(isNotString);
  return ["integer", "number", "boolean"].includes(schema.type as string);
}

/** `in` and `notIn` on numbers become `equals` groups, and date comparisons are reported */
export function migrateConditions(
  conditions: unknown,
  path: Path,
  attributes: Attributes,
  migration: Migration,
): unknown {
  if (Array.isArray(conditions)) {
    return conditions.map((item, index) =>
      migrateConditions(item, [...path, index], attributes, migration),
    );
  }
  if (!isPlain(conditions)) return conditions;
  for (const group of ["and", "or", "not"]) {
    if (Array.isArray(conditions[group])) {
      return withKey(
        conditions,
        group,
        migrateConditions(conditions[group], [...path, group], attributes, migration),
      );
    }
  }
  if (typeof conditions.attribute !== "string") return conditions;

  const schema = attributeSchema(attributes, conditions.attribute);
  const { operator } = conditions;
  if (
    isPlain(schema) &&
    schema.format === "date-time" &&
    !DATE_OPERATORS.includes(operator as string)
  ) {
    migration.note(
      path,
      `${conditions.attribute} holds a timestamp, which v4 compares with before and after only. Rewrite \`${String(operator)}\` for what you meant.`,
      "date-attribute-comparisons",
    );
  }
  if ((operator === "in" || operator === "notIn") && isNotString(schema)) {
    if (!Array.isArray(conditions.value) || conditions.value.length === 0) {
      migration.note(
        path,
        `\`${operator}\` with no values needs rewriting by hand.`,
        "string-membership-conditions",
      );
      return conditions;
    }
    const equals = conditions.value.map((value) => ({
      attribute: conditions.attribute,
      operator: "equals",
      value,
    }));
    migration.change("operators");
    return operator === "in" ? { or: equals } : { not: [{ or: equals }] };
  }
  return conditions;
}

/** A selector moved into `conditions`, with those conditions migrated */
function migrateWhole(
  entry: unknown,
  path: Path,
  location: Location,
  attributes: Attributes,
  migration: Migration,
): unknown {
  const result = migrateSelector(entry, path, location, migration);
  if (!isPlain(result) || !has(result, "conditions")) return result;
  const conditions = migrateConditions(
    result.conditions,
    [...path, "conditions"],
    attributes,
    migration,
  );
  return same(conditions, result.conditions) ? result : withKey(result, "conditions", conditions);
}

function migrateVariableOverrides(
  entry: unknown,
  path: Path,
  attributes: Attributes,
  migration: Migration,
) {
  if (!isPlain(entry) || !isPlain(entry.variableOverrides)) return entry;
  const overrides: Plain = {};
  for (const [variable, list] of Object.entries(entry.variableOverrides)) {
    overrides[variable] = Array.isArray(list)
      ? list.map((override, index) =>
          migrateWhole(
            override,
            [...path, "variableOverrides", variable, index],
            "featureVariableOverride",
            attributes,
            migration,
          ),
        )
      : list;
  }
  return withKey(entry, "variableOverrides", overrides);
}

// Definitions

export function migrateAttribute(value: unknown, migration: Migration): unknown {
  return migrateSchema(value, [], migration);
}

export function migrateSegment(
  value: unknown,
  attributes: Attributes,
  migration: Migration,
): unknown {
  if (!isPlain(value) || !has(value, "conditions")) return value;
  const legacy = tidy(legacySegments(value.conditions), ["conditions"], migration);
  if (!same(legacy, value.conditions)) migration.change("conditions");
  const conditions = migrateConditions(legacy, ["conditions"], attributes, migration);
  return same(conditions, value.conditions) ? value : withKey(value, "conditions", conditions);
}

export function migrateFeature(
  value: unknown,
  attributes: Attributes,
  migration: Migration,
): unknown {
  if (!isPlain(value)) return value;
  const whole = (location: Location) => (entry: unknown, path: Path) =>
    migrateWhole(entry, path, location, attributes, migration);

  let feature = whole("feature")(value, []) as Plain;
  if (isPlain(feature.variablesSchema)) {
    const schema: Plain = {};
    for (const [key, item] of Object.entries(feature.variablesSchema)) {
      schema[key] = migrateSchema(item, ["variablesSchema", key], migration);
    }
    feature = withKey(feature, "variablesSchema", schema);
  }
  if (has(feature, "rules")) {
    const rules = eachEntry(feature.rules, ["rules"], (rule, path) =>
      migrateVariableOverrides(whole("rule")(rule, path), path, attributes, migration),
    );
    feature = withKey(feature, "rules", rules);
  }
  if (has(feature, "force")) {
    feature = withKey(feature, "force", eachEntry(feature.force, ["force"], whole("force")));
  }
  if (Array.isArray(feature.variations)) {
    const variations = feature.variations.map((variation, index) =>
      migrateVariableOverrides(variation, ["variations", index], attributes, migration),
    );
    feature = withKey(feature, "variations", variations);
  }
  return keepMutationOrder(feature, migration);
}

/** Puts each mutation map whose v4 result differs from v3's in the order v3 applied it */
function keepMutationOrder(feature: Plain, migration: Migration): Plain {
  let changes: { path: Path }[];
  try {
    changes = getMutationOrderChanges(feature as never);
  } catch {
    return feature;
  }
  let result = feature;
  for (const { path } of changes) {
    result = updateAt(result, path, (map) => {
      if (!isPlain(map)) return map;
      // v3 applied the shortest paths first
      return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.length - b.length));
    }) as Plain;
    migration.change("mutation order");
  }
  return result;
}

function updateAt(value: unknown, path: Path, update: (value: unknown) => unknown): unknown {
  if (path.length === 0) return update(value);
  const [key, ...rest] = path;
  if (Array.isArray(value) && typeof key === "number") {
    return value.map((item, index) => (index === key ? updateAt(item, rest, update) : item));
  }
  if (isPlain(value) && typeof key === "string" && has(value, key)) {
    return withKey(value, key, updateAt(value[key], rest, update));
  }
  return value;
}

export function migrateVariable(
  value: unknown,
  attributes: Attributes,
  migration: Migration,
): unknown {
  if (!isPlain(value)) return value;
  let variable = migrateSchema(value, [], migration) as Plain;
  variable = migrateWhole(variable, [], "variable", attributes, migration) as Plain;
  if (has(variable, "overrides")) {
    const override = (entry: unknown, path: Path): unknown => {
      let result = migrateWhole(entry, path, "variableOverride", attributes, migration);
      if (isPlain(result) && has(result, "overrides")) {
        result = withKey(
          result,
          "overrides",
          eachEntry(result.overrides, [...path, "overrides"], override),
        );
      }
      return result;
    };
    variable = withKey(
      variable,
      "overrides",
      eachEntry(variable.overrides, ["overrides"], override),
    );
  }
  return variable;
}

const REMOVED_REASONS = ["required", "required_features_unmet"];

/** An expected evaluation's removed reasons and fields */
function migrateEvaluation(evaluation: unknown, path: Path, migration: Migration): unknown {
  if (!isPlain(evaluation)) return evaluation;
  let result = evaluation;
  if (REMOVED_REASONS.includes(result.reason as string)) {
    result = withKey(result, "reason", "conditions_unmet");
    migration.change("evaluations");
  }
  for (const key of ["requiredFeatures", "requiredVariables"]) {
    if (!has(result, key)) continue;
    result = withKey(result, key, undefined);
    migration.change("evaluations");
    migration.note(
      [...path, key],
      `Removed \`${key}\` from this expected evaluation. v4 evaluations have no such field, and \`reason: conditions_unmet\` covers an unmet dependency.`,
      "evaluation-details-and-tests",
    );
  }
  return result;
}

function migrateAssertion(
  assertion: unknown,
  path: Path,
  feature: boolean,
  migration: Migration,
): unknown {
  if (!isPlain(assertion)) return assertion;
  let result = assertion;

  if (feature && has(result, "sticky")) {
    if (has(result, "stickyFeatures")) {
      migration.note(
        [...path, "sticky"],
        "This assertion has both `sticky` and `stickyFeatures`. Merge them into `stickyFeatures`.",
        "sticky-values-in-feature-specs",
      );
    } else {
      const renamed: Plain = {};
      for (const [key, value] of Object.entries(result))
        renamed[key === "sticky" ? "stickyFeatures" : key] = value;
      result = renamed;
      migration.change("stickyFeatures");
      migration.renames.push({ path, from: ["sticky"], to: "stickyFeatures" });
    }
  }
  if (has(result, "expectedEvaluation")) {
    result = withKey(
      result,
      "expectedEvaluation",
      migrateEvaluation(result.expectedEvaluation, [...path, "expectedEvaluation"], migration),
    );
  }
  if (isPlain(result.expectedEvaluations)) {
    const evaluations: Plain = {};
    for (const [kind, evaluation] of Object.entries(result.expectedEvaluations)) {
      const at = [...path, "expectedEvaluations", kind];
      if (kind === "variables" && isPlain(evaluation)) {
        const variables: Plain = {};
        for (const [key, item] of Object.entries(evaluation))
          variables[key] = migrateEvaluation(item, [...at, key], migration);
        evaluations[kind] = variables;
      } else {
        evaluations[kind] = migrateEvaluation(evaluation, at, migration);
      }
    }
    result = withKey(result, "expectedEvaluations", evaluations);
  }
  if (Array.isArray(result.children)) {
    const children = result.children.map((child, index) =>
      migrateAssertion(child, [...path, "children", index], feature, migration),
    );
    result = withKey(result, "children", children);
  }
  return same(result, assertion) ? assertion : result;
}

export function migrateTest(value: unknown, migration: Migration): unknown {
  if (!isPlain(value) || !Array.isArray(value.assertions)) return value;
  const feature = typeof value.feature === "string";
  const assertions = value.assertions.map((assertion, index) =>
    migrateAssertion(assertion, ["assertions", index], feature, migration),
  );
  return same(assertions, value.assertions) ? value : withKey(value, "assertions", assertions);
}
