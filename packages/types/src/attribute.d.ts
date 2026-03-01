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

export interface Attribute {
  archived?: boolean; // only available in YAML files
  key?: AttributeKey; // needed for supporting v1 datafile generation
  type: AttributeType;
  description?: string; // only available in YAML files
  properties?: {
    [key: AttributeKey]: {
      type:
        | "boolean"
        | "string"
        | "integer"
        | "double"
        | "date"
        | "semver"
        // | "object" // NOTE: avoid nesting for now
        | "array";
      description?: string;
    };
  };
}
