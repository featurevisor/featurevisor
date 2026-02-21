export type SchemaKey = string;

export type ObjectValue = { [key: string]: Value };
export type Value =
  | boolean
  | string
  | number // covers integer and double
  // | Date // @TODO: support in future
  | ObjectValue
  | Value[];

export type SchemaType =
  | "boolean"
  | "string"
  | "integer"
  | "double"
  | "object"
  // | "date" // @TODO: support in future
  // | "semver" // @TODO: consider in future
  // | "url" // @TODO: consider in future
  | "array";

// adapted JSON Schema for Featurevisor
export interface Schema {
  // Basic metadata
  description?: string;

  // General validation keywords
  type?: SchemaType;
  enum?: Value[];
  const?: Value;

  // Numeric validation keywords (when type is "integer" or "double")
  maximum?: number;
  minimum?: number;

  // String validation keywords
  // maxLength?: number;
  // minLength?: number;
  // pattern?: string;

  // Array validation keywords
  items?: Schema;
  // maxItems?: number;
  // minItems?: number;
  // uniqueItems?: boolean;

  // Object validation keywords
  required?: string[];
  properties?: { [key: string]: Schema };

  // Annotations
  // default?: Value;
  // examples?: Value[];

  // when referencing another Schema by name
  schema?: SchemaKey;

  // oneOf: value must match exactly one of the given schemas (reusable Schema level only)
  oneOf?: Schema[];
}
