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

// adapted JSON Schema for Featurevisor
export interface Schema {
  // Basic metadata
  description?: string;
  promotable?: boolean;

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
  additionalProperties?: Schema;

  // Annotations
  // default?: Value;
  // examples?: Value[];

  // when referencing another Schema by name
  schema?: SchemaKey;

  // value must match exactly one branch
  oneOf?: Schema[];
}
