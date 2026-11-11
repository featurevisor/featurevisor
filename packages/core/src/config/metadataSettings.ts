import { DEADLINE_FIELDS, getDeadlineTypeError, isPlainObject, METADATA_KINDS } from "../metadata";

/**
 * A schema in `metadataSchema`. It has the keywords of reusable schemas, without `schema`
 * references. Its formats are those of reusable schemas, so a date is a `date-time` timestamp.
 */
export interface MetadataSchema {
  description?: string;
  type?: "boolean" | "string" | "integer" | "number" | "object" | "array";
  enum?: unknown[];
  const?: unknown;
  oneOf?: MetadataSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: "date-time" | "semver";
  items?: MetadataSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  required?: string[];
  properties?: Record<string, MetadataSchema>;
  additionalProperties?: MetadataSchema;
}

export const METADATA_SCHEMA_FORMATS = ["date-time", "semver"] as const;

const TYPES = ["boolean", "string", "integer", "number", "object", "array"];

const KEYWORDS = [
  "description",
  "type",
  "enum",
  "const",
  "oneOf",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "required",
  "properties",
  "additionalProperties",
];

/** What `properties.deadlines` may say */
const DEADLINES_KEYWORDS = [
  "type",
  "description",
  "properties",
  "required",
  "additionalProperties",
];

/** What each deadline type may say. Its own fields are each declared, so it has no additionalProperties */
const DEADLINE_TYPE_KEYWORDS = ["type", "description", "properties", "required"];

class MetadataSchemaError extends Error {}

function fail(path: string, message: string): never {
  throw new MetadataSchemaError(`Invalid ${path}: ${message}`);
}

function isCount(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function quoteList(values: string[]) {
  return values.map((value) => `"${value}"`).join(", ");
}

function matchesType(value: unknown, type: unknown) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    default:
      return true;
  }
}

function assertKeywords(schema: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(schema)) {
    if (!allowed.includes(key)) {
      fail(`${path}.${key}`, `unknown keyword. Expected one of ${quoteList(allowed)}.`);
    }
  }
}

function assertRequired(
  schema: Record<string, unknown>,
  path: string,
  declared: string[],
  describe = "declared in properties",
) {
  const required = schema.required;
  if (required === undefined) return;
  if (!Array.isArray(required) || required.some((name) => typeof name !== "string")) {
    fail(`${path}.required`, "expected a list of names.");
  }
  for (const name of required as string[]) {
    if (!declared.includes(name)) fail(`${path}.required`, `"${name}" is not ${describe}.`);
  }
}

/** A schema for any value in metadata, with the keywords of reusable schemas */
function assertValueSchema(schema: unknown, path: string, root = false): void {
  if (!isPlainObject(schema)) fail(path, "expected a schema object.");
  assertKeywords(schema, KEYWORDS, path);

  const { type } = schema;
  if (type !== undefined && !TYPES.includes(type as string)) {
    fail(`${path}.type`, `expected one of ${quoteList(TYPES)}.`);
  }
  if (root && type !== "object")
    fail(`${path}.type`, 'expected "object", since metadata is an object.');
  if (schema.description !== undefined && typeof schema.description !== "string") {
    fail(`${path}.description`, "expected a string.");
  }

  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      fail(`${path}.enum`, "expected a list of one or more values.");
    }
    schema.enum.forEach((value, index) => {
      if (!matchesType(value, type)) {
        fail(`${path}.enum[${index}]`, `${JSON.stringify(value)} is not of type "${type}".`);
      }
    });
  }
  if (schema.const !== undefined && !matchesType(schema.const, type)) {
    fail(`${path}.const`, `${JSON.stringify(schema.const)} is not of type "${type}".`);
  }

  if (schema.oneOf !== undefined) {
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length < 2) {
      fail(`${path}.oneOf`, "expected a list of two or more schemas.");
    }
    schema.oneOf.forEach((branch, index) => assertValueSchema(branch, `${path}.oneOf[${index}]`));
  }

  for (const name of ["minimum", "maximum"]) {
    if (schema[name] !== undefined && typeof schema[name] !== "number") {
      fail(`${path}.${name}`, "expected a number.");
    }
  }
  if (
    typeof schema.minimum === "number" &&
    typeof schema.maximum === "number" &&
    schema.minimum > schema.maximum
  ) {
    fail(`${path}.minimum`, "must not be greater than maximum.");
  }

  for (const [min, max] of [
    ["minLength", "maxLength"],
    ["minItems", "maxItems"],
  ]) {
    for (const name of [min, max]) {
      if (schema[name] !== undefined && !isCount(schema[name])) {
        fail(`${path}.${name}`, "expected a whole number of zero or more.");
      }
    }
    if (
      isCount(schema[min]) &&
      isCount(schema[max]) &&
      (schema[min] as number) > (schema[max] as number)
    ) {
      fail(`${path}.${min}`, `must not be greater than ${max}.`);
    }
  }

  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== "string") fail(`${path}.pattern`, "expected a string.");
    try {
      new RegExp(schema.pattern);
    } catch {
      fail(`${path}.pattern`, "expected a valid regular expression.");
    }
  }

  if (schema.format !== undefined) {
    if (schema.format === "date") {
      fail(
        `${path}.format`,
        'unsupported format "date". Use `format: date-time`, a timestamp with a timezone.',
      );
    }
    if (!(METADATA_SCHEMA_FORMATS as readonly string[]).includes(schema.format as string)) {
      fail(`${path}.format`, `expected one of ${quoteList([...METADATA_SCHEMA_FORMATS])}.`);
    }
    if (type !== "string") fail(`${path}.format`, 'format is only supported with type "string".');
  }

  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== "boolean") {
    fail(`${path}.uniqueItems`, "expected true or false.");
  }
  if (schema.items !== undefined) assertValueSchema(schema.items, `${path}.items`);
  if (type === "array" && schema.items === undefined) {
    fail(`${path}.items`, 'required when type is "array".');
  }

  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) fail(`${path}.properties`, "expected an object.");
    for (const [key, property] of Object.entries(schema.properties)) {
      if (root && key === "deadlines")
        assertDeadlinesSchema(property, `${path}.properties.deadlines`);
      else assertValueSchema(property, `${path}.properties.${key}`);
    }
  }
  if (schema.additionalProperties !== undefined) {
    assertValueSchema(schema.additionalProperties, `${path}.additionalProperties`);
  }

  const declared = Object.keys(isPlainObject(schema.properties) ? schema.properties : {});
  assertRequired(schema, path, root ? [...new Set([...declared, "owner", "deadlines"])] : declared);
}

/** What `properties.deadlines` and each deadline type share: an object with a description */
function assertObjectSchema(schema: unknown, path: string, keywords: string[], expected: string) {
  if (!isPlainObject(schema)) fail(path, expected);
  assertKeywords(schema, keywords, path);
  if (schema.type !== undefined && schema.type !== "object")
    fail(`${path}.type`, 'expected "object".');
  if (schema.description !== undefined && typeof schema.description !== "string") {
    fail(`${path}.description`, "expected a string.");
  }
  if (schema.properties !== undefined && !isPlainObject(schema.properties)) {
    fail(`${path}.properties`, "expected an object.");
  }
  return { schema, properties: (schema.properties ?? {}) as Record<string, unknown> };
}

/** One deadline type: a description, and fields of its own on top of Featurevisor's */
function assertDeadlineTypeSchema(value: unknown, path: string) {
  if (isPlainObject(value) && value.additionalProperties !== undefined) {
    fail(
      `${path}.additionalProperties`,
      "a deadline type declares each of its own fields in properties.",
    );
  }
  const { schema, properties } = assertObjectSchema(
    value,
    path,
    DEADLINE_TYPE_KEYWORDS,
    'expected a deadline type, such as { description: "…" }.',
  );
  for (const [field, property] of Object.entries(properties)) {
    if (DEADLINE_FIELDS.includes(field)) {
      fail(
        `${path}.properties.${field}`,
        `"${field}" is a field of every deadline, and its shape cannot change.`,
      );
    }
    assertValueSchema(property, `${path}.properties.${field}`);
  }
  const own = Object.keys(properties);
  if (Array.isArray(schema.required)) {
    for (const name of schema.required) {
      if (name === "by") fail(`${path}.required`, '"by" is always required.');
      if (name === "done")
        fail(`${path}.required`, '"done" cannot be required, or every deadline would be done.');
    }
  }
  assertRequired(
    schema,
    path,
    ["description", ...own],
    '"description" or a field declared in properties',
  );
}

/** `properties.deadlines`: the project's deadline types */
function assertDeadlinesSchema(value: unknown, path: string) {
  const { schema, properties } = assertObjectSchema(
    value,
    path,
    DEADLINES_KEYWORDS,
    "expected the project's deadline types.",
  );
  for (const [type, typeSchema] of Object.entries(properties)) {
    const error = getDeadlineTypeError(type);
    // Settings errors continue "Invalid <path>: ", so the sentence starts in lower case
    if (error) fail(`${path}.properties.${type}`, error.charAt(0).toLowerCase() + error.slice(1));
    assertDeadlineTypeSchema(typeSchema, `${path}.properties.${type}`);
  }
  if (schema.additionalProperties !== undefined) {
    assertDeadlineTypeSchema(schema.additionalProperties, `${path}.additionalProperties`);
  }
  assertRequired(schema, path, Object.keys(properties), "a deadline type declared in properties");
}

function assertRequireMetadataIn(value: unknown) {
  const name = "requireMetadataIn";
  if (!Array.isArray(value) || value.length === 0) {
    fail(
      name,
      `expected a list of ${quoteList([...METADATA_KINDS])}. Omit it when none is required.`,
    );
  }
  const seen = new Set<string>();
  for (const kind of value) {
    if (typeof kind !== "string" || !(METADATA_KINDS as readonly string[]).includes(kind)) {
      fail(name, `${JSON.stringify(kind)} is not one of ${quoteList([...METADATA_KINDS])}.`);
    }
    if (seen.has(kind)) fail(name, `duplicate kind "${kind}".`);
    seen.add(kind);
  }
}

/** Checks `metadataSchema` and `requireMetadataIn` when the configuration loads. */
export function assertMetadataSettings(config: {
  metadataSchema?: unknown;
  requireMetadataIn?: unknown;
}) {
  if (config.metadataSchema !== undefined) {
    assertValueSchema(config.metadataSchema, "metadataSchema", true);
  }
  if (config.requireMetadataIn !== undefined) assertRequireMetadataIn(config.requireMetadataIn);
}
