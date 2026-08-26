import type { BucketBy } from "./bucket";
import type { Condition } from "./condition";
import type { GroupSegment } from "./segment";
import type { SchemaType, Value, Schema, SchemaKey } from "./schema";

export type VariationValue = string;

export type VariableKey = string;
export type VariableType = SchemaType | "json";
export type VariableValue = Value | null;

/**
 * Variable override used inside a feature rule or variation.
 *
 * `key` remains optional for compatibility with existing definitions. New
 * definitions should provide one so evaluations and promotion can use a stable
 * identity. `mutate` is the explicit partial update form. Legacy mutation maps
 * supplied through `value` remain supported until the next major release.
 */
export interface VariableOverride {
  key?: string;
  description?: string;
  promotable?: boolean;

  value?: VariableValue;
  mutate?: Record<string, VariableValue>;

  // conditions and segments are mutually exclusive
  conditions?: Condition | Condition[];
  segments?: GroupSegment | GroupSegment[] | "*";
  requiredFeatures?: RequiredFeatures;
}

export interface Variation {
  description?: string; // only available in YAML files
  value: VariationValue;
  weight?: Weight; // 0 to 100 (available from parsed YAML, but not in datafile)
  variables?: {
    [key: VariableKey]: VariableValue;
  };
  variableOverrides?: {
    [key: VariableKey]: VariableOverride[];
  };
}

/** Variable schema that references a reusable schema by key. No type/properties/required/items. */
export interface VariableSchemaWithReference {
  deprecated?: boolean;
  key?: VariableKey; // @NOTE: remove
  schema: SchemaKey;

  defaultValue: VariableValue;
  description?: string; // only available in YAML files
  useDefaultWhenDisabled?: boolean;
  disabledValue?: VariableValue;
}

/** Variable schema with inline type and optional structure. */
export interface VariableSchemaWithInline {
  deprecated?: boolean;
  key?: VariableKey; // @NOTE: remove
  type?: VariableType; // required when not using oneOf

  properties?: Schema; // if type is object
  additionalProperties?: Schema["additionalProperties"]; // if type is object
  required?: Schema["required"]; // if type is object
  items?: Schema["items"]; // if type is array
  oneOf?: Schema[]; // value must match exactly one branch (mutually exclusive with type at the definition root)
  enum?: Value[];
  const?: VariableValue;

  // Numeric validation (when type is "integer" or "double")
  minimum?: number;
  maximum?: number;

  // String validation (when type is "string")
  minLength?: number;
  maxLength?: number;
  pattern?: string;

  // Array validation (when type is "array")
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;

  defaultValue: VariableValue;
  description?: string; // only available in YAML files
  useDefaultWhenDisabled?: boolean;
  disabledValue?: VariableValue;
}

/** Either a reference to a reusable schema or an inline variable schema. */
export type VariableSchema = VariableSchemaWithReference | VariableSchemaWithInline;

/**
 * Variable schema as emitted in the datafile (schema refs resolved to type only).
 * Used by SDK and datafile; only `type` is kept from the schema for datafile size.
 */
export interface ResolvedVariableSchema {
  deprecated?: boolean;
  key?: VariableKey;
  type: VariableType;

  defaultValue: VariableValue;
  description?: string;
  useDefaultWhenDisabled?: boolean;
  disabledValue?: VariableValue;
}

export type FeatureKey = string;

export interface RequiredWithVariation {
  key: FeatureKey;
  variation: VariationValue;
}

/** @deprecated Use `RequiredFeature` and `requiredFeatures` instead. */
export type Required = FeatureKey | RequiredWithVariation;

export interface RequiredFeatureOptions {
  feature: FeatureKey;
  /** Expected result from `isEnabled()`. Defaults to `true`. */
  enabled?: boolean;
  /** Expected result from `getVariation()`. */
  variation?: VariationValue;
}

export type RequiredFeature = FeatureKey | RequiredFeatureOptions;

/** Authoring form. A single feature key is shorthand for a one-item array. */
export type RequiredFeatures = FeatureKey | RequiredFeature[];

export type Weight = number; // 0 to 100

export type EnvironmentKey = string; // ideally "production", "staging", "testing", or "development" only

export type Tag = string;

export type RuleKey = string;

export interface Rule {
  key: RuleKey;
  description?: string; // only available in YAML
  promotable?: boolean; // only available in YAML
  segments: GroupSegment | GroupSegment[] | "*";
  percentage: Weight;

  enabled?: boolean;
  variation?: VariationValue;
  variables?: {
    [key: string]: VariableValue;
  };
  variationWeights?: {
    [key: string]: Weight;
  };
  variableOverrides?: {
    [key: VariableKey]: VariableOverride[];
  };
}

export interface RulesByEnvironment {
  [key: EnvironmentKey]: Rule[];
}

export interface Force {
  // one of the below must be present in YAML
  conditions?: Condition | Condition[];
  segments?: GroupSegment | GroupSegment[] | "*";

  enabled?: boolean;
  variation?: VariationValue;
  variables?: {
    [key: string]: VariableValue;
  };
}

export interface ForceByEnvironment {
  [key: EnvironmentKey]: Force[];
}

export type Expose = boolean | Tag[];

export interface ExposeByEnvironment {
  [key: EnvironmentKey]: Expose;
}

export interface ParsedFeature {
  key: FeatureKey;

  archived?: boolean;
  deprecated?: boolean;
  promotable?: boolean;

  description: string;
  tags?: Tag[];

  /** @deprecated Use `requiredFeatures`. */
  required?: Required[];
  requiredFeatures?: RequiredFeatures;

  bucketBy: BucketBy;

  disabledVariationValue?: VariationValue;

  variablesSchema?: Record<VariableKey, VariableSchema>;
  variations?: Variation[];

  expose?: ExposeByEnvironment | Expose;
  force?: ForceByEnvironment | Force[];
  rules?: RulesByEnvironment | Rule[];
}

/**
 * Used by SDK
 */
export interface EvaluatedFeature {
  enabled: boolean;
  variation?: VariationValue;
  variables?: {
    [key: VariableKey]: VariableValue;
  };
}

export interface EvaluatedFeatures {
  [key: FeatureKey]: EvaluatedFeature;
}

export type StickyFeatures = EvaluatedFeatures;
