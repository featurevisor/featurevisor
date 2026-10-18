import type { EntityType, Test } from "@featurevisor/types";
import type { CatalogStorageDescriptor } from "./storage";

export type CatalogEntityType = Exclude<EntityType, "scenario">;
export type EntityPath =
  | "features"
  | "segments"
  | "attributes"
  | "targets"
  | "schemas"
  | "variables"
  | "tests";
export type GitProvider = "github" | "gitlab" | "bitbucket";
export type DevEditorId = "cursor" | "vscode";

export interface DevEditor {
  id: DevEditorId;
  label: string;
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
  /** "enabled" is used by projects without environments, where rules are a flat list. */
  environmentStatus?: "production" | "other" | "disabled" | "enabled";
  environmentStatusEnvironment?: string;
  tags?: string[];
  targets?: string[];
  /** Features that depend on it, directly or through other segments, features and variables. */
  usedInFeatureCount?: number;
  /** Global variables that depend on it, directly or through other entities. */
  usedInVariableCount?: number;
  /**
   * Segments, attributes and schemas: features and variables using it, directly or not. Zero
   * means no feature or variable reaches it, even when an unused segment still refers to it.
   */
  usedByCount?: number;
  /**
   * What it refers to itself, as "type:key" for features, variables, segments and attributes.
   * Pages rebuild the dependency graph from these, so indirect use is never exported twice.
   */
  references?: string[];
  /** It depends on a deprecated feature, directly or through other entities. */
  dependsOnDeprecated?: boolean;
  environments?: string[];
  variationValues?: string[];
  variableKeys?: string[];
  hasVariations?: boolean;
  hasVariables?: boolean;
  variableType?: string;
  isComposed?: boolean;
  hasTests?: boolean;
  testKind?: "feature" | "segment" | "variable" | "scenario";
  testSubject?: string;
  assertionCount?: number;
  childCount?: number;
  /** Whole spec outcome only when current results cover every exact case identity. */
  testPassed?: boolean;
  /** Case coverage and provenance, including partial or absent report results. */
  testReportStatus?: string;
  attributeType?: string;
  /** Attributes only: the string format, such as date-time or semver. */
  attributeFormat?: string;
  /** Features only: rules, force or exposure differ between environments. */
  environmentsDiffer?: boolean;
  /** Authored names and values for search, as "kind:value" strings. */
  searchTerms?: string[];
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
  storage?: CatalogStorageDescriptor;
  sets: boolean;
  setKeys: string[];
  projectConfig: {
    tags: string[];
    environments?: string[];
  };
  dev?: {
    editors: DevEditor[];
  };
  /** Present when the Catalog was exported with a `featurevisor test --json` report. */
  testReport?: {
    verification?: "current" | "stale" | "unverified";
    runner: string;
    passed: boolean;
    summary: Record<string, { passed: number; failed: number }>;
    hasCoverage: boolean;
    /** Authored cases across every set, and how many of them the report contains. */
    cases?: { executed: number; total: number };
  };
  links?: {
    provider?: GitProvider;
    repository?: string;
    source: string;
    /** Opens the provider's web editor on `branch`, where changes can be proposed. */
    edit?: string;
    /** Branch the source and edit links use. Absent when links point at the exported commit. */
    branch?: string;
    /** How the branch was found: an explicit option, origin's default or the checked out branch. */
    branchKind?: "configured" | "default" | "checkout";
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
  type: EntityType;
  key: string;
  set?: string;
}

export interface HistoryEntry {
  commit: string;
  author: string;
  timestamp: string;
  subject?: string;
  entities: HistoryEntity[];
}

export interface HistoryPage {
  page: number;
  pageSize: number;
  totalPages: number;
  entries: HistoryEntry[];
}

export interface TestReportResult {
  verification?: "current" | "stale" | "unverified";
  passed: boolean;
  cases: Array<{
    id?: string;
    assertionKey?: string;
    assertionIndex?: number;
    caseIndex?: number;
    passed: boolean;
    errors: Array<{
      message: string;
      path?: Array<string | number>;
      expected?: unknown;
      actual?: unknown;
    }>;
  }>;
}

export interface EntityReference {
  type: CatalogEntityType;
  key: string;
}

/**
 * What one reference reads from a feature or global variable. Conditions keep their authored
 * leaf, so it renders exactly like the conditions themselves. Compositions read a value.
 */
export interface DependencyCheck {
  /** Same text as the matching entry in `locations`. */
  location: string;
  condition?: Record<string, unknown>;
  compose?: { variable?: string; variation?: boolean };
}

/** A direct reference, with every place it is authored. */
export interface DirectDependency extends EntityReference {
  locations: string[];
  checks?: DependencyCheck[];
}

/** An entity reached only through others, with the shortest chain between the two. */
export interface IndirectDependency extends EntityReference {
  /** Entities between the two, ordered from the one that depends towards the one depended on. */
  via: EntityReference[];
}

export interface EntityDetail<T = Record<string, unknown>> {
  type: CatalogEntityType;
  key: string;
  entity: T;
  sourcePath?: string;
  editLinks?: Partial<Record<DevEditorId, string>>;
  lastModified?: LastModified;
  /**
   * Flat lists of related keys. Dependency lists include everything reached directly or
   * through other segments, features and variables, in both directions.
   */
  relationships?: Record<string, string[]>;
  /** Map properties whose source is a composed global variable, including string aliases. */
  composedSourceAliases?: string[];
  /** Effective getter type of a string composition source. */
  aliasSourceType?: string;
  tests?: Test[];
  /** Results from an optional test report, for test entities. */
  report?: TestReportResult;
  /** Rule keys observed during tests with `--coverage`, for features. */
  observedRules?: Array<{ environment: string | null; ruleKey: string }>;
  /** Override paths observed during tests with `--coverage`, for global variables. */
  observedOverrides?: Array<{ environment: string | null; path: string[] }>;
  /** Value after each global override when every selector matches, keyed by environment. */
  accumulationPreview?: Record<
    string,
    Array<{
      path: string[];
      value?: unknown;
      continues: boolean;
      skipped?: boolean;
      error?: string;
    }>
  >;
  /** Entities referring to this one directly, with every place they do. */
  usedBy?: DirectDependency[];
  /** Attributes only: the conditions reading this attribute, by path and operator. */
  conditionValues?: Array<{
    path: string;
    operator: string;
    uses: number;
    values: unknown[];
    /** Entities comparing with each value, in the same order as values. */
    users?: Array<Array<{ type: "segment" | "feature" | "variable"; key: string }>>;
    /** Users left out of each value's list, in the same order as values. */
    moreUsers?: number[];
    moreValues?: number;
  }>;
  /**
   * Segments only: scenarios testing features or variables that use it, and segment specs of
   * segments that use it, each with the entities it is reached through.
   */
  relatedScenarios?: Array<{
    key: string;
    via: Array<{ type: "feature" | "variable" | "segment"; key: string }>;
  }>;
  environments?: string[];
  historyPath?: string;
  /** Targets only: size of each environment's built datafile. */
  datafiles?: Array<{ environment: string | null; bytes: number; gzipBytes: number }>;
  /**
   * Targets only: features and variables in the datafile that require an entity in it, directly
   * or through segments, keyed "type:key".
   */
  contentRequiredBy?: Record<string, Array<{ type: "feature" | "variable"; key: string }>>;
  /**
   * Targets only: entities the Target holds only because something it selected depends on them,
   * keyed "type:key", with the chain from the selected entity that pulled each one in.
   */
  contentPulledIn?: Record<string, EntityReference[]>;
}
