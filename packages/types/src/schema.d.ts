import type { Metadata } from "./metadata";
import type { Tag } from "./feature";
import type { Conditions } from "./condition";
import type { VariableMutations } from "./feature";
import type { VariableMutationOperation } from "./variable";
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

/**
 * Values beside a node's rules, for forms and anything else that presents a
 * schema, which validation never reads. `title`, `examples`, `order` and
 * `options` are built in, and a schema's `annotationsSchema` declares the rest.
 */
export interface SchemaAnnotations {
  /** A field's or a form's name for people. */
  title?: string;
  /** Values the field could hold, each checked against its own rules. */
  examples?: Value[];
  /** The order of an object's fields. Fields it leaves out come last. */
  order?: string[];
  /** Beside an `enum`: what each choice carries, keyed by its value, or a value's JSON text. */
  options?: { [value: string]: { [name: string]: Value } };
  [name: string]: Value | undefined;
}

/**
 * Rules that change when conditions match, as authored: `mutate` changes the
 * node it sits on, in the notation global variable overrides use. Every
 * mutation whose conditions match applies, in order. A mutation's own
 * `mutations` are checked only once it matches, and apply after it.
 */
export interface SchemaMutation {
  /** Unique across the node's mutations, nested ones included. */
  key: string;
  description?: string;
  /** Context attributes, segments, features and variables, and `input` leaves over the value validated. */
  conditions: Conditions;
  /** What it changes. A mutation with nested `mutations` can leave it out, to group them. */
  mutate?: VariableMutations;
  /** Mutations checked only once this one matches, applied after its own `mutate`. */
  mutations?: SchemaMutation[];
}

/** A mutation as a datafile carries it, with `mutate` compiled into operations. */
export interface DatafileSchemaMutation {
  key: string;
  conditions: Conditions;
  operations: VariableMutationOperation[];
}

/**
 * An issue an object reports when its conditions match, as authored: after
 * the node's own rules, unless an issue of shape sits anywhere inside it. Its
 * conditions say when a value fails, so one meant for some users joins their
 * condition and its check with `and`.
 */
export interface SchemaIssueEntry {
  /** Unique across the node's issues, nested ones included, and the issue's `params.refine`. */
  key: string;
  description?: string;
  /** Context attributes, segments, features and variables, and `input` leaves over the value validated. */
  conditions: Conditions;
  /** The field the issue belongs to, by dots relative to the node, or the node itself when absent. */
  path?: string;
  /** The schema's message for the issue, as a template. An entry with nested `issues` can leave it out, to group them. */
  message?: string;
  /** Entries checked only once this one's conditions match, each joining them with its own. */
  issues?: SchemaIssueEntry[];
}

/**
 * An issue entry as a datafile carries it: flat, with its conditions joined
 * with those of the entries it was nested in, and written as features' are.
 */
export interface DatafileSchemaIssueEntry {
  key: string;
  conditions: Conditions;
  path?: string;
  message: string;
}

/**
 * A schema's mutations by environment, as features' rules are: at the root of
 * a schema in a project with environments. An environment without a list uses
 * the list of the one it inherits from, and `[]` means none.
 */
export interface SchemaMutationsByEnvironment {
  [environment: string]: SchemaMutation[];
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
  /** Only at the root: what this file's `annotations` hold, as one object schema, inline or by reference. */
  annotationsSchema?: Schema;
  /** Only at the root: what each choice in this file carries, as one object schema, inline or by reference. */
  optionSchema?: Schema;
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

  /** Values beside the rules, for forms and tools, which validation never reads. */
  annotations?: SchemaAnnotations;

  /**
   * Changes to this node's rules when conditions match, at validation time. At
   * a schema's root in a project with environments, a list per environment.
   */
  mutations?: SchemaMutation[] | SchemaMutationsByEnvironment | DatafileSchemaMutation[];

  /** Issues an object reports when their conditions match, after its own rules. */
  issues?: SchemaIssueEntry[] | DatafileSchemaIssueEntry[];
}

/**
 * A schema as a datafile carries it, in its `schemas` section: the rules,
 * messages and annotations as authored, `schema` references resolving by key
 * in the same datafile, without `description`, `metadata`, `promotable`,
 * `tags` and the vocabularies, and with a `hash` that covers every schema it
 * references. A target with `includeAnnotations: false` leaves annotations out.
 */
export type DatafileSchema = Omit<
  Schema,
  | "description"
  | "metadata"
  | "promotable"
  | "tags"
  | "annotationsSchema"
  | "optionSchema"
  | "mutations"
> & {
  hash?: string;
  /** The environment's list, compiled, with the mutations that always apply already applied. */
  mutations?: DatafileSchemaMutation[];
};
