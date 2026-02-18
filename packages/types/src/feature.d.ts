import type { BucketBy } from "./bucket";
import type { Condition } from "./condition";
import type { GroupSegment } from "./segment";
import type { SchemaType, Value, Schema } from "./schema";

export type VariationValue = string;

export type VariableKey = string;
export type VariableType = SchemaType | "json";
export type VariableValue =
  | Value
  // @TODO: consider removing below items
  | null
  | undefined;

export interface VariableOverrideSegments {
  segments: GroupSegment | GroupSegment[];
}

export interface VariableOverrideConditions {
  conditions: Condition | Condition[];
}

export type VariableOverrideSegmentsOrConditions =
  | VariableOverrideSegments
  | VariableOverrideConditions;

export interface VariableOverride {
  value: VariableValue;

  // one of the below must be present in YAML files
  conditions?: Condition | Condition[];
  segments?: GroupSegment | GroupSegment[];
}

export interface VariableV1 {
  key: VariableKey;
  value: VariableValue;
  description?: string; // only available in YAML files
  overrides?: VariableOverride[];
}

export interface VariationV1 {
  description?: string; // only available in YAML files
  value: VariationValue;
  weight?: Weight; // 0 to 100 (available from parsed YAML, but not in datafile)
  variables?: VariableV1[];
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

export interface VariableSchema {
  deprecated?: boolean;
  key?: VariableKey; // @NOTE: remove
  type: VariableType;

  properties?: Schema; // if type is object
  required?: Schema["required"]; // if type is object
  items?: Schema["items"]; // if type is array

  defaultValue: VariableValue;
  // nullable?: boolean; // @TODO: consider in future
  description?: string; // only available in YAML files
  useDefaultWhenDisabled?: boolean;
  disabledValue?: VariableValue;
}

export type FeatureKey = string;

export interface RequiredWithVariation {
  key: FeatureKey;
  variation: VariationValue;
}

export type Required = FeatureKey | RequiredWithVariation;

export type Weight = number; // 0 to 100

export type EnvironmentKey = string; // ideally "production", "staging", "testing", or "development" only

export type Tag = string;

export type RuleKey = string;

export interface Rule {
  key: RuleKey;
  description?: string; // only available in YAML
  segments: GroupSegment | GroupSegment[];
  percentage: Weight;

  enabled?: boolean;
  variation?: VariationValue;
  variables?: {
    [key: string]: VariableValue;
  };
  variationWeights?: {
    [key: string]: Weight;
  };
}

export interface RulesByEnvironment {
  [key: EnvironmentKey]: Rule[];
}

export interface Force {
  // one of the below must be present in YAML
  conditions?: Condition | Condition[];
  segments?: GroupSegment | GroupSegment[];

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

  description: string;
  tags: Tag[];

  required?: Required[];

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
