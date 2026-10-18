import type { BucketBy } from "./bucket";
import type { Conditions } from "./condition";
import type { GroupSegment } from "./segment";
import type { SchemaType, Value, Schema, SchemaKey } from "./schema";

export type VariationValue = string;

export type VariableKey = string;
export type VariableType = SchemaType | "json";
/** Datafile variable type. Older datafiles may say "double", which reads like "number". */
export type DatafileVariableType = VariableType | "double";
export type VariableValue = Value | null;

/** Partial updates in map key order, or explicit list order with one path per item. */
export type VariableMutations =
  | Record<string, VariableValue>
  | Array<Record<string, VariableValue>>;

/**
 * Variable override used inside a feature rule or variation.
 *
 * `key` remains optional for compatibility with existing definitions. New
 * definitions should provide one so evaluations and promotion can use a stable
 * identity. `mutate` is the explicit partial update form. Legacy mutation maps
 * supplied through `value` remain supported until the next major release.
 */
interface VariableOverrideBase {
  key?: string;
  description?: string;
  promotable?: boolean;
  conditions?: Conditions;
  /** @deprecated Legacy datafile selector. Author conditions instead. */
  segments?: GroupSegment | GroupSegment[] | "*";
  /** @deprecated Legacy datafile gate. Author conditions instead. */
  requiredFeatures?: RequiredFeatures;
}

type VariableOverrideValue =
  | { value: VariableValue; mutate?: never }
  | { mutate: VariableMutations; value?: never };

export type VariableOverride = VariableOverrideBase & VariableOverrideValue;

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

  // Numeric validation (when type is "integer" or "number")
  minimum?: number;
  maximum?: number;

  // String validation (when type is "string")
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: Schema["format"];

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
  type: DatafileVariableType;

  defaultValue: VariableValue;
  description?: string;
  useDefaultWhenDisabled?: boolean;
  disabledValue?: VariableValue;
}

export type FeatureKey = string;

export interface RequiredFeatureOptions {
  feature: FeatureKey;
  /** Expected result from `isEnabled()`. Defaults to `true`. */
  enabled?: boolean;
  /** Expected result from `getVariation()`. */
  variation?: VariationValue;
}

export type RequiredFeature =
  | FeatureKey
  | RequiredFeatureOptions
  | { and: RequiredFeature[] }
  | { or: RequiredFeature[] }
  | { not: RequiredFeature[] };

/** Arrays imply AND. A group or leaf is shorthand for a one item array. */
export type RequiredFeatures = RequiredFeature | RequiredFeature[];

export type Weight = number; // 0 to 100

export type EnvironmentKey = string; // ideally "production", "staging", "testing", or "development" only

export type Tag = string;

export type RuleKey = string;

export interface Rule {
  key: RuleKey;
  description?: string; // only available in YAML
  promotable?: boolean; // only available in YAML
  conditions: Conditions;
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
  // Author conditions. The optional legacy selector is for v3 datafile reads.
  conditions?: Conditions;
  /** @deprecated Legacy datafile selector. */
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

  conditions?: Conditions;

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
