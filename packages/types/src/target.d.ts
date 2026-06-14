import type { Context } from "./context";
import type { Tag } from "./feature";

export type TargetKey = string;

export interface TargetOrTags {
  or: Tag[];
}

export interface TargetAndTags {
  and: Tag[];
}

export type TargetTags = Tag[] | TargetOrTags | TargetAndTags;

export interface Target {
  key?: TargetKey;
  promotable?: boolean;
  description: string;
  tags?: TargetTags;
  context?: Context;
}
