import type { Context } from "./context";
import type { FeatureKey, Tag } from "./feature";
import type { GlobalVariableKey } from "./variable";

export type TargetKey = string;

export interface TargetOrTags {
  or: Tag[];
}

export interface TargetAndTags {
  and: Tag[];
}

export type TargetTags = Tag[] | TargetOrTags | TargetAndTags;
export type TargetFeatures = "*" | FeatureKey[];
export type TargetVariables = "*" | GlobalVariableKey[];

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
