import type { SchemaKey, Value } from "./schema";

export type AttributeKey = string;

export interface AttributeObjectValue {
  [key: AttributeKey]: AttributeValue;
}

export type AttributeValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | string[]
  | AttributeObjectValue
  | Record<string, unknown>;

export type AttributeType =
  | "boolean"
  | "string"
  | "integer"
  | "double"
  | "date"
  | "semver"
  | "object"
  | "array";

export interface AttributeSchema {
  description?: string; // only available in YAML files
  enum?: Value[];
  const?: Value;
  maximum?: number;
  minimum?: number;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  items?: AttributeProperty;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  required?: string[];
  properties?: {
    [key: AttributeKey]: AttributeProperty;
  };
  additionalProperties?: AttributeProperty;
  oneOf?: AttributeProperty[];
}

export type Attribute = AttributeSchema & {
  archived?: boolean; // only available in YAML files
  key?: AttributeKey; // needed for supporting v1 datafile generation
  type?: AttributeType; // required when not using oneOf
};

export type AttributeProperty = AttributeSchema & {
  type?: AttributeType;
  schema?: SchemaKey;
};
