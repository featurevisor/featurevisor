export type EntityType =
  | "attribute"
  | "segment"
  | "feature"
  | "group"
  | "schema"
  | "target"
  | "test";

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
