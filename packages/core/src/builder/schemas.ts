import type {
  Conditions,
  DatafileSchema,
  Schema,
  SchemaIssueEntry,
  SchemaMutation,
  VariableMutationOperation,
  VariableMutations,
} from "@featurevisor/types";
import { applyVariableOperations } from "@featurevisor/sdk";

import { compileConditions } from "../datasource/conditions";
import { visitConditionLocations } from "../datasource/conditionLocations";
import { getSchemaReferences } from "../targeting";
import { resolveForEnvironment } from "./environments";
import { generateHashFromString } from "./hashes";
import { mutationEntries } from "./mutationEntries";
import { compileVariableMutation } from "./variableOverrideProgram";

/** Fields for maintainers, never delivered at any depth. */
const MAINTAINER_FIELDS = ["description", "promotable"];
/**
 * Fields only a schema's root has, never delivered. The vocabularies never
 * reach a datafile, since lint has checked every annotation against them.
 */
const ROOT_ONLY_FIELDS = ["metadata", "tags", "annotationsSchema", "optionSchema"];

/**
 * The order a datafile writes a schema's keys in, whatever order its file has,
 * with any others after them in sorted order. Formatting a schema file then
 * never changes a datafile or a schema's `hash`, as fmt promises. It is the
 * builder's own, kept apart from fmt's house style, which may change freely.
 */
const DATAFILE_KEY_ORDER = [
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
  "messages",
  "annotations",
  "mutations",
  "issues",
];

function datafileKeys(node: Record<string, unknown>): string[] {
  const keys = Object.keys(node);
  return [
    ...DATAFILE_KEY_ORDER.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !DATAFILE_KEY_ORDER.includes(key)).sort(),
  ];
}

export interface DatafileSchemaOptions {
  /** False leaves `annotations` out at every depth, for a target that only serves a backend. */
  annotations?: boolean;
  /** Writes mutations' conditions as JSON text, as features' are with the project's `stringify`. */
  stringify?: boolean;
}

/** A `mutate` map or list compiled into the operations the SDK applies, in order. */
export function compileMutate(mutate: VariableMutations): VariableMutationOperation[] {
  return mutationEntries(mutate).map(([key, value]) => compileVariableMutation(key, value));
}

/**
 * A schema as one environment has it: its root's mutations for that
 * environment, inherited as rules are, so an environment without a list uses
 * the one it inherits from and `[]` means none. A schema whose root lists its
 * mutations, or has none, is the same in every environment.
 */
export function resolveSchemaEnvironment(
  schema: Schema,
  environment: string | false | undefined,
  config: Parameters<typeof resolveForEnvironment>[2],
): Schema {
  const byEnvironment = schema && typeof schema === "object" ? schema.mutations : undefined;
  if (!byEnvironment || typeof byEnvironment !== "object" || Array.isArray(byEnvironment))
    return schema;
  const base: Schema = { ...schema };
  delete base.mutations;
  const list =
    typeof environment === "string"
      ? resolveForEnvironment(byEnvironment, environment, config).value
      : undefined;
  return Array.isArray(list) && list.length > 0 ? { ...base, mutations: list } : base;
}

/**
 * A node with the mutations that always apply, those whose conditions are `*`
 * before any whose conditions can fail, applied to its rules, so a datafile
 * holds the changed rules and handles read them as the base. The rest stay
 * mutations, applied in order when a value is validated.
 */
export function applyAlwaysMutations<T>(node: T): T {
  const record = node as Record<string, unknown> | undefined;
  const mutations =
    record && typeof record === "object" && Array.isArray(record.mutations)
      ? (record.mutations as SchemaMutation[])
      : undefined;
  if (!mutations) return node;
  let count = 0;
  while (count < mutations.length && mutations[count]?.conditions === "*") count++;
  if (count === 0) return node;
  const base: Record<string, unknown> = { ...record };
  delete base.mutations;
  let rules: unknown = base;
  for (const mutation of mutations.slice(0, count))
    rules = applyVariableOperations(rules as never, compileMutate(mutation.mutate));
  const rest = mutations.slice(count);
  return (rest.length > 0 ? { ...(rules as object), mutations: rest } : rules) as T;
}

/** Every `conditions` a schema's mutations hold, at any node. */
export function getSchemaConditions(schema: unknown): Conditions[] {
  const found: Conditions[] = [];
  visitConditionLocations("schema", schema, (_location, conditions) => {
    if (conditions !== undefined) found.push(conditions as Conditions);
  });
  return found;
}

function stripNode(node: unknown, options: DatafileSchemaOptions): unknown {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((item) => stripNode(item, options));
  node = applyAlwaysMutations(node);
  const result: Record<string, unknown> = {};
  const record = node as Record<string, unknown>;
  for (const key of datafileKeys(record)) {
    const value = record[key];
    if (MAINTAINER_FIELDS.includes(key)) continue;
    if (key === "annotations" && options.annotations === false) continue;
    if (key === "mutations" && Array.isArray(value)) {
      // Compiled, as variable overrides are, so applications apply operations and parse no notation.
      result[key] = (value as SchemaMutation[]).map((mutation) => ({
        key: mutation.key,
        conditions: compileConditions(mutation.conditions, options.stringify),
        operations: compileMutate(mutation.mutate).map((operation) =>
          "value" in operation
            ? { ...operation, value: stripNode(operation.value, options) }
            : operation,
        ),
      }));
    } else if (key === "issues" && Array.isArray(value)) {
      // Conditions written as features' are, and no maintainer's description.
      result[key] = (value as SchemaIssueEntry[]).map((entry) => ({
        key: entry.key,
        conditions: compileConditions(entry.conditions, options.stringify),
        ...(entry.path !== undefined ? { path: entry.path } : {}),
        message: entry.message,
      }));
    } else if (key === "items" || key === "additionalProperties")
      result[key] = stripNode(value, options);
    else if (key === "oneOf")
      result[key] = (value as unknown[]).map((branch) => stripNode(branch, options));
    else if (key === "properties" && value && typeof value === "object")
      result[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, property]) => [
          name,
          stripNode(property, options),
        ]),
      );
    else result[key] = value;
  }
  return result;
}

/**
 * A schema as a datafile carries it: rules, `schema` references, `messages`
 * and `annotations` as authored, without `description`, `promotable`,
 * `metadata`, `tags` and the vocabularies.
 */
export function toDatafileSchema(
  schema: Schema,
  options: DatafileSchemaOptions = {},
): DatafileSchema {
  const stripped = stripNode(schema, options) as Record<string, unknown>;
  for (const field of ROOT_ONLY_FIELDS) delete stripped[field];
  return stripped as DatafileSchema;
}

/**
 * The `schemas` section of a datafile, for keys a target delivers along with
 * every schema they reference. Each entry's `hash` covers the entry and every
 * schema it references at any depth, annotations included, so a change to
 * `address` changes the hash of `signUp` when `signUp` references it, and a
 * change of wording makes `datafile_set` name the schema.
 */
export function buildSchemasSection(
  schemaKeys: string[],
  schemasByKey: Record<string, Schema>,
  options: DatafileSchemaOptions = {},
): Record<string, DatafileSchema> {
  const entries: Record<string, DatafileSchema> = {};
  for (const key of schemaKeys) entries[key] = toDatafileSchema(schemasByKey[key], options);

  const closure = (key: string): string[] => {
    const seen = new Set<string>();
    const pending = [key];
    while (pending.length > 0) {
      const next = pending.pop()!;
      if (seen.has(next) || !entries[next]) continue;
      seen.add(next);
      for (const reference of getSchemaReferences(entries[next])) pending.push(reference);
    }
    return [...seen].sort();
  };

  const section: Record<string, DatafileSchema> = {};
  for (const key of schemaKeys) {
    const covered = closure(key).map((name) => [name, entries[name]]);
    section[key] = {
      hash: generateHashFromString(JSON.stringify({ key, schemas: covered })),
      ...entries[key],
    };
  }
  return section;
}
