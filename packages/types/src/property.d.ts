export type SchemaKey = string;
export type Schema = PropertySchema;

export type ObjectValue = { [key: string]: Value };
export type Value =
  | boolean
  | string
  | number // covers integer and double
  // | Date // @TODO: support in future
  | ObjectValue
  | Value[];

export type PropertyType =
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
export interface PropertySchema {
  // Basic metadata
  description?: string;

  // General validation keywords
  type?: PropertyType;
  // enum?: Value[];
  // const?: Value;

  // Numeric validation keywords
  // maximum?: number;
  // minimum?: number;

  // String validation keywords
  // maxLength?: number;
  // minLength?: number;
  // pattern?: string;

  // Array validation keywords
  items?: PropertySchema; // @TODO: allow array of items in future | PropertySchema[];
  // maxItems?: number;
  // minItems?: number;
  // uniqueItems?: boolean;

  // Object validation keywords
  required?: string[];
  properties?: { [key: string]: PropertySchema };

  // Annotations
  // default?: Value;
  // examples?: Value[];
}
