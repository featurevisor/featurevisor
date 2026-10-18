import type { Context } from "./context";
import type { FeatureKey, Tag, VariableKey } from "./feature";

export type TargetKey = string;

export interface TargetOrTags {
  or: Tag[];
}

export interface TargetAndTags {
  and: Tag[];
}

export type TargetTags = Tag[] | TargetOrTags | TargetAndTags;
export type TargetFeatures = "*" | FeatureKey[];
export type TargetVariables = "*" | VariableKey[];

export interface Target {
  key?: TargetKey;
  promotable?: boolean;
  description: string;
  tag?: Tag;
  tags?: TargetTags;
  includeFeatures?: TargetFeatures;
  excludeFeatures?: TargetFeatures;
  includeVariables?: TargetVariables;
  excludeVariables?: TargetVariables;
  context?: Context;
}
