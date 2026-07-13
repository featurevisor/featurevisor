import type { EntityType, Test } from "@featurevisor/types";

export type CatalogEntityType = EntityType;
export type EntityPath =
  | "features"
  | "segments"
  | "attributes"
  | "targets"
  | "groups"
  | "schemas"
  | "tests";
export type GitProvider = "github" | "gitlab" | "bitbucket";
export type DevEditorId = "cursor" | "vscode";

export interface DevEditor {
  id: DevEditorId;
  label: string;
  icon: DevEditorId;
}

export interface LastModified {
  commit: string;
  author: string;
  timestamp: string;
}

export interface EntitySummary {
  key: string;
  description?: string;
  archived?: boolean;
  deprecated?: boolean;
  promotable?: boolean;
  environmentStatus?: "production" | "other" | "disabled";
  environmentStatusEnvironment?: string;
  tags?: string[];
  targets?: string[];
  usedInFeatureCount?: number;
  usedInSegmentCount?: number;
  environments?: string[];
  variationValues?: string[];
  variableKeys?: string[];
  hasVariations?: boolean;
  hasVariables?: boolean;
  lastModified?: LastModified;
  href: string;
}

export interface CatalogIndex {
  set: string;
  counts: Record<CatalogEntityType, number>;
  entities: Record<CatalogEntityType, EntitySummary[]>;
}

export interface CatalogManifest {
  schemaVersion: string;
  generatedAt: string;
  router?: "hash" | "browser";
  sets: boolean;
  setKeys: string[];
  projectConfig: {
    tags: string[];
    environments?: string[];
  };
  dev?: {
    editors: DevEditor[];
  };
  links?: {
    provider?: GitProvider;
    repository?: string;
    source: string;
    commit: string;
  };
  paths: {
    projectHistory: string;
    root?: string;
    sets?: Record<string, string>;
  };
  counts: Record<string, Record<CatalogEntityType, number>>;
}

export interface HistoryEntity {
  type: CatalogEntityType;
  key: string;
  set?: string;
}

export interface HistoryEntry {
  commit: string;
  author: string;
  timestamp: string;
  entities: HistoryEntity[];
}

export interface HistoryPage {
  page: number;
  pageSize: number;
  totalPages: number;
  entries: HistoryEntry[];
}

export interface EntityDetail<T = Record<string, unknown>> {
  type: CatalogEntityType;
  key: string;
  entity: T;
  sourcePath?: string;
  editLinks?: Partial<Record<DevEditorId, string>>;
  lastModified?: LastModified;
  relationships?: Record<string, string[]>;
  tests?: Test[];
  environments?: string[];
  historyPath?: string;
}
