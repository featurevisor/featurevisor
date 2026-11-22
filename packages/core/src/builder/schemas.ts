import type { DatafileSchema, Schema } from "@featurevisor/types";

import { getSchemaReferences } from "../targeting";
import { generateHashFromString } from "./hashes";

/** Fields for maintainers, never delivered at any depth. */
const MAINTAINER_FIELDS = ["description", "promotable"];
/** Fields only a schema's root has, never delivered. */
const ROOT_ONLY_FIELDS = ["metadata", "tags"];

function stripNode(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(stripNode);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (MAINTAINER_FIELDS.includes(key)) continue;
    if (key === "items" || key === "additionalProperties") result[key] = stripNode(value);
    else if (key === "oneOf") result[key] = (value as unknown[]).map(stripNode);
    else if (key === "properties" && value && typeof value === "object")
      result[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, property]) => [
          name,
          stripNode(property),
        ]),
      );
    else result[key] = value;
  }
  return result;
}

/**
 * A schema as a datafile carries it: rules, `schema` references and `messages`
 * as authored, without `description`, `promotable`, `metadata` and `tags`.
 */
export function toDatafileSchema(schema: Schema): DatafileSchema {
  const stripped = stripNode(schema) as Record<string, unknown>;
  for (const field of ROOT_ONLY_FIELDS) delete stripped[field];
  return stripped as DatafileSchema;
}

/**
 * The `schemas` section of a datafile, for keys a target delivers along with
 * every schema they reference. Each entry's `hash` covers the entry and every
 * schema it references at any depth, so a change to `address` changes the hash
 * of `signUp` when `signUp` references it.
 */
export function buildSchemasSection(
  schemaKeys: string[],
  schemasByKey: Record<string, Schema>,
): Record<string, DatafileSchema> {
  const entries: Record<string, DatafileSchema> = {};
  for (const key of schemaKeys) entries[key] = toDatafileSchema(schemasByKey[key]);

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
