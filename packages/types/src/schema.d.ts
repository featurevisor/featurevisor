import type { Metadata } from "./metadata";
import type { Tag } from "./feature";
export type SchemaKey = string;

export type ObjectValue = { [key: string]: Value };
export type Value =
  | null
  | boolean
  | string
  | number // covers integer and number
  // | Date // @TODO: support in future
  | ObjectValue
  | Value[];

export type SchemaType = "boolean" | "string" | "integer" | "number" | "object" | "array";

/** Semantic string formats. `semver` is Featurevisor's portable version grammar. */
export type SchemaFormat = "date-time" | "semver";

/**
 * Messages for a schema node's issues. A text value is a message template for
 * one of the node's own issues, keyed by its code, such as `minLength`. A map
 * is a field of the node, such as `email`, holding that field's messages the
 * same way. `"[]"` holds the messages of an array's items, and `"*"` those of
 * an object's values that `additionalProperties` allows.
 */
export interface SchemaMessages {
  [codeOrField: string]: string | SchemaMessages;
}

// adapted JSON Schema for Featurevisor
export interface Schema {
  // Basic metadata
  description?: string;
  promotable?: boolean;
  /** Only at the root of a schema definition, never in a nested schema */
  metadata?: Metadata;
  /** Only at the root. Tag based targets deliver the schema in their datafiles. */
  tags?: Tag[];

  // General validation keywords
  type?: SchemaType;
  enum?: Value[];
  const?: Value;

  // Numeric validation keywords (when type is "integer" or "number")
  maximum?: number;
  minimum?: number;

  // String validation keywords (when type is "string")
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  format?: SchemaFormat;

  // Array validation keywords (when type is "array")
  items?: Schema;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;

  // Object validation keywords
  required?: string[];
  properties?: { [key: string]: Schema };
  /** A schema for every key not in `properties`, or `true` for any key with any value. */
  additionalProperties?: Schema | true;

  // Annotations
  // default?: Value;
  // examples?: Value[];

  // when referencing another Schema by name
  schema?: SchemaKey;

  // value must match exactly one branch
  oneOf?: Schema[];

  /** Messages for this node's issues and its fields' issues. */
  messages?: SchemaMessages;
}

/**
 * A schema as a datafile carries it, in its `schemas` section: the rules and
 * messages as authored, `schema` references resolving by key in the same
 * datafile, without `description`, `metadata`, `promotable` and `tags`, and
 * with a `hash` that covers every schema it references.
 */
export type DatafileSchema = Omit<Schema, "description" | "metadata" | "promotable" | "tags"> & {
  hash?: string;
};
