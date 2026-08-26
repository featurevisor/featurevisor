import type { Schema, SchemaKey } from "@featurevisor/types";

/**
 * Collect reusable schema references from schema-bearing fields only.
 * Runtime values such as defaultValue may legitimately contain a property named
 * `schema` and must never be interpreted as project dependencies.
 */
export function extractSchemaReferences(schema: unknown): Set<SchemaKey> {
  const result = new Set<SchemaKey>();

  function visit(candidate: unknown): void {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;

    const current = candidate as Schema;
    if (typeof current.schema === "string") result.add(current.schema);
    if (current.items) visit(current.items);
    if (current.additionalProperties) visit(current.additionalProperties);
    Object.values(current.properties || {}).forEach(visit);
    (current.oneOf || []).forEach(visit);
  }

  visit(schema);
  return result;
}
