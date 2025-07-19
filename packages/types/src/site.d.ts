import type { Attribute } from "./attribute";
import type { Segment, SegmentKey } from "./segment";
import type { Tag, EnvironmentKey, FeatureKey, ParsedFeature } from "./feature";

export type EntityType = "attribute" | "segment" | "feature" | "group" | "test";

export type CommitHash = string;

export interface HistoryEntity {
  type: EntityType;
  key: string;
}

export interface HistoryEntry {
  commit: CommitHash;
  author: string;
  timestamp: string;
  entities: HistoryEntity[];
}

export interface LastModified {
  commit: CommitHash;
  timestamp: string;
  author: string;
}

export interface SearchIndex {
  links?: {
    feature: string;
    segment: string;
    attribute: string;
    commit: CommitHash;
  };
  projectConfig: {
    tags: Tag[];
    environments: EnvironmentKey[] | false;
  };
  entities: {
    attributes: (Attribute & {
      lastModified?: LastModified;
      usedInSegments: SegmentKey[];
      usedInFeatures: FeatureKey[];
    })[];
    segments: (Segment & {
      lastModified?: LastModified;
      usedInFeatures: FeatureKey[];
    })[];
    features: (ParsedFeature & {
      lastModified?: LastModified;
    })[];
  };
}

export interface EntityDiff {
  type: EntityType;
  key: string;
  created?: boolean;
  deleted?: boolean;
  updated?: boolean;
  content?: string;
}

export interface Commit {
  hash: CommitHash;
  author: string;
  timestamp: string;
  entities: EntityDiff[];
}
