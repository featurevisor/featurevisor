import { z } from "zod";
import { isValidVersion } from "@featurevisor/sdk";
import type { MetadataKind } from "@featurevisor/types";

import type { ProjectConfig } from "../config";
import { DEADLINE_FIELDS } from "../config/metadataSettings";
import type { MetadataSchema } from "../config/metadataSettings";
import {
  getDeadlineTimestamp,
  isCalendarDate,
  isDeadlineDate,
  isDeadlineType,
  isPlainObject,
  toMetadataJson,
} from "../metadata";
import { suggestKey } from "./diagnostics";

export type MetadataIssueCode = "invalid_metadata" | "metadata_schema";

export interface MetadataIssue {
  code: MetadataIssueCode;
  message: string;
  path: (string | number)[];
}

type Path = (string | number)[];

const DATE_EXAMPLE = "2027-01-15";

function quote(value: unknown) {
  return JSON.stringify(value);
}

/** "a", "b" or "c" */
function choices(values: unknown[]) {
  const quoted = values.map(quote);
  return quoted.length > 1
    ? `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`
    : (quoted[0] ?? "");
}

/** "a", "b" and "c" */
function all(values: unknown[]) {
  const quoted = values.map(quote);
  return quoted.length > 1
    ? `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`
    : (quoted[0] ?? "");
}

function describeType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "an object";
  if (typeof value === "string") return "a string";
  if (typeof value === "boolean") return "true or false";
  return "a number";
}

const TYPE_NAMES: Record<string, string> = {
  string: "a string",
  boolean: "true or false",
  integer: "a whole number",
  number: "a number",
  object: "an object",
  array: "a list",
};

/** The paths of values with no JSON form, which JSON would drop or change */
function findValuesWithoutJson(value: unknown, path: Path, found: Path[]) {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint" ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    found.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findValuesWithoutJson(item, [...path, index], found));
    return;
  }
  // A date, from TOML or JavaScript, has a JSON form of its own
  if (value && typeof value === "object" && typeof (value as any).toJSON !== "function") {
    for (const [key, item] of Object.entries(value)) {
      findValuesWithoutJson(item, [...path, key], found);
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameKeysEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameKeysEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(
        (key) => Object.prototype.hasOwnProperty.call(b, key) && sameKeysEqual(a[key], b[key]),
      )
    );
  }
  return deepEqual(a, b);
}

function matchesFormat(format: string, value: string) {
  if (format === "date") return isCalendarDate(value);
  if (format === "date-time") return getDeadlineTimestamp(value) !== null;
  if (format === "semver") return isValidVersion(value);
  return true;
}

const FORMAT_MESSAGES: Record<string, string> = {
  date: `Expected a date such as ${DATE_EXAMPLE}.`,
  "date-time": `Expected a timestamp with a timezone, such as ${DATE_EXAMPLE}T09:00:00Z.`,
  semver: "Expected a version such as 5.5.0.",
};

/** Checks one value against a schema in `metadataSchema`. A schema without a type takes any value. */
function checkValue(
  schema: MetadataSchema,
  value: unknown,
  path: Path,
  issues: MetadataIssue[],
): void {
  const report = (message: string, at: Path = path) =>
    issues.push({ code: "metadata_schema", message, path: at });

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((branch) => {
      const found: MetadataIssue[] = [];
      checkValue(branch, value, path, found);
      return found.length === 0;
    }).length;
    if (matches !== 1) report("Expected a value matching exactly one of the schemas in `oneOf`.");
    return;
  }
  if (schema.const !== undefined && !sameKeysEqual(value, schema.const)) {
    report(`Expected ${quote(schema.const)}.`);
    return;
  }
  if (schema.enum && !schema.enum.some((option) => sameKeysEqual(value, option))) {
    const names = schema.enum.filter((option): option is string => typeof option === "string");
    const suggestion = typeof value === "string" ? suggestKey(value, names) : "";
    report(`Expected ${choices(schema.enum)}.${suggestion}`);
    return;
  }

  const type = schema.type;
  if (!type) return;

  const typeMatches =
    type === "string"
      ? typeof value === "string"
      : type === "boolean"
        ? typeof value === "boolean"
        : type === "integer"
          ? typeof value === "number" && Number.isInteger(value)
          : type === "number"
            ? typeof value === "number"
            : type === "array"
              ? Array.isArray(value)
              : isPlainObject(value);
  if (!typeMatches) {
    report(`Expected ${TYPE_NAMES[type]}, but got ${describeType(value)}.`);
    return;
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      report(`Expected at least ${schema.minLength} characters.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      report(`Expected at most ${schema.maxLength} characters.`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      report(`Expected a value matching /${schema.pattern}/.`);
    }
    if (schema.format && !matchesFormat(schema.format, value)) {
      report(FORMAT_MESSAGES[schema.format]);
    }
    return;
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      report(`Expected ${schema.minimum} or more.`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      report(`Expected ${schema.maximum} or less.`);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      report(`Expected at least ${schema.minItems} ${schema.minItems === 1 ? "item" : "items"}.`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      report(`Expected at most ${schema.maxItems} ${schema.maxItems === 1 ? "item" : "items"}.`);
    }
    if (
      schema.uniqueItems &&
      value.some((item, index) => value.findIndex((other) => sameKeysEqual(item, other)) !== index)
    ) {
      report("Expected every item to be different.");
    }
    if (schema.items) {
      value.forEach((item, index) => checkValue(schema.items!, item, [...path, index], issues));
    }
    return;
  }

  if (isPlainObject(value)) checkObject(schema, value, path, issues);
}

/** Declared properties close an object, as in every Featurevisor schema */
function checkObject(
  schema: MetadataSchema,
  value: Record<string, unknown>,
  path: Path,
  issues: MetadataIssue[],
  skip: string[] = [],
) {
  const properties = schema.properties || {};
  const declared = Object.keys(properties);
  for (const name of schema.required || []) {
    if (!skip.includes(name) && !Object.prototype.hasOwnProperty.call(value, name)) {
      issues.push({
        code: "metadata_schema",
        message:
          path.length === 0
            ? `Missing \`${name}\`, which this project's metadataSchema requires.`
            : `Missing ${quote(name)}.`,
        path: [...path, name],
      });
    }
  }
  for (const [key, item] of Object.entries(value)) {
    if (skip.includes(key)) continue;
    const property = properties[key] ?? schema.additionalProperties;
    if (property) {
      checkValue(property, item, [...path, key], issues);
    } else if (declared.length > 0) {
      issues.push({
        code: "metadata_schema",
        message:
          path.length === 0
            ? `Unknown metadata key ${quote(key)}. This project's metadataSchema does not declare it.${suggestKey(key, declared)}`
            : `Unknown key ${quote(key)}.${suggestKey(key, declared)}`,
        path: [...path, key],
      });
    }
  }
}

function checkOwner(owner: unknown, schema: MetadataSchema | undefined, issues: MetadataIssue[]) {
  const names = Array.isArray(owner) ? owner : [owner];
  const valid =
    names.length > 0 &&
    names.every((name) => typeof name === "string" && name.trim() !== "") &&
    (typeof owner === "string" || Array.isArray(owner));
  if (!valid) {
    issues.push({
      code: "invalid_metadata",
      message: "Expected `owner` to be a name, or a list of one or more names.",
      path: ["owner"],
    });
    return;
  }
  if (Array.isArray(owner) && new Set(owner).size !== owner.length) {
    issues.push({
      code: "invalid_metadata",
      message: "Expected every owner to be different.",
      path: ["owner"],
    });
  }
  const ownerSchema = schema?.properties?.owner;
  if (!ownerSchema) return;
  if (Array.isArray(owner) && ownerSchema.type !== "array") {
    owner.forEach((name, index) => checkValue(ownerSchema, name, ["owner", index], issues));
  } else {
    checkValue(ownerSchema, owner, ["owner"], issues);
  }
}

function checkDeadline(
  type: string,
  deadline: unknown,
  typeSchema: MetadataSchema | undefined,
  issues: MetadataIssue[],
) {
  const path = ["deadlines", type];
  const invalid = (message: string, at: Path = path) =>
    issues.push({ code: "invalid_metadata", message, path: at });

  if (!isPlainObject(deadline)) {
    invalid(`Expected a deadline, such as { by: ${DATE_EXAMPLE} }.`);
    return;
  }

  if (deadline.by === undefined) {
    invalid(`Missing \`by\`, the date the deadline is due, such as ${DATE_EXAMPLE}.`, [
      ...path,
      "by",
    ]);
  } else if (!isDeadlineDate(deadline.by)) {
    invalid(
      `Expected a date such as ${DATE_EXAMPLE}, or a timestamp with a timezone such as ${DATE_EXAMPLE}T09:00:00Z.`,
      [...path, "by"],
    );
  }

  if (
    deadline.done !== undefined &&
    typeof deadline.done !== "boolean" &&
    !isDeadlineDate(deadline.done)
  ) {
    invalid(`Expected true or false, or the date it was done, such as ${DATE_EXAMPLE}.`, [
      ...path,
      "done",
    ]);
  }

  if (
    deadline.description !== undefined &&
    (typeof deadline.description !== "string" || deadline.description.trim() === "")
  ) {
    invalid("Expected a description in words.", [...path, "description"]);
  }

  const own = Object.keys(typeSchema?.properties || {});
  for (const [field, value] of Object.entries(deadline)) {
    if (DEADLINE_FIELDS.includes(field)) continue;
    const fieldSchema = typeSchema?.properties?.[field];
    if (fieldSchema) {
      checkValue(fieldSchema, value, [...path, field], issues);
      continue;
    }
    const also = own.length ? `, and ${quote(type)} deadlines also have ${all(own)}` : "";
    const suggestion = suggestKey(field, [...DEADLINE_FIELDS, ...own]);
    invalid(
      `Unknown field ${quote(field)}. A deadline has \`by\`, \`done\` and \`description\`${also}.${suggestion || " Declare any other field for its type in metadataSchema."}`,
      [...path, field],
    );
  }

  for (const field of typeSchema?.required || []) {
    if (!Object.prototype.hasOwnProperty.call(deadline, field)) {
      issues.push({
        code: "metadata_schema",
        message: `Missing ${quote(field)}, which ${quote(type)} deadlines require.`,
        path: [...path, field],
      });
    }
  }
}

function checkDeadlines(
  deadlines: unknown,
  schema: MetadataSchema | undefined,
  issues: MetadataIssue[],
) {
  if (!isPlainObject(deadlines) || Object.keys(deadlines).length === 0) {
    issues.push({
      code: "invalid_metadata",
      message: `Expected \`deadlines\` to map each deadline type to its deadline, such as review: { by: ${DATE_EXAMPLE} }.`,
      path: ["deadlines"],
    });
    return;
  }

  const typesSchema = schema?.properties?.deadlines;
  const declared = Object.keys(typesSchema?.properties || {});

  for (const [type, deadline] of Object.entries(deadlines)) {
    if (!isDeadlineType(type)) {
      issues.push({
        code: "invalid_metadata",
        message: /^[A-Za-z][A-Za-z0-9_-]*$/.test(type)
          ? `${quote(type)} is a deadline status, so it cannot name a deadline type.`
          : "A deadline type starts with a letter, and has only letters, digits, _ and -.",
        path: ["deadlines", type],
      });
      continue;
    }
    const typeSchema = typesSchema?.properties?.[type] ?? typesSchema?.additionalProperties;
    if (typesSchema && !typeSchema && declared.length > 0) {
      issues.push({
        code: "metadata_schema",
        message: `Unknown deadline type ${quote(type)}. This project allows ${all(declared)}.${suggestKey(type, declared)}`,
        path: ["deadlines", type],
      });
      continue;
    }
    checkDeadline(type, deadline, typeSchema, issues);
  }

  for (const type of typesSchema?.required || []) {
    if (!Object.prototype.hasOwnProperty.call(deadlines, type)) {
      issues.push({
        code: "metadata_schema",
        message: `Missing a ${quote(type)} deadline, which this project requires.`,
        path: ["deadlines", type],
      });
    }
  }
}

/** Every problem with one definition's `metadata`, with paths inside it */
export function lintMetadata(value: unknown, schema?: MetadataSchema): MetadataIssue[] {
  const issues: MetadataIssue[] = [];

  const withoutJson: Path[] = [];
  findValuesWithoutJson(value, [], withoutJson);
  for (const path of withoutJson) {
    issues.push({
      code: "invalid_metadata",
      message: "Expected a JSON value. Functions, undefined, NaN and Infinity have no JSON form.",
      path,
    });
  }
  if (issues.length > 0) return issues;

  const json = toMetadataJson(value);
  if (!isPlainObject(json)) {
    issues.push({
      code: "invalid_metadata",
      message: "Expected `metadata` to be an object of keys and values.",
      path: [],
    });
    return issues;
  }

  if (json.owner !== undefined) checkOwner(json.owner, schema, issues);
  if (json.deadlines !== undefined) checkDeadlines(json.deadlines, schema, issues);
  if (schema) checkObject(schema, json, [], issues, ["owner", "deadlines"]);
  for (const name of schema?.required || []) {
    if (["owner", "deadlines"].includes(name) && json[name] === undefined) {
      issues.push({
        code: "metadata_schema",
        message: `Missing \`${name}\`, which this project's metadataSchema requires.`,
        path: [name],
      });
    }
  }

  return issues;
}

/** The `metadata` key of every kind of definition */
export function getMetadataZodSchema(projectConfig: ProjectConfig) {
  return z.unknown().superRefine((value, ctx) => {
    for (const issue of lintMetadata(value, projectConfig.metadataSchema)) {
      ctx.addIssue({
        code: "custom",
        message: issue.message,
        path: issue.path,
        params: { code: issue.code },
      });
    }
  });
}

/** Lets the check below run even when other fields of the definition fail, so each one is reported */
export const ALWAYS = { when: () => true };

/**
 * Reports a definition without `metadata` when `requireMetadataIn` lists its kind. Pass ALWAYS
 * with it to `superRefine`.
 */
export function refineRequiredMetadata(projectConfig: ProjectConfig, kind: MetadataKind) {
  const required = (projectConfig.requireMetadataIn || []).includes(kind);
  return (value: unknown, ctx: z.RefinementCtx) => {
    if (!required || !isPlainObject(value) || value.archived === true) return;
    if (value.metadata !== undefined) return;
    ctx.addIssue({
      code: "custom",
      message: `Missing metadata, which this project requires on ${kind}.`,
      path: ["metadata"],
      params: { code: "missing_metadata" },
    });
  };
}
