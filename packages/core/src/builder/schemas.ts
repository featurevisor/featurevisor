import type { DatafileSchema, Schema } from "@featurevisor/types";

import { getSchemaReferences } from "../targeting";
import { generateHashFromString } from "./hashes";

/** Fields for maintainers, never delivered at any depth. */
const MAINTAINER_FIELDS = ["description", "promotable"];
/**
 * Fields only a schema's root has, never delivered. The vocabularies never
 * reach a datafile, since lint has checked every annotation against them.
 */
const ROOT_ONLY_FIELDS = ["metadata", "tags", "annotationsSchema", "optionsSchema"];

export interface DatafileSchemaOptions {
  /** False leaves `annotations` out at every depth, for a target that only serves a backend. */
  annotations?: boolean;
}

function stripNode(node: unknown, options: DatafileSchemaOptions): unknown {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((item) => stripNode(item, options));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (MAINTAINER_FIELDS.includes(key)) continue;
    if (key === "annotations" && options.annotations === false) continue;
    if (key === "items" || key === "additionalProperties") result[key] = stripNode(value, options);
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
