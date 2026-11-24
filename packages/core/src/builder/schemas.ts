import type {
  Conditions,
  DatafileSchema,
  Schema,
  SchemaMutation,
  VariableMutationOperation,
  VariableMutations,
} from "@featurevisor/types";
import { applyVariableOperations } from "@featurevisor/sdk";

import { compileConditions } from "../datasource/conditions";
import { visitConditionLocations } from "../datasource/conditionLocations";
import { getSchemaReferences } from "../targeting";
import { getInheritedEnvironment } from "./environments";
import { generateHashFromString } from "./hashes";
import { mutationEntries } from "./mutationEntries";
import { compileVariableMutation } from "./variableOverrideProgram";

/** Fields for maintainers, never delivered at any depth. */
const MAINTAINER_FIELDS = ["description", "promotable"];
/**
 * Fields only a schema's root has, never delivered. The vocabularies never
 * reach a datafile, since lint has checked every annotation against them.
 */
const ROOT_ONLY_FIELDS = ["metadata", "tags", "annotationsSchema", "optionSchema", "environments"];

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
 * A schema as one environment has it: the base with that environment's
 * `mutate` applied, inherited as rules are, and without `environments`. A
 * schema without `environments` is returned as it is.
 */
export function resolveSchemaEnvironment(
  schema: Schema,
  environment: string | false | undefined,
  config: Parameters<typeof getInheritedEnvironment>[0],
): Schema {
  if (!schema || typeof schema !== "object" || schema.environments === undefined) return schema;
  const { environments, ...base } = schema;
  if (typeof environment !== "string") return base;
  const own = Object.prototype.hasOwnProperty.call(environments, environment);
  const from = own ? environment : getInheritedEnvironment(config, environment);
  const entry =
    from !== undefined && Object.prototype.hasOwnProperty.call(environments, from)
      ? environments[from]
      : undefined;
  if (!entry || entry.mutate === undefined) return base;
  return applyVariableOperations(base as never, compileMutate(entry.mutate)) as unknown as Schema;
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
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
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
