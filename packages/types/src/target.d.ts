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
  /**
   * Datafile schema to write. "4" by default. "2" writes datafiles that the
   * latest v3 JavaScript SDK, @featurevisor/sdk 3.8, can read.
   */
  schemaVersion?: "2" | "4";
}
