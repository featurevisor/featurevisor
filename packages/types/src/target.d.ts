import type { Context } from "./context";
import type { FeatureKey, Tag } from "./feature";

export type TargetKey = string;

export interface TargetOrTags {
  or: Tag[];
}

export interface TargetAndTags {
  and: Tag[];
}

export type TargetTags = Tag[] | TargetOrTags | TargetAndTags;
export type TargetFeatures = "*" | FeatureKey[];

export interface Target {
  key?: TargetKey;
  promotable?: boolean;
  description: string;
  tag?: Tag;
  tags?: TargetTags;
  includeFeatures?: TargetFeatures;
  excludeFeatures?: TargetFeatures;
  context?: Context;
}
