import childProcess from "child_process";
import * as fs from "fs";
import http from "http";
import * as path from "path";
import type {
  Attribute,
  ComposeReference,
  HistoryEntry,
  ParsedFeature,
  Scenario,
  Schema,
  Segment,
  Target,
  Test,
  TestScenario,
  ParsedVariable,
} from "@featurevisor/types";

import type {
  CatalogEntityType,
  CatalogIndex,
  CatalogManifest,
  DevEditor,
  EntityDetail,
  EntityReference,
  EntitySummary,
  HistoryEntry as CatalogHistoryEntry,
  LastModified,
} from "../types";
import { sortSetKeys } from "../entityTypes";
import { getTestReferences } from "../testReferences";
import { getTestReportCoverage, getTestReportStatus } from "../testModel";
import { getCatalogInputWatchPaths, watchCatalogInputs } from "./watch";
import {
  createCatalogDefinitionCache,
  createCatalogSnapshot,
  invalidateCatalogDefinitions,
  mapLimit,
  type CatalogDefinitionCache,
} from "./snapshot";
import { CatalogStorageWriter } from "./storageWriter";
import { DependencyGraph, fromNodeId, toNodeId } from "../dependencyGraph";
import {
  collectAuthoredReferences,
  groupAuthoredReferences,
  type AuthoredReference,
} from "../dependencyReferences";
import { encodeCatalogIndex } from "../indexCodec";
import { rewriteCatalogHtml } from "./html";

const CATALOG_SCHEMA_VERSION = "1";
const CATALOG_HISTORY_PAGE_SIZE = 50;
/**
 * Quiet time after the last file event before rebuilding. An editor's save finishes within a
 * few milliseconds, and events arriving during a rebuild queue another one.
 */
const CATALOG_WATCH_DEBOUNCE_MS = 100;
const CLI_FORMAT_GREEN = "\x1b[32m%s\x1b[0m";
const CLI_FORMAT_DIM = "\x1b[2m%s\x1b[0m";
const CLI_FORMAT_BOLD = "\x1b[1m%s\x1b[0m";

export interface CatalogPluginParsedOptions {
  _: string[];
  [key: string]: any;
}

export interface CatalogPluginHandlerOptions {
  rootDirectoryPath: string;
  projectConfig: any;
  datasource: any;
  parsed: CatalogPluginParsedOptions;
}

export interface CatalogPlugin {
  command: string;
  handler: (options: CatalogPluginHandlerOptions) => Promise<void | boolean>;
  examples: {
    command: string;
    description: string;
  }[];
}

export interface CatalogRuntime {
  /** Hash effective inputs using Core's report provenance contract. */
  getTestInputFingerprint?: (projectConfig: any, datasource: any) => Promise<string>;
  /** Exact allocation state files used by the report fingerprint. */
  getTestInputStatePaths?: (projectConfig: any) => string[];
  getProjectSetExecutions: (
    projectConfig: any,
    datasource: any,
    selectedSet?: string,
  ) => Promise<Array<{ set: string; projectConfig: any; datasource: any }>>;
  getCatalogTargetMemberships: (
    projectConfig: any,
    datasource: any,
  ) => Promise<Record<string, CatalogTargetMembership>>;
  reloadCatalogProject?: (
    rootDirectoryPath: string,
  ) => Promise<{ projectConfig: any; datasource: any }>;
  /** Apply one authored global override to a value, using the builder's own semantics. */
  resolveOverrideValue?: (variable: any, override: any, baseValue: any) => any;
}

export interface CatalogTargetMembership {
  features: string[];
  variables: string[];
  /** Segments in the Target's datafiles. Without it, segments come from features and variables. */
  segments?: string[];
  /** Members the Target does not select itself, held only because selected entities need them. */
  dependencyFeatures?: string[];
  dependencyVariables?: string[];
  datafiles?: Array<{ environment: string | null; bytes: number; gzipBytes: number }>;
}

export interface CatalogExportOptions {
  outDir?: string;
  copyAssets?: boolean;
  browserRouter?: boolean;
  dev?: boolean;
  devEditors?: DevEditor[];
  devSession?: CatalogDevSession;
  preserveAssets?: boolean;
  /** Path to a `featurevisor test --json` report whose results are shown alongside tests. */
  testReport?: string;
  /** Human readable JSON for local inspection. */
  prettyOutput?: boolean;
  /**
   * Publish immutable blocks and switch the manifest only after success. Defaults to true.
   * The plain layout is for inspection and small projects only.
   */
  compactStorage?: boolean;
  blockSize?: number;
  /** Input events for a dev rebuild; absent means rebuild every set. */
  changedPaths?: string[];
  /** Branch for source and edit links, instead of discovering it from Git. */
  branch?: string;
}

export interface CatalogServeOptions {
  outDir?: string;
  port?: number | string;
  browserRouter?: boolean;
  liveReload?: boolean;
  prettyOutput?: boolean;
  blockSize?: number;
  copyAssets?: boolean;
  testReport?: string;
  /** Branch for source and edit links, instead of discovering it from Git. */
  branch?: string;
}

export interface CatalogServerHandle {
  close: () => Promise<void>;
  setOutputDirectoryPath: (outputDirectoryPath: string) => void;
  setBasePath: (basePath: string) => void;
  triggerReload: () => void;
}

interface CatalogHistoryIndex {
  entries: CatalogHistoryEntry[];
  bySet: Record<string, CatalogHistoryEntry[]>;
  byEntity: Record<string, CatalogHistoryEntry[]>;
  lastModifiedByEntity: Record<string, LastModified>;
}

type CatalogHistoryEntityType = HistoryEntry["entities"][number]["type"];

interface CatalogDevSession {
  outputDirectoryPath: string;
  devEditors: DevEditor[];
  historyIndex: CatalogHistoryIndex;
  links: CatalogManifest["links"];
  repositoryRootDirectoryPath: string;
  repositorySourceRootDirectoryPath: string;
  gitFingerprint?: string;
  setIndexes?: Record<string, CatalogIndex>;
  publishedStorage?: CatalogManifest["storage"];
  publishedOutputDirectoryPath?: string;
  exportSignature?: string;
  failedChangedPaths?: string[];
  reportVerifications?: Record<string, CatalogTestReportResult["verification"]>;
  /** Parsed definitions reused across rebuilds while their sources are unchanged. */
  definitions?: CatalogDefinitionCache;
  /** Real paths for editor links, resolved once per session. */
  realPaths?: Map<string, string>;
}

interface CatalogBuildContext {
  runtime: CatalogRuntime;
  rootDirectoryPath: string;
  repositorySourceRootDirectoryPath: string;
  outputDirectoryPath: string;
  dataDirectoryPath: string;
  historyIndex: CatalogHistoryIndex;
  devEditors: DevEditor[];
  progress: CatalogProgressReporter;
  writer: Pick<CatalogStorageWriter, "write">;
  compactStorage?: boolean;
  testReport?: CatalogTestReportIndex;
  definitions?: CatalogDefinitionCache;
  realPaths?: Map<string, string>;
}

type CatalogTestReportResult = NonNullable<EntityDetail["report"]>;

interface CatalogTestReportIndex {
  provenance?: {
    version: number;
    algorithm: string;
    sets: Array<{ set: string | null; fingerprint: string }>;
  };
  summary: NonNullable<CatalogManifest["testReport"]>;
  specs: Map<string, CatalogTestReportResult>;
  observedRules: Map<string, NonNullable<EntityDetail["observedRules"]>>;
  observedOverrides: Map<string, NonNullable<EntityDetail["observedOverrides"]>>;
}

function getReportSpecId(set: string | null | undefined, source: string, key: string) {
  return JSON.stringify([set || "", source, key]);
}

function getReportEntityId(set: string | null | undefined, key: string) {
  return JSON.stringify([set || "", key]);
}

/** Read a report version 1 document produced by `featurevisor test --json`. */
function readTestReport(filePath: string): CatalogTestReportIndex {
  const report = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!report || report.schemaVersion !== 1 || !Array.isArray(report.results)) {
    throw new Error(`Unsupported test report at ${filePath}; expected report schemaVersion 1.`);
  }

  const specs = new Map<string, CatalogTestReportResult>();
  for (const spec of report.results) {
    const source = spec.type === "scenario" ? "scenario" : "test";
    // Report specs carry the entity key; the public test key is part of each case identity.
    let testKey = spec.key;
    try {
      const identity = JSON.parse(spec.cases?.[0]?.id);
      if (typeof identity?.[2] === "string") testKey = identity[2];
    } catch {
      // Fall back to the spec key when a runner reports no parsable case identity.
    }
    const specId = getReportSpecId(spec.set, source, testKey);
    const result: CatalogTestReportResult = {
      verification: "unverified",
      passed: Boolean(spec.passed),
      cases: (Array.isArray(spec.cases) ? spec.cases : []).map((testCase: any) => {
        let identity: unknown[] = [];
        try {
          identity = JSON.parse(testCase.id);
          if (!Array.isArray(identity)) identity = [];
        } catch {
          identity = [];
        }
        return {
          id:
            Array.isArray(identity) && identity.length === 5 ? JSON.stringify(identity) : undefined,
          assertionKey: typeof identity[3] === "string" ? identity[3] : undefined,
          assertionIndex: typeof identity[3] === "number" ? identity[3] : undefined,
          caseIndex: typeof identity[4] === "number" ? identity[4] : undefined,
          passed: Boolean(testCase.passed),
          errors: (Array.isArray(testCase.errors) ? testCase.errors : []).map((error: any) => ({
            message: String(error.message || "Failed"),
            path: Array.isArray(error.path) ? error.path : undefined,
            expected: error.expected,
            actual: error.actual,
          })),
        };
      }),
    };
    const previous = specs.get(specId);
    if (previous) {
      previous.passed = previous.passed && result.passed;
      // Retain duplicate identities so coverage cannot mistake repeated rows for completeness.
      previous.cases.push(...result.cases);
    } else {
      specs.set(specId, result);
    }
  }

  const observedRules = new Map<string, NonNullable<EntityDetail["observedRules"]>>();
  const observedOverrides = new Map<string, NonNullable<EntityDetail["observedOverrides"]>>();
  for (const selection of report.coverage?.selections || []) {
    if (selection.featureKey && typeof selection.ruleKey === "string") {
      const id = getReportEntityId(selection.set, selection.featureKey);
      const list = observedRules.get(id) || [];
      if (
        !list.some(
          (item) =>
            item.environment === selection.environment && item.ruleKey === selection.ruleKey,
        )
      ) {
        list.push({ environment: selection.environment ?? null, ruleKey: selection.ruleKey });
      }
      observedRules.set(id, list);
    }
    if (selection.variableKey && !selection.featureKey && Array.isArray(selection.overridePath)) {
      const id = getReportEntityId(selection.set, selection.variableKey);
      const list = observedOverrides.get(id) || [];
      const pathKey = JSON.stringify(selection.overridePath);
      if (
        !list.some(
          (item) =>
            item.environment === selection.environment && JSON.stringify(item.path) === pathKey,
        )
      ) {
        list.push({
          environment: selection.environment ?? null,
          path: selection.overridePath.map(String),
        });
      }
      observedOverrides.set(id, list);
    }
  }

  return {
    provenance: report.provenance,
    summary: {
      verification: "unverified",
      runner: String(report.runner || "unknown"),
      passed: Boolean(report.passed),
      summary: report.summary || {},
      hasCoverage: Boolean(report.coverage),
    },
    specs,
    observedRules,
    observedOverrides,
  };
}

type CatalogTestSource = "test" | "scenario";

interface CatalogTestSpec {
  key: string;
  source: CatalogTestSource;
  test: Test;
}

type EntityMaps = {
  feature: Record<string, ParsedFeature>;
  segment: Record<string, Segment>;
  attribute: Record<string, Attribute>;
  target: Record<string, Target>;
  schema: Record<string, Schema>;
  test: Record<string, CatalogTestSpec>;
  variable: Record<string, ParsedVariable>;
};

type RelationshipMaps = {
  featureTargets: Record<string, Set<string>>;
  featureTests: Record<string, Set<string>>;
  featureRequiredBy: Record<string, Set<string>>;
  featureRequired: Record<string, Set<string>>;
  featureSegments: Record<string, Set<string>>;
  featureAttributes: Record<string, Set<string>>;
  featureSchemas: Record<string, Set<string>>;
  segmentsUsedInFeatures: Record<string, Set<string>>;
  attributesUsedInFeatures: Record<string, Set<string>>;
  attributesUsedInSegments: Record<string, Set<string>>;
  segmentSegments: Record<string, Set<string>>;
  segmentFeatures: Record<string, Set<string>>;
  segmentVariables: Record<string, Set<string>>;
  segmentAttributes: Record<string, Set<string>>;
  segmentsUsedInSegments: Record<string, Set<string>>;
  featuresUsedInSegments: Record<string, Set<string>>;
  variablesUsedInSegments: Record<string, Set<string>>;
  segmentTargets: Record<string, Set<string>>;
  attributeTargets: Record<string, Set<string>>;
  schemasUsedInFeatures: Record<string, Set<string>>;
  segmentTests: Record<string, Set<string>>;
  targetFeatures: Record<string, Set<string>>;
  targetVariables: Record<string, Set<string>>;
  targetSegments: Record<string, Set<string>>;
  variableFeatures: Record<string, Set<string>>;
  variableSegments: Record<string, Set<string>>;
  variableAttributes: Record<string, Set<string>>;
  variableSchemas: Record<string, Set<string>>;
  variableTargets: Record<string, Set<string>>;
  variableTests: Record<string, Set<string>>;
  featuresUsedInVariables: Record<string, Set<string>>;
  segmentsUsedInVariables: Record<string, Set<string>>;
  attributesUsedInVariables: Record<string, Set<string>>;
  schemasUsedInVariables: Record<string, Set<string>>;
  featureVariables: Record<string, Set<string>>;
  variablesUsedInFeatures: Record<string, Set<string>>;
  variableVariables: Record<string, Set<string>>;
  variablesUsedInVariables: Record<string, Set<string>>;
};

interface SourceFileInfo {
  sourcePath: string;
  absolutePath: string;
}

function colorize(value: string, colorCode: number) {
  return `\x1b[${colorCode}m${value}\x1b[0m`;
}

function prettyDuration(diffInMs: number) {
  let diff = Math.abs(diffInMs);

  if (diff === 0) {
    return "0ms";
  }

  const ms = diff % 1000;
  diff = (diff - ms) / 1000;
  const secs = diff % 60;
  diff = (diff - secs) / 60;
  const mins = diff % 60;
  const hrs = (diff - mins) / 60;
  const parts: string[] = [];

  if (hrs) parts.push(`${hrs}h`);
  if (mins) parts.push(`${mins}m`);
  if (secs) parts.push(`${secs}s`);
  if (ms) parts.push(`${ms}ms`);

  return parts.join(" ");
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatCatalogPath(rootDirectoryPath: string, filePath: string) {
  const relativePath = path.relative(rootDirectoryPath, filePath);

  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath;
  }

  return filePath;
}

class CatalogProgressReporter {
  private readonly startedAt = Date.now();

  constructor(
    private readonly rootDirectoryPath: string,
    private readonly outputDirectoryPath: string,
  ) {}

  start(options: { browserRouter: boolean; sets: boolean }) {
    console.log("");
    console.log(CLI_FORMAT_BOLD, "Generating Featurevisor catalog");
    console.log(
      `  ${colorize("Output", 36)}: ${formatCatalogPath(
        this.rootDirectoryPath,
        this.outputDirectoryPath,
      )}`,
    );
    console.log(`  ${colorize("Router", 36)}: ${options.browserRouter ? "browser" : "hash"}`);
    console.log(`  ${colorize("Sets", 36)}:   ${options.sets ? "enabled" : "none"}`);
    console.log("");
  }

  step(label: string, detail?: string) {
    const suffix = detail ? `: ${colorize(detail, 2)}` : "";
    console.log(`  ${colorize("•", 36)} ${label}${suffix}`);
    return Date.now();
  }

  done(startedAt: number, detail?: string) {
    const suffix = detail ? ` ${detail}` : "";
    console.log(CLI_FORMAT_DIM, `    done in ${prettyDuration(Date.now() - startedAt)}${suffix}`);
  }

  setStart(set: string | undefined) {
    console.log("");
    console.log(CLI_FORMAT_BOLD, set ? `Set "${set}"` : "Root catalog");
    return Date.now();
  }

  complete() {
    console.log("");
    console.log(
      CLI_FORMAT_GREEN,
      `Catalog exported to ${formatCatalogPath(this.rootDirectoryPath, this.outputDirectoryPath)}`,
    );
    console.log(CLI_FORMAT_BOLD, `Time: ${prettyDuration(Date.now() - this.startedAt)}`);
  }
}

function encodeKeyPath(key: string) {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join(path.sep);
}

function encodeKeyUrlPath(key: string) {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

function getRealPath(value: string) {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return value;
  }
}

function runGit(rootDirectoryPath: string, args: string[]) {
  return childProcess.execFileSync("git", ["-C", rootDirectoryPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

async function readAll<T>(keys: string[], read: (key: string) => Promise<T>) {
  const values = await mapLimit(keys, read);
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}

function normalizeScenario(value: Scenario, key: string): TestScenario {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Scenario must be an object");
  }
  const authored = value as unknown as Record<string, unknown>;

  if ("assertions" in authored) {
    throw new Error("Scenarios use checks at the root, without assertions.");
  }
  if (!Array.isArray(authored.checks) || !authored.checks.length) {
    throw new Error("Scenarios require nonempty checks at the root");
  }

  const allowed = [
    "promotable",
    "description",
    "matrix",
    "environment",
    "target",
    "at",
    "context",
    "stickyFeatures",
    "stickyVariables",
    "checks",
    "children",
  ];
  for (const property of Object.keys(authored)) {
    if (!allowed.includes(property)) {
      throw new Error(`Unknown scenario property "${property}"`);
    }
  }

  const { promotable, ...assertion } = authored;
  const children = authored.children;
  if (children !== undefined) {
    if (!Array.isArray(children) || !children.length) {
      throw new Error("Scenario children must be a nonempty array");
    }

    children.forEach((child: unknown, index: number) => {
      if (!child || typeof child !== "object" || Array.isArray(child)) {
        throw new Error(`Scenario child ${index + 1} must be an object`);
      }

      const authoredChild = child as Record<string, unknown>;
      if ("assertions" in authoredChild) {
        throw new Error(`Scenario child ${index + 1} uses checks, without assertions.`);
      }
      if (!Array.isArray(authoredChild.checks) || !authoredChild.checks.length) {
        throw new Error(`Scenario child ${index + 1} requires nonempty checks`);
      }
      for (const property of Object.keys(authoredChild)) {
        if (!["context", "stickyFeatures", "stickyVariables", "checks"].includes(property)) {
          throw new Error(`Unknown scenario child property "${property}"`);
        }
      }
    });
  }

  return {
    scenario: key,
    promotable: promotable as boolean | undefined,
    assertions: [assertion as TestScenario["assertions"][number]],
  };
}

function getTestSummaryFields(testSpec: CatalogTestSpec): Partial<EntitySummary> {
  const test = testSpec.test as unknown as Record<string, unknown>;
  const assertions = Array.isArray(test.assertions) ? test.assertions : [];

  if (testSpec.source === "scenario") {
    const root = (assertions[0] || {}) as Record<string, unknown>;
    const checks = Array.isArray(root.checks) ? root.checks.length : 0;
    const children = Array.isArray(root.children) ? root.children.length : 0;

    return {
      description: typeof root.description === "string" ? root.description : undefined,
      testKind: "scenario",
      testSubject: testSpec.key,
      assertionCount: checks,
      childCount: children,
    };
  }

  const kind = (["feature", "segment", "variable"] as const).find(
    (candidate) => typeof test[candidate] === "string",
  );

  return {
    testKind: kind,
    testSubject: kind ? String(test[kind]) : undefined,
    assertionCount: assertions.length,
  };
}

function getCatalogTestIdentity(source: CatalogTestSource, key: string) {
  return JSON.stringify([source, key]);
}

async function readCatalogTestSpecs(datasource: any, testKeys: string[], scenarioKeys: string[]) {
  const result: Record<string, CatalogTestSpec> = {};
  const entityKeys = new Set(testKeys);
  for (const key of scenarioKeys) {
    if (entityKeys.has(key)) {
      throw new Error(
        `Test identity collision for "${key}": an entity test and scenario share a public key.`,
      );
    }
  }

  for (const key of testKeys) {
    result[getCatalogTestIdentity("test", key)] = {
      key,
      source: "test",
      test: { ...(await datasource.readTest(key)), key },
    };
  }

  for (const key of scenarioKeys) {
    result[getCatalogTestIdentity("scenario", key)] = {
      key,
      source: "scenario",
      test: { ...normalizeScenario(await datasource.readScenario(key), key), key },
    };
  }

  return result;
}

function sortCatalogTestIdentities(value: Set<string> | undefined, maps: EntityMaps) {
  return Array.from(value || []).sort((left, right) => {
    const leftSpec = maps.test[left];
    const rightSpec = maps.test[right];
    return (
      leftSpec.key.localeCompare(rightSpec.key) || leftSpec.source.localeCompare(rightSpec.source)
    );
  });
}

function getCatalogTestKeys(value: Set<string> | undefined, maps: EntityMaps) {
  return sortCatalogTestIdentities(value, maps).map((identity) => maps.test[identity].key);
}

function sortSet(value?: Set<string>) {
  return Array.from(value || []).sort();
}

function addToSet(map: Record<string, Set<string>>, key: string, value: string) {
  if (!map[key]) {
    map[key] = new Set();
  }

  map[key].add(value);
}

function collectSchemaKeys(schema: unknown, result: Set<string>) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  const current = schema as Schema;
  if (typeof current.schema === "string") result.add(current.schema);
  if (current.items) collectSchemaKeys(current.items, result);
  if (current.additionalProperties) collectSchemaKeys(current.additionalProperties, result);
  Object.values(current.properties || {}).forEach((entry) => collectSchemaKeys(entry, result));
  (current.oneOf || []).forEach((entry) => collectSchemaKeys(entry, result));
}

function collectSchemaKeysFromVariables(
  variablesSchema: ParsedFeature["variablesSchema"],
  result: Set<string>,
) {
  Object.values(variablesSchema || {}).forEach((schema) => collectSchemaKeys(schema, result));
}

function expandSchemaKeys(schemaKeys: Set<string>, schemas: Record<string, Schema>) {
  const pending = Array.from(schemaKeys);
  for (let index = 0; index < pending.length; index++) {
    const nested = new Set<string>();
    collectSchemaKeys(schemas[pending[index]], nested);
    for (const key of nested) {
      if (!schemaKeys.has(key)) {
        schemaKeys.add(key);
        pending.push(key);
      }
    }
  }
}

function getHistoryEntityKey(type: CatalogHistoryEntityType, key: string, set?: string) {
  return `${set || ""}\x1f${type}\x1f${key}`;
}

function toLastModified(entry: CatalogHistoryEntry): LastModified {
  return {
    commit: entry.commit,
    author: entry.author,
    timestamp: entry.timestamp,
  };
}

function getLastModified(
  historyIndex: CatalogHistoryIndex,
  type: CatalogHistoryEntityType,
  key: string,
  set?: string,
): LastModified | undefined {
  return historyIndex.lastModifiedByEntity[getHistoryEntityKey(type, key, set)];
}

function getEntitySummary(
  entity: Record<string, any>,
  type: CatalogEntityType,
  key: string,
  historyIndex: CatalogHistoryIndex,
  set?: string,
  extra: Partial<EntitySummary> = {},
): EntitySummary {
  return {
    key,
    description: entity.description,
    archived: entity.archived,
    deprecated: entity.deprecated,
    promotable: entity.promotable,
    searchTerms: getSearchTerms(type, entity),
    ...extra,
    lastModified: getLastModified(historyIndex, type, key, set),
    href: `entities/${type}/${encodeKeyUrlPath(key)}.json`,
  };
}

const SEARCH_TERM_LIMIT = 60;
const SEARCH_VALUE_LENGTH = 120;

/**
 * Authored names and values worth finding from search, as "kind:value" strings.
 * Kinds are rule, override, value and assertion.
 */
function getSearchTerms(type: CatalogEntityType, entity: Record<string, any>) {
  const terms = new Set<string>();
  const add = (kind: string, value: unknown) => {
    if (terms.size >= SEARCH_TERM_LIMIT) return;
    if (typeof value === "number" || typeof value === "boolean") value = String(value);
    if (typeof value !== "string") return;
    const text = value.trim();
    if (!text || text.length > SEARCH_VALUE_LENGTH) return;
    terms.add(`${kind}:${text}`);
  };
  const listsOf = (value: unknown): unknown[][] =>
    Array.isArray(value)
      ? [value]
      : value && typeof value === "object"
        ? Object.values(value).filter(Array.isArray)
        : [];
  const collectConditionValues = (conditions: unknown) => {
    if (Array.isArray(conditions)) {
      conditions.forEach(collectConditionValues);
      return;
    }
    if (typeof conditions === "string") {
      if (conditions !== "*") add("segment", conditions);
      return;
    }
    if (!conditions || typeof conditions !== "object") return;
    const record = conditions as Record<string, unknown>;
    for (const operator of ["and", "or", "not"]) {
      if (operator in record) collectConditionValues(record[operator]);
    }
    add("attribute", record.attribute);
    add("feature", record.feature);
    add("variable", record.variable);
    add("path", Array.isArray(record.path) ? record.path.join(".") : record.path);
    add("variation", record.variation);
    const values = Array.isArray(record.value) ? record.value : [record.value];
    values.forEach((value) => add("value", value));
  };
  const collectOverrides = (overrides: unknown, parents: string[] = []) => {
    if (!Array.isArray(overrides)) return;
    for (const override of overrides) {
      if (!override || typeof override !== "object") continue;
      const path = typeof override.key === "string" ? [...parents, override.key] : parents;
      if (typeof override.key === "string") add("override", path.join(" › "));
      // Scalars only. Objects and arrays are not searchable text.
      add("value", override.value);
      collectConditionValues(override.conditions);
      collectOverrides(override.overrides, path);
    }
  };

  const collectVariableOverrides = (owner: unknown) => {
    const byVariable = (owner as { variableOverrides?: unknown } | undefined)?.variableOverrides;
    if (!byVariable || typeof byVariable !== "object") return;
    for (const overrides of Object.values(byVariable)) collectOverrides(overrides);
  };

  collectConditionValues(entity.conditions);
  if (type === "feature") {
    for (const rules of listsOf(entity.rules)) {
      for (const rule of rules as Array<Record<string, unknown>>) {
        add("rule", rule?.key);
        collectConditionValues(rule?.conditions);
        collectVariableOverrides(rule);
      }
    }
    for (const forces of listsOf(entity.force)) {
      for (const force of forces as Array<Record<string, unknown>>)
        collectConditionValues(force?.conditions);
    }
    // Variation values and variable keys already have their own index columns, which
    // search reads directly, so they are not repeated here.
    for (const variation of entity.variations || []) collectVariableOverrides(variation);
  } else if (type === "variable") {
    if (typeof entity.compose === "string") add("source", entity.compose);
    for (const [alias, source] of Object.entries(
      typeof entity.compose === "string" ? {} : entity.compose || {},
    ) as Array<[string, { feature?: string; variable?: string }]>) {
      add("alias", alias);
      add("source", source.feature);
      add("source", source.variable);
    }
    add("value", entity.defaultValue);
    add("value", entity.disabledValue);
    for (const overrides of listsOf(entity.overrides)) collectOverrides(overrides);
  } else if (type === "segment") {
    collectConditionValues(entity.conditions);
  } else if (type === "test") {
    for (const assertion of entity.assertions || []) add("assertion", assertion?.description);
  }

  return terms.size ? [...terms] : undefined;
}

function getVariableType(entity: Record<string, any>, maps: EntityMaps): string | undefined {
  if (typeof entity.compose !== "string") {
    return entity.compose !== undefined
      ? "object"
      : typeof entity.type === "string"
        ? entity.type
        : typeof entity.schema === "string"
          ? entity.schema
          : Array.isArray(entity.oneOf)
            ? "oneOf"
            : undefined;
  }
  const visited = new Set<object>();
  let source: Record<string, any> | undefined = maps.variable[entity.compose];
  while (source && !visited.has(source)) {
    visited.add(source);
    if (typeof source.compose === "string") source = maps.variable[source.compose];
    else if (source.compose !== undefined) return "object";
    else if (typeof source.type === "string") return source.type;
    else if (typeof source.schema === "string") source = maps.schema[source.schema];
    else return Array.isArray(source.oneOf) ? "oneOf" : undefined;
  }
  return undefined;
}

function getSummaryTags(entity: Record<string, any>, type: CatalogEntityType) {
  if (type !== "target") return Array.isArray(entity.tags) ? entity.tags : undefined;
  // Summary tags are mentions for filtering, not the Target's selection semantics.
  const tags = new Set<string>();
  const visit = (selector: unknown) => {
    if (typeof selector === "string") tags.add(selector);
    else if (Array.isArray(selector)) selector.forEach(visit);
    else if (selector && typeof selector === "object") {
      for (const operator of ["and", "or", "not"]) visit(selector[operator]);
    }
  };
  visit(entity.tag);
  visit(entity.tags);
  const mentions = [...tags];
  return mentions.length ? mentions : undefined;
}

function toSearchableScalar(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function getFeatureVariationValues(feature: ParsedFeature) {
  return (feature.variations || [])
    .map((variation) => toSearchableScalar(variation.value))
    .filter((value): value is string => Boolean(value));
}

function getFeatureVariableKeys(feature: ParsedFeature) {
  return Object.keys(feature.variablesSchema || {}).sort();
}

function getFeatureEnvironmentKeys(feature: ParsedFeature, environments?: string[]) {
  if (!Array.isArray(environments) || environments.length === 0) {
    return undefined;
  }

  const found = new Set<string>();

  for (const key of ["rules", "force", "expose"] as const) {
    const value = feature[key] as Record<string, unknown> | unknown[] | undefined;

    if (value && !Array.isArray(value) && typeof value === "object") {
      for (const environment of Object.keys(value)) {
        if (environments.includes(environment)) {
          found.add(environment);
        }
      }
    }
  }

  return Array.from(found).sort();
}

function getFeatureRulesForEnvironment(feature: ParsedFeature, environment: string) {
  if (Array.isArray(feature.rules)) {
    return feature.rules;
  }

  return feature.rules?.[environment] || [];
}

function isFeatureExposedInEnvironment(feature: ParsedFeature, environment: string) {
  const featureExpose = feature.expose as Record<string, unknown> | boolean | undefined;
  const rules = feature.rules as Record<string, any> | any[] | undefined;
  const environmentRules = !Array.isArray(rules) ? rules?.[environment] : undefined;

  if (environmentRules?.expose === false) {
    return false;
  }

  if (featureExpose === false) {
    return false;
  }

  if (
    featureExpose &&
    typeof featureExpose === "object" &&
    !Array.isArray(featureExpose) &&
    featureExpose[environment] === false
  ) {
    return false;
  }

  return true;
}

function isFeatureEnabledInEnvironment(feature: ParsedFeature, environment: string) {
  if (feature.archived === true) {
    return false;
  }

  if (!isFeatureExposedInEnvironment(feature, environment)) {
    return false;
  }

  return getFeatureRulesForEnvironment(feature, environment).some(
    (rule: { percentage?: number }) => (rule.percentage || 0) > 0,
  );
}

function stripDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDescriptions);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "description")
      .map(([key, item]) => [key, stripDescriptions(item)]),
  );
}

/** Whether rules, force entries or exposure differ between environments, ignoring descriptions. */
function getFeatureEnvironmentsDiffer(feature: ParsedFeature, environments?: string[]) {
  if (!environments || environments.length < 2 || Array.isArray(feature.rules)) return undefined;

  const signatures = new Set(
    environments.map((environment) =>
      JSON.stringify(
        stripDescriptions([
          (feature.rules as Record<string, unknown> | undefined)?.[environment],
          (feature.force as Record<string, unknown> | undefined)?.[environment],
          feature.expose && typeof feature.expose === "object"
            ? (feature.expose as Record<string, unknown>)[environment]
            : feature.expose,
        ]),
      ),
    ),
  );

  return signatures.size > 1;
}

function getFeatureEnvironmentStatus(
  feature: ParsedFeature,
): Pick<EntitySummary, "environmentStatus" | "environmentStatusEnvironment"> {
  // Without environments, rules are a flat list and the feature is simply live or not.
  if (Array.isArray(feature.rules)) {
    const enabled =
      feature.archived !== true &&
      feature.expose !== false &&
      feature.rules.some((rule: { percentage?: number }) => (rule.percentage || 0) > 0);

    return { environmentStatus: enabled ? "enabled" : "disabled" };
  }

  const environments = Object.keys(feature.rules || {});
  const productionEnvironment = environments.find((environment) =>
    environment.toLowerCase().startsWith("prod"),
  );

  if (!productionEnvironment) {
    return {};
  }

  if (isFeatureEnabledInEnvironment(feature, productionEnvironment)) {
    return {
      environmentStatus: "production",
      environmentStatusEnvironment: productionEnvironment,
    };
  }

  for (const environment of environments) {
    if (isFeatureEnabledInEnvironment(feature, environment)) {
      return {
        environmentStatus: "other",
        environmentStatusEnvironment: productionEnvironment,
      };
    }
  }

  return {
    environmentStatus: "disabled",
    environmentStatusEnvironment: productionEnvironment,
  };
}

function toCatalogHistoryEntry(entry: HistoryEntry, set?: string): CatalogHistoryEntry {
  return {
    commit: entry.commit,
    subject: entry.subject,
    author: entry.author,
    timestamp: entry.timestamp,
    entities: entry.entities.map((entity) => ({
      type: entity.type,
      key: entity.key,
      set,
    })),
  };
}

/** Read commit subjects for the given hashes in one Git call. Missing Git is not an error. */
function readCommitSubjects(rootDirectoryPath: string | undefined, commits: string[]) {
  const subjects = new Map<string, string>();
  if (!rootDirectoryPath || commits.length === 0) return subjects;

  try {
    const output = childProcess.execFileSync(
      "git",
      ["-C", rootDirectoryPath, "log", "--no-walk", "--stdin", "--format=%H%x1f%s"],
      { encoding: "utf8", input: commits.join("\n"), stdio: ["pipe", "pipe", "ignore"] },
    );
    const wanted = new Set(commits);
    const lengths = [...new Set(commits.map((commit) => commit.length))];
    for (const line of output.split("\n")) {
      const separator = line.indexOf("\x1f");
      if (separator === -1) continue;
      const hash = line.slice(0, separator);
      const subject = line.slice(separator + 1);
      if (!hash || subject === undefined) continue;
      for (const length of lengths) {
        const commit = hash.slice(0, length);
        if (wanted.has(commit)) subjects.set(commit, subject);
      }
    }
  } catch {
    // Catalog still works without subjects, for example outside a Git checkout.
  }

  return subjects;
}

async function getGitHistoryIndex(
  projectConfig: any,
  datasource: any,
  rootDirectoryPath?: string,
): Promise<CatalogHistoryIndex> {
  const rootEntries = (await datasource.listHistoryEntries()).map((entry: HistoryEntry) =>
    toCatalogHistoryEntry(entry),
  );
  const bySet: Record<string, CatalogHistoryEntry[]> = {};
  const entries = [...rootEntries];

  if (projectConfig.sets) {
    for (const set of await datasource.listSets()) {
      const setDatasource = datasource.forSet(set);
      bySet[set] = (await setDatasource.listHistoryEntries()).map((entry: HistoryEntry) =>
        toCatalogHistoryEntry(entry, set),
      );
      entries.push(...bySet[set]);
    }
  }

  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const subjects = readCommitSubjects(rootDirectoryPath, [
    ...new Set(entries.filter((entry) => entry.subject === undefined).map((entry) => entry.commit)),
  ]);
  for (const entry of entries) {
    const subject = subjects.get(entry.commit);
    if (entry.subject === undefined && subject) entry.subject = subject;
  }

  const byEntity: Record<string, CatalogHistoryEntry[]> = {};
  const lastModifiedByEntity: Record<string, LastModified> = {};

  for (const entry of entries) {
    for (const entity of entry.entities) {
      const key = getHistoryEntityKey(entity.type, entity.key, entity.set);
      if (!byEntity[key]) {
        byEntity[key] = [];
      }

      byEntity[key].push(entry);

      if (!lastModifiedByEntity[key]) {
        lastModifiedByEntity[key] = toLastModified(entry);
      }
    }
  }

  return {
    entries,
    bySet,
    byEntity,
    lastModifiedByEntity,
  };
}

async function writeHistoryPages(
  writer: Pick<CatalogStorageWriter, "write">,
  outputDirectoryPath: string,
  entries: CatalogHistoryEntry[],
) {
  const totalPages = Math.max(1, Math.ceil(entries.length / CATALOG_HISTORY_PAGE_SIZE));

  for (let page = 1; page <= totalPages; page++) {
    await writer.write(path.join(outputDirectoryPath, `page-${page}.json`), {
      page,
      pageSize: CATALOG_HISTORY_PAGE_SIZE,
      totalPages,
      entries: entries.slice(
        (page - 1) * CATALOG_HISTORY_PAGE_SIZE,
        page * CATALOG_HISTORY_PAGE_SIZE,
      ),
    });
  }
}

function getEntityFilePath(
  projectConfig: any,
  datasource: any,
  type: CatalogEntityType,
  key: string,
) {
  const directoryByType: Record<CatalogEntityType, string> = {
    feature: projectConfig.featuresDirectoryPath,
    segment: projectConfig.segmentsDirectoryPath,
    attribute: projectConfig.attributesDirectoryPath,
    target: projectConfig.targetsDirectoryPath,
    variable: projectConfig.variablesDirectoryPath,
    schema: projectConfig.schemasDirectoryPath,
    test: projectConfig.testsDirectoryPath,
  };
  const pathSegments = projectConfig.namespaceCharacter
    ? key.split(projectConfig.namespaceCharacter)
    : [key];
  const testSuffixes = ["spec", "feature", "segment"];

  if (
    type === "test" &&
    pathSegments.length > 1 &&
    testSuffixes.includes(pathSegments[pathSegments.length - 1])
  ) {
    const suffix = pathSegments.pop();
    pathSegments[pathSegments.length - 1] += `.${suffix}`;
  }
  const filePath = pathSegments.join(path.sep);

  return path.join(directoryByType[type], `${filePath}.${datasource.getExtension()}`);
}

function getSourceFileInfo(
  repositorySourceRootDirectoryPath: string,
  projectConfig: any,
  datasource: any,
  type: CatalogEntityType,
  key: string,
  options: {
    resolveAbsolutePath?: boolean;
    /** Real paths already resolved in this watch session. */
    realPaths?: Map<string, string>;
    testSource?: CatalogTestSource;
  } = {},
): SourceFileInfo {
  const filePath = path.resolve(
    type === "test" && options.testSource === "scenario"
      ? datasource.getScenarioSourcePath
        ? datasource.getScenarioSourcePath(key)
        : getEntityFilePath(
            projectConfig,
            datasource,
            type,
            key.endsWith(".spec") ? key : `${key}.spec`,
          )
      : type === "test" && datasource.getTestSourcePath
        ? datasource.getTestSourcePath(key)
        : getEntityFilePath(
            projectConfig,
            datasource,
            type,
            type === "test" && !key.endsWith(".spec") ? `${key}.spec` : key,
          ),
  );
  let absolutePath = filePath;
  if (options.resolveAbsolutePath) {
    absolutePath = options.realPaths?.get(filePath) ?? getRealPath(filePath);
    options.realPaths?.set(filePath, absolutePath);
  }

  return {
    sourcePath: toPosixPath(path.relative(repositorySourceRootDirectoryPath, filePath)),
    absolutePath,
  };
}

function isExecutableFile(filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }

    if (process.platform === "win32") {
      return true;
    }

    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasCommandInPath(command: string) {
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];

  return pathEntries.some((entry) =>
    extensions.some((extension) => isExecutableFile(path.join(entry, `${command}${extension}`))),
  );
}

function hasKnownEditorInstall(editor: DevEditor["id"]) {
  if (hasCommandInPath(editor === "cursor" ? "cursor" : "code")) {
    return true;
  }

  if (process.platform === "darwin") {
    const appName = editor === "cursor" ? "Cursor.app" : "Visual Studio Code.app";

    return [
      path.join("/Applications", appName),
      path.join(process.env.HOME || "", "Applications", appName),
    ].some((appPath) => fs.existsSync(appPath));
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.ProgramFiles || "";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "";
    const candidates =
      editor === "cursor"
        ? [
            path.join(localAppData, "Programs", "Cursor", "Cursor.exe"),
            path.join(programFiles, "Cursor", "Cursor.exe"),
            path.join(programFilesX86, "Cursor", "Cursor.exe"),
          ]
        : [
            path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"),
            path.join(programFiles, "Microsoft VS Code", "Code.exe"),
            path.join(programFilesX86, "Microsoft VS Code", "Code.exe"),
          ];

    return candidates.some((candidate) => fs.existsSync(candidate));
  }

  return false;
}

function detectDevEditors(): DevEditor[] {
  const editors: DevEditor[] = [];

  if (hasKnownEditorInstall("cursor")) {
    editors.push({ id: "cursor", label: "Cursor" });
  }

  if (hasKnownEditorInstall("vscode")) {
    editors.push({ id: "vscode", label: "VS Code" });
  }

  return editors;
}

function encodeEditorPath(filePath: string) {
  return encodeURI(filePath.split(path.sep).join("/")).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

function getEditorUri(editor: DevEditor["id"], filePath: string) {
  return `${editor === "cursor" ? "cursor" : "vscode"}://file/${encodeEditorPath(filePath)}`;
}

function getEditorLinks(editors: DevEditor[], sourceFileInfo: SourceFileInfo) {
  if (editors.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    editors.map((editor) => [editor.id, getEditorUri(editor.id, sourceFileInfo.absolutePath)]),
  );
}

function getCurrentBranch(rootDirectoryPath: string) {
  try {
    return runGit(rootDirectoryPath, ["symbolic-ref", "--short", "HEAD"]).trim() || "HEAD";
  } catch {
    return "HEAD";
  }
}

type RepositoryBranch = { name: string; kind: "configured" | "default" | "checkout" };

/**
 * The branch to link to, and how it was found: an explicit option, then origin's default
 * branch, then the checked out branch. Detached CI checkouts often have neither, and no
 * branch is guessed then. Source links fall back to the exported commit instead.
 */
function getRepositoryBranch(
  rootDirectoryPath: string,
  configured?: string,
): RepositoryBranch | undefined {
  if (configured?.trim()) return { name: configured.trim(), kind: "configured" };
  try {
    const remoteHead = runGit(rootDirectoryPath, [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]).trim();
    if (remoteHead.startsWith("origin/"))
      return { name: remoteHead.slice("origin/".length), kind: "default" };
  } catch {
    // Shallow CI checkouts often have no origin HEAD.
  }
  const current = getCurrentBranch(rootDirectoryPath);
  return current && current !== "HEAD" ? { name: current, kind: "checkout" } : undefined;
}

function getHeadCommit(rootDirectoryPath: string) {
  try {
    return runGit(rootDirectoryPath, ["rev-parse", "HEAD"]).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Branch names may contain characters that are special in URLs, but keep their slashes. */
function encodeRefPath(value: string) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function getRepositoryRootDirectoryPath(rootDirectoryPath: string) {
  try {
    return (
      getRealPath(runGit(rootDirectoryPath, ["rev-parse", "--show-toplevel"]).trim()) ||
      getRealPath(rootDirectoryPath)
    );
  } catch {
    return getRealPath(rootDirectoryPath);
  }
}

function getRepositorySourceRootDirectoryPath(rootDirectoryPath: string) {
  try {
    const gitRootDirectoryPath =
      runGit(rootDirectoryPath, ["rev-parse", "--show-toplevel"]).trim() || rootDirectoryPath;
    const realRootDirectoryPath = getRealPath(rootDirectoryPath);

    if (realRootDirectoryPath !== rootDirectoryPath) {
      return path.resolve(
        rootDirectoryPath,
        path.relative(realRootDirectoryPath, gitRootDirectoryPath),
      );
    }

    return gitRootDirectoryPath;
  } catch {
    return rootDirectoryPath;
  }
}

function getOwnerAndRepoFromGitRemote(origin: string, host: string) {
  const escapedHost = host.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const match = origin.match(new RegExp(`${escapedHost}[:/]([^/]+)/(.+?)(?:\\.git)?$`));

  if (!match) {
    return undefined;
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

function getRepoLinks(
  rootDirectoryPath: string,
  configuredBranch?: string,
): CatalogManifest["links"] {
  try {
    const origin = runGit(rootDirectoryPath, ["config", "--get", "remote.origin.url"]).trim();
    const repositoryBranch = getRepositoryBranch(rootDirectoryPath, configuredBranch);
    const viewRef = repositoryBranch?.name || getHeadCommit(rootDirectoryPath);
    if (!viewRef) return undefined;
    const branch = encodeRefPath(viewRef);
    const providers: Record<
      NonNullable<NonNullable<CatalogManifest["links"]>["provider"]>,
      {
        host: string;
        repository: (owner: string, repo: string) => string;
        source: (owner: string, repo: string) => string;
        edit: (owner: string, repo: string) => string;
        commit: (owner: string, repo: string) => string;
      }
    > = {
      github: {
        host: "github.com",
        repository: (owner, repo) => `https://github.com/${owner}/${repo}`,
        source: (owner, repo) => `https://github.com/${owner}/${repo}/blob/${branch}/{{path}}`,
        edit: (owner, repo) => `https://github.com/${owner}/${repo}/edit/${branch}/{{path}}`,
        commit: (owner, repo) => `https://github.com/${owner}/${repo}/commit/{{hash}}`,
      },
      gitlab: {
        host: "gitlab.com",
        repository: (owner, repo) => `https://gitlab.com/${owner}/${repo}`,
        source: (owner, repo) => `https://gitlab.com/${owner}/${repo}/-/blob/${branch}/{{path}}`,
        edit: (owner, repo) => `https://gitlab.com/${owner}/${repo}/-/edit/${branch}/{{path}}`,
        commit: (owner, repo) => `https://gitlab.com/${owner}/${repo}/-/commit/{{hash}}`,
      },
      bitbucket: {
        host: "bitbucket.org",
        repository: (owner, repo) => `https://bitbucket.org/${owner}/${repo}`,
        source: (owner, repo) => `https://bitbucket.org/${owner}/${repo}/src/${branch}/{{path}}`,
        edit: (owner, repo) =>
          `https://bitbucket.org/${owner}/${repo}/src/${branch}/{{path}}?mode=edit&at=${branch}`,
        commit: (owner, repo) => `https://bitbucket.org/${owner}/${repo}/commits/{{hash}}`,
      },
    };

    for (const provider of Object.keys(providers) as Array<
      NonNullable<NonNullable<CatalogManifest["links"]>["provider"]>
    >) {
      const config = providers[provider];
      const details = getOwnerAndRepoFromGitRemote(origin, config.host);

      if (details) {
        return {
          provider,
          repository: config.repository(details.owner, details.repo),
          source: config.source(details.owner, details.repo),
          // Proposing a change needs a branch. A commit can only be viewed.
          ...(repositoryBranch
            ? {
                edit: config.edit(details.owner, details.repo),
                branch: repositoryBranch.name,
                branchKind: repositoryBranch.kind,
              }
            : {}),
          commit: config.commit(details.owner, details.repo),
        };
      }
    }
  } catch {
    return undefined;
  }
}

type AccumulationStep = NonNullable<EntityDetail["accumulationPreview"]>[string][number];

function hasContinuation(overrides: unknown): boolean {
  return (Array.isArray(overrides) ? overrides : []).some(
    (override) =>
      override?.continue === true ||
      hasContinuation((override as { overrides?: unknown })?.overrides),
  );
}

/**
 * For global variables with continuing overrides, record the value after each
 * step on the path where every selector matches, using the builder's semantics.
 */
function buildAccumulationPreviews(
  maps: EntityMaps,
  resolve?: (variable: any, override: any, baseValue: any) => any,
) {
  const previews = new Map<string, NonNullable<EntityDetail["accumulationPreview"]>>();
  if (!resolve) return previews;

  for (const [variableKey, variable] of Object.entries(maps.variable)) {
    const record = variable as unknown as Record<string, unknown>;
    if (record.compose !== undefined) continue;
    const byEnvironment: Array<[string, unknown]> = Array.isArray(record.overrides)
      ? [["", record.overrides]]
      : Object.entries((record.overrides || {}) as Record<string, unknown>);
    const preview: NonNullable<EntityDetail["accumulationPreview"]> = {};

    for (const [environment, overrides] of byEnvironment) {
      if (!hasContinuation(overrides)) continue;
      const steps: AccumulationStep[] = [];

      const walk = (list: unknown, base: unknown, prefix: string[]): unknown => {
        let value = base;
        const items = Array.isArray(list) ? list : [];
        for (let index = 0; index < items.length; index += 1) {
          const override = (items[index] || {}) as Record<string, unknown>;
          const path = [
            ...prefix,
            typeof override.key === "string" ? override.key : `#${index + 1}`,
          ];
          let error: string | undefined;
          try {
            value = resolve(variable, override, value);
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
          }
          steps.push({
            path,
            value: JSON.parse(JSON.stringify(value ?? null)),
            continues: override.continue === true,
            error,
          });
          if (Array.isArray(override.overrides)) value = walk(override.overrides, value, path);
          if (override.continue !== true) {
            items.slice(index + 1).forEach((skipped, skippedIndex) => {
              const skippedRecord = (skipped || {}) as Record<string, unknown>;
              steps.push({
                path: [
                  ...prefix,
                  typeof skippedRecord.key === "string"
                    ? skippedRecord.key
                    : `#${index + skippedIndex + 2}`,
                ],
                skipped: true,
                continues: skippedRecord.continue === true,
              });
            });
            break;
          }
        }
        return value;
      };

      walk(overrides, record.defaultValue, []);
      preview[environment] = steps;
    }

    if (Object.keys(preview).length > 0) previews.set(variableKey, preview);
  }

  return previews;
}

/**
 * Record where each segment, attribute, feature and global variable is used,
 * down to the rule, force entry, override path or requirement that refers to it.
 */
function buildUsageLocations(maps: EntityMaps) {
  // For each referenced entity, every owner's references in authored order.
  const usage = new Map<
    string,
    Map<string, { owner: EntityReference; references: AuthoredReference[] }>
  >();

  for (const type of ["feature", "variable", "segment"] as const) {
    for (const [key, entity] of Object.entries(maps[type])) {
      const ownerId = `${type}:${key}`;
      for (const reference of collectAuthoredReferences(
        type,
        entity as unknown as Record<string, unknown>,
      )) {
        const target = `${reference.type}:${reference.key}`;
        const byOwner = usage.get(target) || new Map();
        const entry = byOwner.get(ownerId) || { owner: { type, key }, references: [] };
        entry.references.push(reference);
        byOwner.set(ownerId, entry);
        usage.set(target, byOwner);
      }
    }
  }

  const ownerOrder: CatalogEntityType[] = ["feature", "variable", "segment"];
  const result = new Map<string, NonNullable<EntityDetail["usedBy"]>>();

  for (const [targetId, byOwner] of usage) {
    result.set(
      targetId,
      [...byOwner.values()]
        .map(({ owner, references }) => {
          const [{ locations, checks }] = groupAuthoredReferences(references);
          return { ...owner, locations, ...(checks ? { checks } : {}) };
        })
        .sort(
          (left, right) =>
            ownerOrder.indexOf(left.type) - ownerOrder.indexOf(right.type) ||
            left.key.localeCompare(right.key),
        ),
    );
  }

  return result;
}

const CONDITION_VALUE_LIMIT = 24;

/**
 * Every condition that reads an attribute, wherever it is authored (segments, rules,
 * force entries and variable overrides), grouped by attribute path and operator. This
 * answers "which values does the SDK need to send for this attribute?".
 */
function buildAttributeConditionValues(maps: EntityMaps) {
  type Owner = { type: "segment" | "feature" | "variable"; key: string };
  type Entry = {
    path: string;
    operator: string;
    values: Map<string, unknown>;
    users: Map<string, Map<string, Owner>>;
    uses: number;
  };
  const byAttribute = new Map<string, Map<string, Entry>>();
  let owner: Owner = { type: "segment", key: "" };

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;

    if (typeof record.attribute === "string" && typeof record.operator === "string") {
      const attributePath = record.attribute;
      const attributeKey = attributePath.split(".")[0];
      const entries = byAttribute.get(attributeKey) || new Map<string, Entry>();
      const id = `${attributePath}\u0000${record.operator}`;
      const entry = entries.get(id) || {
        path: attributePath,
        operator: record.operator,
        values: new Map(),
        users: new Map(),
        uses: 0,
      };

      entry.uses += 1;
      if ("value" in record) {
        for (const item of Array.isArray(record.value) ? record.value : [record.value]) {
          const id = JSON.stringify(item);
          entry.values.set(id, item);
          const users = entry.users.get(id) || new Map<string, Owner>();
          users.set(`${owner.type}:${owner.key}`, owner);
          entry.users.set(id, users);
        }
      }
      entries.set(id, entry);
      byAttribute.set(attributeKey, entries);
      return;
    }

    Object.values(record).forEach(visit);
  }

  for (const type of ["segment", "feature", "variable"] as const) {
    for (const [key, entity] of Object.entries(maps[type])) {
      owner = { type, key };
      visit(entity);
    }
  }

  const result = new Map<string, NonNullable<EntityDetail["conditionValues"]>>();

  for (const [attributeKey, entries] of byAttribute) {
    result.set(
      attributeKey,
      [...entries.values()]
        .map((entry) => {
          const values = [...entry.values.entries()].sort(([, left], [, right]) =>
            String(left).localeCompare(String(right), undefined, { numeric: true }),
          );
          const shown = values.slice(0, CONDITION_VALUE_LIMIT);

          return {
            path: entry.path,
            operator: entry.operator,
            uses: entry.uses,
            values: shown.map(([, value]) => value),
            users: shown.map(([id]) =>
              [...(entry.users.get(id)?.values() || [])]
                .sort(
                  (left, right) =>
                    left.type.localeCompare(right.type) || left.key.localeCompare(right.key),
                )
                .slice(0, CONDITION_VALUE_LIMIT),
            ),
            // Common values can be compared in thousands of places. The Usage tab lists them all.
            moreUsers: shown.some(
              ([id]) => (entry.users.get(id)?.size || 0) > CONDITION_VALUE_LIMIT,
            )
              ? shown.map(([id]) =>
                  Math.max(0, (entry.users.get(id)?.size || 0) - CONDITION_VALUE_LIMIT),
                )
              : undefined,
            moreValues: Math.max(0, values.length - CONDITION_VALUE_LIMIT) || undefined,
          };
        })
        .sort((left, right) => left.path.localeCompare(right.path) || right.uses - left.uses),
    );
  }

  return result;
}

/** One graph over every direct reference, bucketBy included, since a feature reads that too. */
function buildCatalogDependencyGraph(usage: ReturnType<typeof buildUsageLocations>) {
  const edges: Array<[string, string]> = [];
  for (const [reference, owners] of usage) {
    for (const owner of owners) edges.push([toNodeId(owner.type, owner.key), reference]);
  }
  return new DependencyGraph(edges);
}

/** Whether a graph node names a defined entity, so lists never link to a missing page. */
function createNodeExists(maps: EntityMaps) {
  return (node: string) => {
    const { type, key } = fromNodeId(node);
    const entities = maps[type as keyof EntityMaps] as Record<string, unknown> | undefined;
    return Boolean(entities && Object.prototype.hasOwnProperty.call(entities, key));
  };
}

/**
 * How many features and variables use a segment, attribute or schema, counted once each,
 * directly or through other entities. Zero means none does, which the Catalog reports as unused,
 * even when an unused segment still refers to it.
 */
function getUsedByCount(type: CatalogEntityType, key: string, relationships: RelationshipMaps) {
  const count = (...sets: Array<Set<string> | undefined>) =>
    sets.reduce((total, set) => total + (set?.size || 0), 0);
  if (type === "segment")
    return count(
      relationships.segmentsUsedInFeatures[key],
      relationships.segmentsUsedInVariables[key],
    );
  if (type === "attribute")
    return count(
      relationships.attributesUsedInFeatures[key],
      relationships.attributesUsedInVariables[key],
    );
  if (type === "schema")
    return count(
      relationships.schemasUsedInFeatures[key],
      relationships.schemasUsedInVariables[key],
    );
  return undefined;
}

/** Features and variables depending on an entity, directly or not, for list summaries. */
function getDependentCounts(type: CatalogEntityType, key: string, relationships: RelationshipMaps) {
  const sets: Partial<
    Record<CatalogEntityType, [Set<string> | undefined, Set<string> | undefined]>
  > = {
    feature: [relationships.featureRequiredBy[key], relationships.featuresUsedInVariables[key]],
    variable: [
      relationships.variablesUsedInFeatures[key],
      relationships.variablesUsedInVariables[key],
    ],
    segment: [
      relationships.segmentsUsedInFeatures[key],
      relationships.segmentsUsedInVariables[key],
    ],
    attribute: [
      relationships.attributesUsedInFeatures[key],
      relationships.attributesUsedInVariables[key],
    ],
  };
  const [features, variables] = sets[type] || [];
  return {
    usedInFeatureCount: features?.size || undefined,
    usedInVariableCount: variables?.size || undefined,
  };
}

/**
 * What an entity refers to directly, for the index, and whether anything it depends on, directly
 * or not, is a deprecated feature. Pages rebuild the whole graph from these direct references.
 */
function getDependencySummary(
  type: CatalogEntityType,
  key: string,
  graph: DependencyGraph,
  maps: EntityMaps,
  exists: (node: string) => boolean,
) {
  if (type !== "feature" && type !== "variable" && type !== "segment") return {};
  const id = toNodeId(type, key);
  const references = graph.direct(id, "dependencies").filter(exists);
  const dependsOnDeprecated = [...graph.reach(id, "dependencies").keys()].some(
    (node) => node.startsWith("feature:") && maps.feature[node.slice(8)]?.deprecated === true,
  );
  return {
    references: references.length ? references : undefined,
    dependsOnDeprecated: dependsOnDeprecated || undefined,
  };
}

/**
 * For each feature and variable in a Target's datafile, the features and variables there that
 * require it, directly or through segments. Pages work out the same for segments from the index.
 */
function getTargetContentRequiredBy(
  targetKey: string,
  relationships: RelationshipMaps,
  graph: DependencyGraph,
) {
  const features = relationships.targetFeatures[targetKey] || new Set<string>();
  const variables = relationships.targetVariables[targetKey] || new Set<string>();
  const result: NonNullable<EntityDetail["contentRequiredBy"]> = {};
  const contents: Array<[CatalogEntityType, Set<string>]> = [
    ["feature", features],
    ["variable", variables],
  ];
  for (const [type, keys] of contents) {
    for (const key of keys) {
      const owners = graph
        .nearestOwners(toNodeId(type, key))
        .map(fromNodeId)
        .filter((owner) =>
          owner.type === "feature" ? features.has(owner.key) : variables.has(owner.key),
        ) as Array<{ type: "feature" | "variable"; key: string }>;
      if (owners.length) result[toNodeId(type, key)] = owners;
    }
  }

  return Object.keys(result).length ? result : undefined;
}

/**
 * Entities a Target holds only because something it selected depends on them, each with the
 * nearest chain back to a selected feature or variable. Core decides which ones these are.
 */
function getTargetContentPulledIn(membership: CatalogTargetMembership, graph: DependencyGraph) {
  const pulledIn = [
    ...(membership.dependencyFeatures || []).map((key) => toNodeId("feature", key)),
    ...(membership.dependencyVariables || []).map((key) => toNodeId("variable", key)),
  ];
  if (!pulledIn.length) return undefined;
  const pulled = new Set(pulledIn);
  const selected = new Set(
    [
      ...membership.features.map((key) => toNodeId("feature", key)),
      ...membership.variables.map((key) => toNodeId("variable", key)),
    ].filter((node) => !pulled.has(node)),
  );
  const result: NonNullable<EntityDetail["contentPulledIn"]> = {};
  for (const node of pulledIn) {
    const parents = graph.reach(node, "dependents");
    const owner = [...parents.keys()].find((candidate) => selected.has(candidate));
    if (!owner) continue;
    result[node] = [owner, ...graph.chain(parents, node, owner, "dependents")].map(fromNodeId);
  }
  return Object.keys(result).length ? result : undefined;
}

function buildRelationships(
  maps: EntityMaps,
  targetMemberships: Record<string, CatalogTargetMembership>,
  graph: DependencyGraph,
): RelationshipMaps {
  const relationships: RelationshipMaps = {
    featureTargets: {},
    featureTests: {},
    featureRequiredBy: {},
    featureRequired: {},
    featureSegments: {},
    featureAttributes: {},
    featureSchemas: {},
    segmentsUsedInFeatures: {},
    attributesUsedInFeatures: {},
    attributesUsedInSegments: {},
    segmentSegments: {},
    segmentFeatures: {},
    segmentVariables: {},
    segmentAttributes: {},
    segmentsUsedInSegments: {},
    featuresUsedInSegments: {},
    variablesUsedInSegments: {},
    segmentTargets: {},
    attributeTargets: {},
    schemasUsedInFeatures: {},
    segmentTests: {},
    targetFeatures: {},
    targetVariables: {},
    targetSegments: {},
    variableFeatures: {},
    variableSegments: {},
    variableAttributes: {},
    variableSchemas: {},
    variableTargets: {},
    variableTests: {},
    featuresUsedInVariables: {},
    segmentsUsedInVariables: {},
    attributesUsedInVariables: {},
    schemasUsedInVariables: {},
    featureVariables: {},
    variablesUsedInFeatures: {},
    variableVariables: {},
    variablesUsedInVariables: {},
  };
  const exists = createNodeExists(maps);
  const forward: Record<string, Partial<Record<CatalogEntityType, Record<string, Set<string>>>>> = {
    feature: {
      feature: relationships.featureRequired,
      variable: relationships.featureVariables,
      segment: relationships.featureSegments,
      attribute: relationships.featureAttributes,
    },
    variable: {
      feature: relationships.variableFeatures,
      variable: relationships.variableVariables,
      segment: relationships.variableSegments,
      attribute: relationships.variableAttributes,
    },
    segment: {
      feature: relationships.segmentFeatures,
      variable: relationships.segmentVariables,
      segment: relationships.segmentSegments,
      attribute: relationships.segmentAttributes,
    },
  };
  const reverse: Record<string, Partial<Record<CatalogEntityType, Record<string, Set<string>>>>> = {
    feature: {
      feature: relationships.featureRequiredBy,
      variable: relationships.variablesUsedInFeatures,
      segment: relationships.segmentsUsedInFeatures,
      attribute: relationships.attributesUsedInFeatures,
    },
    variable: {
      feature: relationships.featuresUsedInVariables,
      variable: relationships.variablesUsedInVariables,
      segment: relationships.segmentsUsedInVariables,
      attribute: relationships.attributesUsedInVariables,
    },
    segment: {
      feature: relationships.featuresUsedInSegments,
      variable: relationships.variablesUsedInSegments,
      segment: relationships.segmentsUsedInSegments,
      attribute: relationships.attributesUsedInSegments,
    },
  };

  // Every list follows the same closure, so a list, a count and a Target always agree.
  for (const type of ["feature", "variable", "segment"] as const) {
    for (const key of Object.keys(maps[type])) {
      for (const node of graph.reach(toNodeId(type, key), "dependencies").keys()) {
        if (!exists(node)) continue;
        const reference = fromNodeId(node);
        const forwardMap = forward[type][reference.type];
        const reverseMap = reverse[type][reference.type];
        if (forwardMap) addToSet(forwardMap, key, reference.key);
        if (reverseMap) addToSet(reverseMap, reference.key, key);
      }
      if (type === "segment") continue;
      const schemas = new Set<string>();
      if (type === "feature")
        collectSchemaKeysFromVariables(maps.feature[key].variablesSchema, schemas);
      else collectSchemaKeys(maps.variable[key], schemas);
      expandSchemaKeys(schemas, maps.schema);
      for (const schema of schemas) {
        addToSet(
          type === "feature" ? relationships.featureSchemas : relationships.variableSchemas,
          key,
          schema,
        );
        addToSet(
          type === "feature"
            ? relationships.schemasUsedInFeatures
            : relationships.schemasUsedInVariables,
          schema,
          key,
        );
      }
    }
  }

  for (const targetKey of Object.keys(maps.target)) {
    const canonicalMembership = targetMemberships[targetKey];
    if (!canonicalMembership) {
      throw new Error(
        `Catalog runtime did not return canonical membership for Target "${targetKey}".`,
      );
    }

    const segments = new Set(canonicalMembership.segments || []);
    const attributes = new Set<string>();
    const collect = (type: "feature" | "variable" | "segment", key: string) => {
      if (type === "segment") segments.add(key);
      for (const segment of forward[type].segment?.[key] || []) segments.add(segment);
      for (const attribute of forward[type].attribute?.[key] || []) attributes.add(attribute);
    };
    for (const featureKey of canonicalMembership.features) {
      addToSet(relationships.targetFeatures, targetKey, featureKey);
      addToSet(relationships.featureTargets, featureKey, targetKey);
      collect("feature", featureKey);
    }
    for (const variableKey of canonicalMembership.variables) {
      addToSet(relationships.targetVariables, targetKey, variableKey);
      addToSet(relationships.variableTargets, variableKey, targetKey);
      collect("variable", variableKey);
    }
    for (const segmentKey of [...segments]) collect("segment", segmentKey);
    for (const segmentKey of segments) {
      addToSet(relationships.segmentTargets, segmentKey, targetKey);
      addToSet(relationships.targetSegments, targetKey, segmentKey);
    }
    for (const attributeKey of attributes) {
      addToSet(relationships.attributeTargets, attributeKey, targetKey);
    }
  }

  for (const [testIdentity, testSpec] of Object.entries(maps.test)) {
    for (const reference of getTestReferences(testSpec.test)) {
      const index =
        reference.type === "feature"
          ? relationships.featureTests
          : reference.type === "segment"
            ? relationships.segmentTests
            : relationships.variableTests;
      addToSet(index, reference.key, testIdentity);
    }
  }

  return relationships;
}

function getEntityRelationships(
  type: CatalogEntityType,
  key: string,
  relationships: RelationshipMaps,
  maps: EntityMaps,
): Record<string, string[]> {
  if (type === "feature") {
    return {
      targets: sortSet(relationships.featureTargets[key]),
      tests: getCatalogTestKeys(relationships.featureTests[key], maps),
      requiredBy: sortSet(relationships.featureRequiredBy[key]),
      usedBySegments: sortSet(relationships.featuresUsedInSegments[key]),
      requiredFeatures: sortSet(relationships.featureRequired[key]),
      segments: sortSet(relationships.featureSegments[key]),
      attributes: sortSet(relationships.featureAttributes[key]),
      schemas: sortSet(relationships.featureSchemas[key]),
      variables: sortSet(relationships.featuresUsedInVariables[key]),
      requiredVariables: sortSet(relationships.featureVariables[key]),
    };
  }

  if (type === "segment") {
    return {
      features: sortSet(relationships.segmentsUsedInFeatures[key]),
      tests: getCatalogTestKeys(relationships.segmentTests[key], maps),
      attributes: sortSet(relationships.segmentAttributes[key]),
      segments: sortSet(relationships.segmentSegments[key]),
      referencedFeatures: sortSet(relationships.segmentFeatures[key]),
      referencedVariables: sortSet(relationships.segmentVariables[key]),
      usedBySegments: sortSet(relationships.segmentsUsedInSegments[key]),
      targets: sortSet(relationships.segmentTargets[key]),
      variables: sortSet(relationships.segmentsUsedInVariables[key]),
    };
  }

  if (type === "attribute") {
    return {
      features: sortSet(relationships.attributesUsedInFeatures[key]),
      segments: sortSet(relationships.attributesUsedInSegments[key]),
      targets: sortSet(relationships.attributeTargets[key]),
      variables: sortSet(relationships.attributesUsedInVariables[key]),
    };
  }

  if (type === "target") {
    return {
      features: sortSet(relationships.targetFeatures[key]),
      variables: sortSet(relationships.targetVariables[key]),
      segments: sortSet(relationships.targetSegments[key]),
    };
  }

  if (type === "schema") {
    return {
      features: sortSet(relationships.schemasUsedInFeatures[key]),
      variables: sortSet(relationships.schemasUsedInVariables[key]),
    };
  }

  if (type === "variable") {
    return {
      features: sortSet(relationships.variableFeatures[key]),
      segments: sortSet(relationships.variableSegments[key]),
      attributes: sortSet(relationships.variableAttributes[key]),
      schemas: sortSet(relationships.variableSchemas[key]),
      targets: sortSet(relationships.variableTargets[key]),
      tests: getCatalogTestKeys(relationships.variableTests[key], maps),
      requiredVariables: sortSet(relationships.variableVariables[key]),
      requiredByVariables: sortSet(relationships.variablesUsedInVariables[key]),
      requiredByFeatures: sortSet(relationships.variablesUsedInFeatures[key]),
      usedBySegments: sortSet(relationships.variablesUsedInSegments[key]),
    };
  }

  return {};
}

/** Report case totals per built index. Kept beside the index so they are never stored with it. */
const reportCaseTotals = new WeakMap<CatalogIndex, { executed: number; total: number }>();

async function buildSetCatalog(
  context: CatalogBuildContext,
  set: string,
  projectConfig: any,
  datasource: any,
  outputRelativeDirectory: string,
) {
  datasource = createCatalogSnapshot(
    datasource,
    undefined,
    context.definitions && { cache: context.definitions, scope: set },
  );
  let verification: "current" | "stale" | "unverified" = "unverified";
  const provenance = context.testReport?.provenance;
  if (
    provenance?.version === 1 &&
    provenance.algorithm === "sha256" &&
    Array.isArray(provenance.sets) &&
    context.runtime.getTestInputFingerprint
  ) {
    const matches = provenance.sets.filter((entry) => entry?.set === (set || null));
    if (
      matches.length === 1 &&
      typeof matches[0].fingerprint === "string" &&
      /^[a-f0-9]{64}$/.test(matches[0].fingerprint)
    ) {
      verification =
        matches[0].fingerprint ===
        (await context.runtime.getTestInputFingerprint(projectConfig, datasource))
          ? "current"
          : "stale";
    }
  }
  if (context.testReport) {
    for (const [identity, report] of context.testReport.specs) {
      if (JSON.parse(identity)[0] === (set || "")) report.verification = verification;
    }
  }
  const outputDirectoryPath = path.join(context.dataDirectoryPath, outputRelativeDirectory);
  const outputLogicalDirectory = set ? `sets/${encodeURIComponent(set)}` : "root";
  const environments = Array.isArray(projectConfig.environments)
    ? projectConfig.environments
    : undefined;
  const setStartedAt = context.progress.setStart(set || undefined);
  const entitiesStartedAt = context.progress.step("Processing entities");
  const [
    featureKeys,
    segmentKeys,
    attributeKeys,
    targetKeys,
    schemaKeys,
    variableKeys,
    testKeys,
    scenarioKeys,
  ] = await Promise.all([
    datasource.listFeatures(),
    datasource.listSegments(),
    datasource.listAttributes(),
    datasource.listTargets(),
    datasource.listSchemas(),
    datasource.listVariables(),
    datasource.listTests(),
    datasource.listScenarios(),
  ]);
  const maps: EntityMaps = {
    feature: await readAll<ParsedFeature>(featureKeys, (key) => datasource.readFeature(key)),
    segment: await readAll<Segment>(segmentKeys, (key) => datasource.readSegment(key)),
    attribute: await readAll<Attribute>(attributeKeys, (key) => datasource.readAttribute(key)),
    target: await readAll<Target>(targetKeys, (key) => datasource.readTarget(key)),
    schema: await readAll<Schema>(schemaKeys, (key) => datasource.readSchema(key)),
    variable: await readAll<ParsedVariable>(variableKeys, (key) => datasource.readVariable(key)),
    test: await readCatalogTestSpecs(datasource, testKeys, scenarioKeys),
  };
  context.progress.done(
    entitiesStartedAt,
    `(${[
      pluralize(featureKeys.length, "feature"),
      pluralize(segmentKeys.length, "segment"),
      pluralize(attributeKeys.length, "attribute"),
      pluralize(targetKeys.length, "target"),
      pluralize(schemaKeys.length, "schema"),
      pluralize(variableKeys.length, "variable"),
      pluralize(testKeys.length, "test"),
      pluralize(scenarioKeys.length, "scenario"),
    ].join(", ")})`,
  );

  const relationshipsStartedAt = context.progress.step("Mapping relationships");
  const targetMemberships = await context.runtime.getCatalogTargetMemberships(
    projectConfig,
    datasource,
  );
  const usageLocations = buildUsageLocations(maps);
  const dependencyGraph = buildCatalogDependencyGraph(usageLocations);
  const nodeExists = createNodeExists(maps);
  const relationships = buildRelationships(maps, targetMemberships, dependencyGraph);
  const attributeConditionValues = buildAttributeConditionValues(maps);
  const accumulationPreviews = buildAccumulationPreviews(
    maps,
    context.runtime.resolveOverrideValue,
  );
  context.progress.done(relationshipsStartedAt);

  const history = set ? context.historyIndex.bySet[set] || [] : context.historyIndex.entries;
  const index: CatalogIndex = {
    set,
    counts: {
      feature: featureKeys.length,
      segment: segmentKeys.length,
      attribute: attributeKeys.length,
      target: targetKeys.length,
      schema: schemaKeys.length,
      test: testKeys.length + scenarioKeys.length,
      variable: variableKeys.length,
    },
    entities: {
      feature: [],
      segment: [],
      attribute: [],
      target: [],
      schema: [],
      test: [],
      variable: [],
    },
  };

  const historyStartedAt = context.progress.step("Writing history pages");
  await writeHistoryPages(context.writer, path.join(outputDirectoryPath, "history"), history);
  context.progress.done(historyStartedAt, `(${pluralize(history.length, "entry", "entries")})`);

  const entityPlan: Array<{
    type: CatalogEntityType;
    keys: string[];
    entities: Record<string, any>;
  }> = [
    { type: "feature", keys: featureKeys, entities: maps.feature },
    { type: "segment", keys: segmentKeys, entities: maps.segment },
    { type: "attribute", keys: attributeKeys, entities: maps.attribute },
    { type: "target", keys: targetKeys, entities: maps.target },
    { type: "schema", keys: schemaKeys, entities: maps.schema },
    { type: "variable", keys: variableKeys, entities: maps.variable },
  ];

  const detailsStartedAt = context.progress.step("Writing entity details");
  for (const plan of entityPlan) {
    for (const key of plan.keys) {
      const entity = plan.entities[key];
      const featureEnvironmentStatus =
        plan.type === "feature" ? getFeatureEnvironmentStatus(entity) : {};
      const sourceFileInfo = getSourceFileInfo(
        context.repositorySourceRootDirectoryPath,
        projectConfig,
        datasource,
        plan.type,
        key,
        { resolveAbsolutePath: context.devEditors.length > 0, realPaths: context.realPaths },
      );
      const lastModified = getLastModified(context.historyIndex, plan.type, key, set);
      const entityRelationships = getEntityRelationships(plan.type, key, relationships, maps);
      const testIdentities =
        plan.type === "feature"
          ? relationships.featureTests[key]
          : plan.type === "segment"
            ? relationships.segmentTests[key]
            : plan.type === "variable"
              ? relationships.variableTests[key]
              : undefined;
      const entityTests = sortCatalogTestIdentities(testIdentities, maps).map((identity) => {
        const spec = maps.test[identity];
        const report = context.testReport?.specs.get(getReportSpecId(set, spec.source, spec.key));
        return report ? ({ ...spec.test, report } as unknown as Test) : spec.test;
      });
      // Dependency links are kept separate from specs that explicitly test an entity.
      const related = new Map<string, NonNullable<EntityDetail["relatedScenarios"]>[number]>();
      if (plan.type === "segment") {
        const relate = (
          identity: string,
          via: NonNullable<EntityDetail["relatedScenarios"]>[number]["via"][number],
        ) => {
          const entry = related.get(identity) || { key: maps.test[identity].key, via: [] };
          entry.via.push(via);
          related.set(identity, entry);
        };
        const segmentId = toNodeId("segment", key);
        // Scenarios of the features and variables requiring this segment, through segments only.
        for (const owner of dependencyGraph.nearestOwners(segmentId).map(fromNodeId)) {
          if (!nodeExists(toNodeId(owner.type, owner.key))) continue;
          const tests =
            owner.type === "feature" ? relationships.featureTests : relationships.variableTests;
          for (const identity of sortCatalogTestIdentities(tests[owner.key], maps)) {
            if (maps.test[identity].source !== "scenario" || testIdentities?.has(identity))
              continue;
            relate(identity, owner as { type: "feature" | "variable"; key: string });
          }
        }
        // Specs of segments built on this one exercise it too.
        const segmentParents = dependencyGraph.reach(segmentId, "dependents", (node) =>
          node.startsWith("segment:"),
        );
        for (const node of segmentParents.keys()) {
          if (!node.startsWith("segment:") || !nodeExists(node)) continue;
          const segmentKey = fromNodeId(node).key;
          for (const identity of sortCatalogTestIdentities(
            relationships.segmentTests[segmentKey],
            maps,
          )) {
            if (testIdentities?.has(identity)) continue;
            relate(identity, { type: "segment", key: segmentKey });
          }
        }
      }
      const detail: EntityDetail = {
        type: plan.type,
        key,
        entity,
        sourcePath: sourceFileInfo.sourcePath,
        editLinks: getEditorLinks(context.devEditors, sourceFileInfo),
        lastModified,
        relationships: entityRelationships,
        aliasSourceType:
          plan.type === "variable" && typeof entity.compose === "string"
            ? getVariableType(entity, maps)
            : undefined,
        composedSourceAliases:
          plan.type === "variable" &&
          entity.compose !== undefined &&
          typeof entity.compose !== "string"
            ? Object.entries(entity.compose as Record<string, ComposeReference>)
                .filter(
                  ([, source]) =>
                    source.feature === undefined &&
                    source.variable !== undefined &&
                    maps.variable[source.variable]?.compose !== undefined,
                )
                .map(([alias]) => alias)
                .sort()
            : undefined,
        tests: entityTests?.length ? entityTests : undefined,
        usedBy: usageLocations.get(`${plan.type}:${key}`),
        conditionValues: plan.type === "attribute" ? attributeConditionValues.get(key) : undefined,
        observedRules:
          plan.type === "feature" && verification === "current"
            ? context.testReport?.observedRules.get(getReportEntityId(set, key))
            : undefined,
        observedOverrides:
          plan.type === "variable" && verification === "current"
            ? context.testReport?.observedOverrides.get(getReportEntityId(set, key))
            : undefined,
        accumulationPreview: plan.type === "variable" ? accumulationPreviews.get(key) : undefined,
        relatedScenarios: related.size
          ? [...related.values()].sort((a, b) => a.key.localeCompare(b.key))
          : undefined,
        datafiles: plan.type === "target" ? targetMemberships[key]?.datafiles : undefined,
        contentRequiredBy:
          plan.type === "target"
            ? getTargetContentRequiredBy(key, relationships, dependencyGraph)
            : undefined,
        contentPulledIn:
          plan.type === "target"
            ? getTargetContentPulledIn(targetMemberships[key], dependencyGraph)
            : undefined,
        environments,
        historyPath: `${path.posix.join(
          "data",
          outputLogicalDirectory,
          "entity-history",
          plan.type,
          encodeKeyUrlPath(key),
        )}`,
      };

      await context.writer.write(
        path.join(outputDirectoryPath, "entities", plan.type, `${encodeKeyPath(key)}.json`),
        detail,
      );

      await writeHistoryPages(
        context.writer,
        path.join(outputDirectoryPath, "entity-history", plan.type, encodeKeyPath(key)),
        context.historyIndex.byEntity[getHistoryEntityKey(plan.type, key, set)] || [],
      );

      index.entities[plan.type].push(
        getEntitySummary(entity, plan.type, key, context.historyIndex, set, {
          tags: getSummaryTags(entity, plan.type),
          targets:
            plan.type === "feature"
              ? sortSet(relationships.featureTargets[key])
              : plan.type === "segment"
                ? sortSet(relationships.segmentTargets[key])
                : plan.type === "attribute"
                  ? sortSet(relationships.attributeTargets[key])
                  : plan.type === "variable"
                    ? sortSet(relationships.variableTargets[key])
                    : undefined,
          ...getDependentCounts(plan.type, key, relationships),
          usedByCount: getUsedByCount(plan.type, key, relationships),
          ...getDependencySummary(plan.type, key, dependencyGraph, maps, nodeExists),
          environments:
            plan.type === "feature"
              ? getFeatureEnvironmentKeys(entity, environments)
              : environments,
          variationValues: plan.type === "feature" ? getFeatureVariationValues(entity) : undefined,
          variableKeys: plan.type === "feature" ? getFeatureVariableKeys(entity) : undefined,
          hasVariations: plan.type === "feature" ? Boolean(entity.variations?.length) : undefined,
          hasVariables:
            plan.type === "feature"
              ? Object.keys(entity.variablesSchema || {}).length > 0
              : undefined,
          variableType: plan.type === "variable" ? getVariableType(entity, maps) : undefined,
          isComposed: plan.type === "variable" && entity.compose !== undefined ? true : undefined,
          hasTests:
            plan.type === "feature" || plan.type === "segment" || plan.type === "variable"
              ? Boolean(entityTests?.length)
              : undefined,
          attributeType:
            plan.type === "attribute"
              ? typeof entity.type === "string"
                ? entity.type
                : Array.isArray((entity as { oneOf?: unknown }).oneOf)
                  ? "oneOf"
                  : undefined
              : undefined,
          attributeFormat:
            plan.type === "attribute" && typeof (entity as { format?: unknown }).format === "string"
              ? ((entity as { format?: string }).format as string)
              : undefined,
          environmentsDiffer:
            plan.type === "feature"
              ? getFeatureEnvironmentsDiffer(entity as ParsedFeature, projectConfig.environments)
              : undefined,
          ...featureEnvironmentStatus,
        }),
      );
    }

    index.entities[plan.type].sort((a, b) => a.key.localeCompare(b.key));
  }

  for (const testSpec of Object.values(maps.test)) {
    const storageKey = testSpec.key;
    const sourceFileInfo = getSourceFileInfo(
      context.repositorySourceRootDirectoryPath,
      projectConfig,
      datasource,
      "test",
      testSpec.key,
      {
        resolveAbsolutePath: context.devEditors.length > 0,
        realPaths: context.realPaths,
        testSource: testSpec.source,
      },
    );
    const historyType: CatalogHistoryEntityType = testSpec.source;
    const lastModified = getLastModified(context.historyIndex, historyType, testSpec.key, set);
    const report = context.testReport?.specs.get(
      getReportSpecId(set, testSpec.source, testSpec.key),
    );
    const reportCoverage = report && getTestReportCoverage(report, testSpec.test, set);
    if (context.testReport) {
      const totals = reportCaseTotals.get(index) || { executed: 0, total: 0 };
      totals.executed += reportCoverage?.executed || 0;
      totals.total += (
        reportCoverage || getTestReportCoverage({ passed: true, cases: [] }, testSpec.test, set)
      ).total;
      reportCaseTotals.set(index, totals);
    }
    const detail: EntityDetail<Test> = {
      type: "test",
      key: testSpec.key,
      entity: testSpec.test,
      report,
      sourcePath: sourceFileInfo.sourcePath,
      editLinks: getEditorLinks(context.devEditors, sourceFileInfo),
      lastModified,
      relationships: {},
      environments,
      historyPath: path.posix.join(
        "data",
        outputLogicalDirectory,
        "entity-history",
        "test",
        encodeKeyUrlPath(storageKey),
      ),
    };

    await context.writer.write(
      path.join(outputDirectoryPath, "entities", "test", `${encodeKeyPath(storageKey)}.json`),
      detail,
    );
    await writeHistoryPages(
      context.writer,
      path.join(outputDirectoryPath, "entity-history", "test", encodeKeyPath(storageKey)),
      context.historyIndex.byEntity[getHistoryEntityKey(historyType, testSpec.key, set)] || [],
    );
    index.entities.test.push({
      ...getEntitySummary(testSpec.test, "test", testSpec.key, context.historyIndex, set, {
        ...getTestSummaryFields(testSpec),
        testPassed:
          report?.verification === "current" &&
          reportCoverage?.complete &&
          reportCoverage.passed === report.passed
            ? report.passed
            : undefined,
        testReportStatus: report
          ? getTestReportStatus(report, testSpec.test, set)
          : context.testReport
            ? "Not in supplied report"
            : undefined,
      }),
      lastModified,
      href: `entities/test/${encodeKeyUrlPath(storageKey)}.json`,
    });
  }
  index.entities.test.sort(
    (left, right) => left.key.localeCompare(right.key) || left.href.localeCompare(right.href),
  );
  context.progress.done(detailsStartedAt);

  await context.writer.write(
    path.join(outputDirectoryPath, "index.json"),
    context.compactStorage ? encodeCatalogIndex(index) : index,
  );
  context.progress.done(setStartedAt);

  return index;
}

async function copyCatalogAssets(outputDirectoryPath: string) {
  const catalogPackagePath = path.dirname(require.resolve("@featurevisor/catalog/package.json"));
  const catalogDistPath = path.join(catalogPackagePath, "dist");

  if (!fs.existsSync(catalogDistPath)) {
    throw new Error(
      "Catalog UI assets are missing. Run `npm run build --workspace @featurevisor/catalog` first.",
    );
  }

  await fs.promises.cp(catalogDistPath, outputDirectoryPath, { recursive: true });
}

export async function exportCatalog(
  runtime: CatalogRuntime,
  rootDirectoryPath: string,
  projectConfig: any,
  datasource: any,
  exportOptions: CatalogExportOptions = {},
) {
  // Compact storage is the default for every caller, as it is for the CLI. The plain layout
  // repeats each commit's entity list in every entity history page, so it grows with the
  // square of a commit's size. It remains available for inspection with compactStorage: false.
  const options = { ...exportOptions, compactStorage: exportOptions.compactStorage ?? true };
  const outputDirectoryPath = options.outDir
    ? path.resolve(rootDirectoryPath, options.outDir)
    : projectConfig.catalogDirectoryPath;
  const dataDirectoryPath = path.join(outputDirectoryPath, "data");
  const progress = new CatalogProgressReporter(rootDirectoryPath, outputDirectoryPath);
  const writer = new CatalogStorageWriter(dataDirectoryPath, {
    compactStorage: options.compactStorage,
    targetBlockBytes: options.blockSize,
    prettyOutput: options.prettyOutput,
  });

  try {
    progress.start({
      browserRouter: options.browserRouter !== false,
      sets: projectConfig.sets === true,
    });

    let stepStartedAt = progress.step("Preparing output directory");
    // Never delete the last successful generation while its replacement is building.
    await fs.promises.mkdir(dataDirectoryPath, { recursive: true });
    progress.done(stepStartedAt);

    if (options.copyAssets !== false) {
      stepStartedAt = progress.step("Copying Catalog UI assets");
      await copyCatalogAssets(outputDirectoryPath);
      progress.done(stepStartedAt);
    }
    const indexPath = path.join(outputDirectoryPath, "index.html");
    if (fs.existsSync(indexPath)) {
      const html = await fs.promises.readFile(indexPath, "utf8");
      const updated = rewriteCatalogHtml(html, projectConfig.catalogBasePath || "/");
      if (updated !== html) await fs.promises.writeFile(indexPath, updated);
    }

    const devEditors = options.dev
      ? options.devSession?.devEditors || options.devEditors || detectDevEditors()
      : [];

    stepStartedAt = progress.step("Resolving repository links");
    const repositoryRootDirectoryPath =
      options.devSession?.repositoryRootDirectoryPath ||
      getRepositoryRootDirectoryPath(rootDirectoryPath);
    const repositorySourceRootDirectoryPath =
      options.devSession?.repositorySourceRootDirectoryPath ||
      getRepositorySourceRootDirectoryPath(rootDirectoryPath);
    const links =
      options.devSession?.links || getRepoLinks(repositoryRootDirectoryPath, options.branch);
    progress.done(stepStartedAt, links?.repository ? `(${links.repository})` : "(none)");

    stepStartedAt = progress.step("Reading Git history");
    const historyIndex =
      options.devSession?.historyIndex ||
      (await getGitHistoryIndex(projectConfig, datasource, rootDirectoryPath));
    progress.done(stepStartedAt, `(${pluralize(historyIndex.entries.length, "commit")})`);

    let testReport: CatalogTestReportIndex | undefined;
    if (options.testReport) {
      stepStartedAt = progress.step("Reading test report");
      testReport = readTestReport(path.resolve(rootDirectoryPath, options.testReport));
      progress.done(stepStartedAt, `(${testReport.specs.size} specs)`);
    }

    const context: CatalogBuildContext = {
      compactStorage: options.compactStorage,
      testReport,
      runtime,
      rootDirectoryPath,
      repositorySourceRootDirectoryPath,
      outputDirectoryPath,
      dataDirectoryPath,
      historyIndex,
      devEditors,
      progress,
      writer,
      definitions: options.devSession?.definitions,
      realPaths: options.devSession?.realPaths,
    };
    // Fingerprints already catch edits. Paths the watcher reports are dropped regardless,
    // including their real paths, in case a symbolic link was replaced.
    if (options.changedPaths) {
      const changed = options.changedPaths.map((file) => path.resolve(file));
      if (context.definitions) invalidateCatalogDefinitions(context.definitions, changed);
      for (const file of changed) context.realPaths?.delete(file);
    }

    stepStartedAt = progress.step("Discovering project sets");
    const executions = await runtime.getProjectSetExecutions(projectConfig, datasource);
    progress.done(
      stepStartedAt,
      projectConfig.sets
        ? `(${executions.map((execution) => execution.set).join(", ") || "none"})`
        : "(root)",
    );

    stepStartedAt = progress.step("Writing project history");
    await writeHistoryPages(
      writer,
      path.join(dataDirectoryPath, "project", "history"),
      historyIndex.entries,
    );
    progress.done(stepStartedAt, `(${pluralize(historyIndex.entries.length, "entry", "entries")})`);

    const setIndexes: Record<string, CatalogIndex> = Object.create(null);
    const changedPaths = options.changedPaths && [
      ...options.changedPaths,
      ...(options.devSession?.failedChangedPaths || []),
    ];
    const exportSignature = JSON.stringify({
      prettyOutput: !!options.prettyOutput,
      blockSize: options.blockSize,
      devEditors,
      testReport: options.testReport,
      tags: projectConfig.tags,
      environments: projectConfig.environments,
      namespaceCharacter: projectConfig.namespaceCharacter,
    });
    let canReuse =
      options.compactStorage &&
      options.devSession?.publishedStorage &&
      options.devSession.publishedStorage.version === 2 &&
      options.devSession.publishedOutputDirectoryPath === path.resolve(outputDirectoryPath) &&
      options.devSession.exportSignature === exportSignature;
    if (canReuse) {
      try {
        const previous = JSON.parse(
          await fs.promises.readFile(path.join(dataDirectoryPath, "manifest.json"), "utf8"),
        );
        canReuse =
          JSON.stringify(previous.storage) === JSON.stringify(options.devSession!.publishedStorage);
      } catch {
        canReuse = false;
      }
    }
    const reportChanged =
      options.testReport &&
      changedPaths?.some(
        (file) => path.resolve(file) === path.resolve(rootDirectoryPath, options.testReport!),
      );
    const changedSets =
      canReuse && !reportChanged && projectConfig.sets && changedPaths?.length
        ? getChangedCatalogSets(
            projectConfig,
            changedPaths,
            executions.map((item) => item.set),
            testReport && runtime.getTestInputStatePaths
              ? new Map(
                  executions.map((item) => [
                    item.set,
                    runtime.getTestInputStatePaths!(item.projectConfig).map((file) =>
                      path.resolve(rootDirectoryPath, file),
                    ),
                  ]),
                )
              : undefined,
          )
        : undefined;
    for (const execution of executions) {
      const previous = options.devSession?.setIndexes?.[execution.set];
      if (options.compactStorage && changedSets && !changedSets.has(execution.set) && previous) {
        if (testReport) {
          for (const [identity, report] of testReport.specs) {
            if (JSON.parse(identity)[0] === execution.set)
              report.verification =
                options.devSession?.reportVerifications?.[identity] || "unverified";
          }
        }
        await writer.retainPrefix(`data/sets/${encodeURIComponent(execution.set)}/`);
        setIndexes[execution.set] = previous;
        continue;
      }
      const outputRelativeDirectory = projectConfig.sets
        ? path.join("sets", execution.set)
        : "root";
      setIndexes[execution.set || "root"] = await buildSetCatalog(
        context,
        execution.set,
        execution.projectConfig,
        execution.datasource,
        outputRelativeDirectory,
      );
    }

    stepStartedAt = progress.step("Writing manifest");
    if (testReport) {
      const statuses = [...testReport.specs.values()].map((spec) => spec.verification);
      testReport.summary.verification =
        statuses.length && statuses.every((status) => status === "current")
          ? "current"
          : statuses.includes("stale")
            ? "stale"
            : "unverified";
    }
    let manifest: CatalogManifest = {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      router: options.browserRouter === false ? "hash" : "browser",
      sets: projectConfig.sets,
      setKeys: projectConfig.sets ? sortSetKeys(executions.map((execution) => execution.set)) : [],
      projectConfig: {
        tags: projectConfig.tags,
        environments: Array.isArray(projectConfig.environments)
          ? projectConfig.environments
          : undefined,
      },
      dev: options.dev ? { editors: devEditors } : undefined,
      testReport: testReport && {
        ...testReport.summary,
        cases: Object.values(setIndexes).reduce(
          (totals, setIndex) => {
            const item = reportCaseTotals.get(setIndex);
            return item
              ? { executed: totals.executed + item.executed, total: totals.total + item.total }
              : totals;
          },
          { executed: 0, total: 0 },
        ),
      },
      links,
      paths: {
        projectHistory: "data/project/history/page-1.json",
        root: projectConfig.sets ? undefined : "data/root/index.json",
        sets: projectConfig.sets
          ? Object.fromEntries(
              executions.map((execution) => [
                execution.set,
                `data/sets/${encodeURIComponent(execution.set)}/index.json`,
              ]),
            )
          : undefined,
      },
      counts: Object.fromEntries(
        Object.keys(setIndexes).map((key) => [key, setIndexes[key].counts]),
      ),
    };

    manifest = await writer.publish(path.join(dataDirectoryPath, "manifest.json"), manifest);
    if (options.devSession) {
      options.devSession.setIndexes = setIndexes;
      options.devSession.reportVerifications =
        testReport &&
        Object.fromEntries(
          [...testReport.specs].map(([key, report]) => [key, report.verification]),
        );
      options.devSession.publishedStorage = manifest.storage;
      options.devSession.publishedOutputDirectoryPath = path.resolve(outputDirectoryPath);
      options.devSession.exportSignature = exportSignature;
      options.devSession.failedChangedPaths = [];
    }
    progress.done(stepStartedAt);
    progress.complete();

    return {
      outputDirectoryPath,
      manifest,
    };
  } catch (error) {
    if (options.devSession) {
      options.devSession.failedChangedPaths = [
        ...new Set([
          ...(options.devSession.failedChangedPaths || []),
          ...(options.changedPaths?.length ? options.changedPaths : [rootDirectoryPath]),
        ]),
      ];
    }
    await writer.abort();
    throw error;
  }
}

/** Unknown or shared inputs always invalidate the complete export. */
export function getChangedCatalogSets(
  config: any,
  changedPaths: string[],
  sets: string[],
  statePathsBySet?: Map<string, string[]>,
) {
  if (!config.sets || !changedPaths.length) return undefined;
  const changed = new Set<string>();
  for (const file of changedPaths) {
    const stateSets = [...(statePathsBySet || [])]
      .filter(([, files]) => files.includes(path.resolve(file)))
      .map(([set]) => set);
    if (stateSets.length) {
      stateSets.forEach((set) => changed.add(set));
      continue;
    }
    const relative = path.relative(config.setsDirectoryPath, file);
    const set = relative.split(path.sep)[0];
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !sets.includes(set))
      return undefined;
    changed.add(set);
  }
  return changed;
}

function getContentType(filePath: string) {
  const extension = path.extname(filePath);

  switch (extension) {
    case ".js":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    default:
      return "text/html";
  }
}

function getCatalogLiveReloadClientScript() {
  return [
    "<script>",
    "(() => {",
    "  const base = document.querySelector('meta[name=\"featurevisor-catalog-base\"]');",
    '  const oldBase = base ? base.getAttribute("content") : "/";',
    '  const source = new EventSource(oldBase + "__featurevisor_catalog_reload");',
    '  source.addEventListener("reload", (event) => {',
    "    const nextBase = event.data;",
    "    if (/^\\/(?:[A-Za-z0-9_-]+\\/)*$/.test(nextBase) && nextBase !== oldBase) {",
    "      window.location.assign(nextBase + window.location.pathname.slice(oldBase.length) + window.location.search + window.location.hash);",
    "    } else window.location.reload();",
    "  });",
    "  source.onerror = () => {",
    "    source.close();",
    "    setTimeout(() => window.location.reload(), 1000);",
    "  };",
    "})();",
    "</script>",
  ].join("");
}

function injectCatalogLiveReloadClient(html: string) {
  const script = getCatalogLiveReloadClientScript();

  if (html.includes("</body>")) {
    return html.replace("</body>", `${script}</body>`);
  }

  return `${html}${script}`;
}

function isPathWithinDirectory(directoryPath: string, candidatePath: string) {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}

async function resolveWithinRealDirectory(directoryPath: string, candidatePath: string) {
  let realDirectoryPath: string;

  try {
    realDirectoryPath = await fs.promises.realpath(directoryPath);
  } catch {
    return undefined;
  }

  let existingPath = candidatePath;
  const missingPathSegments: string[] = [];
  while (true) {
    try {
      const realExistingPath = await fs.promises.realpath(existingPath);
      const resolvedCandidatePath = path.resolve(
        realExistingPath,
        ...missingPathSegments.reverse(),
      );
      return isPathWithinDirectory(realDirectoryPath, resolvedCandidatePath)
        ? resolvedCandidatePath
        : undefined;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        return undefined;
      }

      const parentPath = path.dirname(existingPath);
      if (parentPath === existingPath) {
        return undefined;
      }
      missingPathSegments.push(path.basename(existingPath));
      existingPath = parentPath;
    }
  }
}

/** Host names that resolve to this machine, with or without a port. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = (host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0])
    .toLowerCase()
    .replace(/\.$/, "");
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(name)
  );
}

export async function resolveCatalogRequestPath(outputDirectoryPath: string, requestUrl: string) {
  let requestedUrl: string;

  try {
    requestedUrl = decodeURIComponent(requestUrl.split("?")[0]);
  } catch {
    return { status: "invalid" as const };
  }

  if (requestedUrl.includes("\0")) {
    return { status: "invalid" as const };
  }

  const portableUrl = requestedUrl.replace(/\\/g, "/");
  const requestedPath = portableUrl === "/" ? "/index.html" : portableUrl;
  const assetPath = requestedPath === "/favicon.ico" ? "/favicon.png" : requestedPath;
  const resolvedOutputDirectoryPath = path.resolve(outputDirectoryPath);
  const filePath = path.resolve(resolvedOutputDirectoryPath, assetPath.replace(/^\/+/, ""));
  const resolvedFilePath = isPathWithinDirectory(resolvedOutputDirectoryPath, filePath)
    ? await resolveWithinRealDirectory(resolvedOutputDirectoryPath, filePath)
    : undefined;

  if (!resolvedFilePath) {
    return { status: "unsafe" as const };
  }

  return { status: "ok" as const, requestedPath, filePath: resolvedFilePath };
}

export async function serveCatalog(
  runtime: CatalogRuntime,
  rootDirectoryPath: string,
  projectConfig: any,
  datasource: any,
  options: CatalogServeOptions = {},
): Promise<CatalogServerHandle> {
  let outputDirectoryPath = options.outDir
    ? path.resolve(rootDirectoryPath, options.outDir)
    : projectConfig.catalogDirectoryPath;

  if (!fs.existsSync(path.join(outputDirectoryPath, "data", "manifest.json"))) {
    await exportCatalog(runtime, rootDirectoryPath, projectConfig, datasource, {
      outDir: outputDirectoryPath,
      browserRouter: options.browserRouter,
      compactStorage: true,
      prettyOutput: options.prettyOutput,
      blockSize: options.blockSize,
      copyAssets: options.copyAssets,
      testReport: options.testReport,
      branch: options.branch,
    });
  }

  const port = Number(options.port ?? 3000);
  let basePath = projectConfig.catalogBasePath || "/";
  const liveReloadClients = new Set<http.ServerResponse>();

  function triggerReload() {
    liveReloadClients.forEach((client) => {
      client.write("event: reload\n");
      client.write(`data: ${basePath}\n\n`);
    });
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (!isLoopbackHost(request.headers.host)) {
      // The server only listens on loopback. Rejecting other names stops DNS rebinding pages.
      response.writeHead(421, { "Content-Type": "text/plain" });
      response.end("421 Misdirected Request");
      return;
    }
    let requestUrl = request.url || "/";
    if (basePath !== "/") {
      if (requestUrl.split("?")[0] === basePath.slice(0, -1)) {
        const search = requestUrl.includes("?") ? requestUrl.slice(requestUrl.indexOf("?")) : "";
        response.writeHead(308, { Location: basePath + search });
        response.end();
        return;
      }
      if (!requestUrl.startsWith(basePath)) {
        response.writeHead(404);
        response.end("404 Not Found");
        return;
      }
      requestUrl = "/" + requestUrl.slice(basePath.length);
    }
    let requestedUrl: string;

    try {
      requestedUrl = decodeURIComponent(requestUrl.split("?")[0]);
    } catch {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("400 Bad Request");
      return;
    }

    if (options.liveReload && requestedUrl === "/__featurevisor_catalog_reload") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      response.write("\n");
      liveReloadClients.add(response);
      request.on("close", () => liveReloadClients.delete(response));
      return;
    }

    const resolution = await resolveCatalogRequestPath(outputDirectoryPath, requestUrl);
    if (resolution.status !== "ok") {
      response.writeHead(resolution.status === "invalid" ? 400 : 404, {
        "Content-Type": "text/plain",
      });
      response.end(resolution.status === "invalid" ? "400 Bad Request" : "404 Not Found");
      return;
    }

    const { requestedPath, filePath: safeFilePath } = resolution;
    const cacheControl = /^\/data\/blocks\/[a-f0-9]{64}\.json$/.test(requestedPath)
      ? "public, max-age=31536000, immutable"
      : "no-cache";
    response.setHeader("Cache-Control", cacheControl);

    fs.readFile(safeFilePath, (error, content) => {
      if (!error) {
        if (options.liveReload && path.basename(safeFilePath) === "index.html") {
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end(injectCatalogLiveReloadClient(content.toString("utf8")));
          return;
        }

        response.writeHead(200, { "Content-Type": getContentType(safeFilePath) });
        response.end(content);
        return;
      }

      if (
        requestedPath.startsWith("/assets/") ||
        requestedPath.startsWith("/data/") ||
        requestedPath === "/favicon.ico"
      ) {
        response.setHeader("Cache-Control", "no-cache");
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("404 Not Found");
        return;
      }

      void resolveCatalogRequestPath(outputDirectoryPath, "/index.html").then(
        (indexResolution) => {
          if (indexResolution.status !== "ok") {
            response.writeHead(500, { "Content-Type": "text/plain" });
            response.end("Catalog index.html not found.");
            return;
          }

          fs.readFile(indexResolution.filePath, (indexError, indexContent) => {
            if (indexError) {
              response.writeHead(500, { "Content-Type": "text/plain" });
              response.end("Catalog index.html not found.");
              return;
            }

            response.writeHead(200, { "Content-Type": "text/html" });
            response.end(
              options.liveReload
                ? injectCatalogLiveReloadClient(indexContent.toString("utf8"))
                : indexContent,
            );
          });
        },
        () => {
          response.writeHead(500, { "Content-Type": "text/plain" });
          response.end("Catalog index.html not found.");
        },
      );
    });
  });

  server.on("error", (error) => {
    console.error(`Unable to serve catalog on http://127.0.0.1:${port}/`);
    console.error(error);
    process.exitCode = 1;
  });

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.off("error", failed);
      server.off("listening", ready);
    };
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    const ready = () => {
      cleanup();
      console.log(`Catalog running at http://127.0.0.1:${port}${basePath}`);
      resolve();
    };
    server.once("error", failed);
    try {
      server.listen(port, "127.0.0.1", ready);
    } catch (error) {
      failed(error as Error);
    }
  });

  let closing: Promise<void> | undefined;
  return {
    close: () => {
      if (closing) return closing;
      for (const client of liveReloadClients) client.end();
      liveReloadClients.clear();
      closing = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
            reject(error);
            return;
          }

          resolve();
        });
        // Closing the Catalog also releases browser preconnections and unfinished requests.
        server.closeAllConnections?.();
      });
      return closing;
    },
    setOutputDirectoryPath: (nextOutputDirectoryPath: string) => {
      outputDirectoryPath = path.resolve(nextOutputDirectoryPath);
    },
    setBasePath: (nextBasePath: string) => {
      basePath = nextBasePath;
    },
    triggerReload,
  };
}

export async function createCatalogDevSession(
  rootDirectoryPath: string,
  projectConfig: any,
  datasource: any,
  options: CatalogExportOptions = {},
): Promise<CatalogDevSession> {
  const outputDirectoryPath = options.outDir
    ? path.resolve(rootDirectoryPath, options.outDir)
    : projectConfig.catalogDirectoryPath;
  const repositoryRootDirectoryPath = getRepositoryRootDirectoryPath(rootDirectoryPath);
  const repositorySourceRootDirectoryPath = getRepositorySourceRootDirectoryPath(rootDirectoryPath);

  return {
    outputDirectoryPath,
    devEditors: options.devEditors || detectDevEditors(),
    historyIndex: await getGitHistoryIndex(projectConfig, datasource, rootDirectoryPath),
    links: getRepoLinks(repositoryRootDirectoryPath, options.branch),
    repositoryRootDirectoryPath,
    repositorySourceRootDirectoryPath,
    gitFingerprint: getGitFingerprint(rootDirectoryPath),
    setIndexes: Object.create(null),
    definitions: createCatalogDefinitionCache(),
    realPaths: new Map(),
  };
}

function getGitFingerprint(root: string) {
  try {
    return runGit(root, ["rev-parse", "HEAD"]).trim() + ":" + getCurrentBranch(root);
  } catch {
    return "unborn";
  }
}

function getGitWatchPaths(root: string) {
  try {
    let reference = "";
    try {
      reference = runGit(root, ["symbolic-ref", "-q", "HEAD"]).trim();
    } catch {
      /* detached */
    }
    return ["HEAD", "packed-refs", "config", reference]
      .filter(Boolean)
      .map((name) => path.resolve(root, runGit(root, ["rev-parse", "--git-path", name]).trim()));
  } catch {
    return [];
  }
}

function catalogTestInputsChanged(config: any, changedPaths: string[], rootDirectoryPath: string) {
  return changedPaths.some((file) => {
    if (!config.sets) {
      return (
        typeof config.testsDirectoryPath === "string" &&
        (isPathWithinDirectory(config.testsDirectoryPath, file) ||
          isPathWithinDirectory(file, config.testsDirectoryPath))
      );
    }
    if (typeof config.setsDirectoryPath !== "string") return true;
    // Custom adapters may map set test sources differently from the default layout.
    if (
      typeof config.testsDirectoryPath !== "string" ||
      path.resolve(config.testsDirectoryPath) !== path.resolve(rootDirectoryPath, "tests")
    )
      return true;
    if (isPathWithinDirectory(file, config.setsDirectoryPath)) return true;
    if (!isPathWithinDirectory(config.setsDirectoryPath, file)) return false;
    const parts = path.relative(config.setsDirectoryPath, file).split(path.sep);
    return parts.length === 1 || parts[1] === "tests";
  });
}

export function createCatalogApi(runtime: CatalogRuntime) {
  return {
    exportCatalog: (
      rootDirectoryPath: string,
      projectConfig: any,
      datasource: any,
      options: CatalogExportOptions = {},
    ) => exportCatalog(runtime, rootDirectoryPath, projectConfig, datasource, options),
    serveCatalog: (
      rootDirectoryPath: string,
      projectConfig: any,
      datasource: any,
      options: CatalogServeOptions = {},
    ) => serveCatalog(runtime, rootDirectoryPath, projectConfig, datasource, options),
  };
}

function shouldCopyAssets(parsed: CatalogPluginParsedOptions) {
  return parsed.assets !== false && parsed.noAssets !== true && parsed["no-assets"] !== true;
}

function getCatalogSerializationOptions(parsed: CatalogPluginParsedOptions) {
  return {
    prettyOutput: parsed.prettyOutput ?? parsed["pretty-output"],
    blockSize: parsed.blockSize ?? parsed["block-size"],
  };
}

function getCatalogOutputDirectoryPath(
  rootDirectoryPath: string,
  projectConfig: any,
  parsed: CatalogPluginParsedOptions,
) {
  return parsed.outDir
    ? path.resolve(rootDirectoryPath, parsed.outDir)
    : projectConfig.catalogDirectoryPath;
}

function getCatalogIgnoredDirectoryPaths(rootDirectoryPath: string, outputDirectoryPath: string) {
  return [
    path.join(rootDirectoryPath, ".git"),
    path.join(rootDirectoryPath, "node_modules"),
    path.join(rootDirectoryPath, ".featurevisor"),
    path.join(rootDirectoryPath, "datafiles"),
    path.join(rootDirectoryPath, "catalog"),
    outputDirectoryPath,
  ];
}

export async function startCatalogDevMode(
  runtime: CatalogRuntime,
  api: ReturnType<typeof createCatalogApi>,
  rootDirectoryPath: string,
  initialProjectConfig: any,
  initialDatasource: any,
  parsed: CatalogPluginParsedOptions,
) {
  const browserRouter = !(parsed.hashRouter || parsed["hash-router"]);
  let projectConfig = initialProjectConfig;
  let datasource = initialDatasource;
  let outputDirectoryPath = getCatalogOutputDirectoryPath(rootDirectoryPath, projectConfig, parsed);
  let devSession =
    typeof datasource.listHistoryEntries === "function"
      ? await createCatalogDevSession(rootDirectoryPath, projectConfig, datasource, {
          outDir: parsed.outDir,
          branch: parsed.branch,
        })
      : undefined;
  let gitWatchPaths = getGitWatchPaths(rootDirectoryPath);
  const getStateWatchPaths = async () => {
    if (!(parsed.testReport || parsed["test-report"]) || !runtime.getTestInputStatePaths) return [];
    const executions = await runtime.getProjectSetExecutions(projectConfig, datasource);
    return [
      ...new Set(
        executions
          .flatMap((execution) => runtime.getTestInputStatePaths!(execution.projectConfig))
          .map((file) => path.resolve(rootDirectoryPath, file)),
      ),
    ].sort();
  };
  let stateWatchPaths =
    (parsed.testReport || parsed["test-report"]) && runtime.getTestInputStatePaths
      ? await getStateWatchPaths()
      : [];

  await api.exportCatalog(rootDirectoryPath, projectConfig, datasource, {
    outDir: parsed.outDir,
    copyAssets: shouldCopyAssets(parsed),
    browserRouter,
    dev: true,
    testReport: parsed.testReport || parsed["test-report"],
    devSession,
    compactStorage: true,
    ...getCatalogSerializationOptions(parsed),
  });
  const server = await api.serveCatalog(rootDirectoryPath, projectConfig, datasource, {
    outDir: parsed.outDir,
    port: parsed.port || parsed.p,
    browserRouter,
    liveReload: true,
  });
  let servedOutputDirectoryPath = outputDirectoryPath;

  let exportInFlight = false;
  let exportQueued = false;
  let stopped = false;
  let closing: Promise<void> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeRebuild: Promise<void> | undefined;
  let stopWatchingProject = () => {};
  const pendingChangedPaths = new Set<string>();
  const configPath = path.resolve(rootDirectoryPath, "featurevisor.config.js");
  let watcherSignature: string | undefined;

  const configureWatcher = () => {
    if (stopped) return;
    const ignored = getCatalogIgnoredDirectoryPaths(rootDirectoryPath, outputDirectoryPath);
    const extras = [
      ...gitWatchPaths,
      ...stateWatchPaths,
      ...(parsed.testReport || parsed["test-report"]
        ? [path.resolve(rootDirectoryPath, parsed.testReport || parsed["test-report"])]
        : []),
    ];
    const signature = JSON.stringify([
      getCatalogInputWatchPaths(rootDirectoryPath, projectConfig),
      ignored,
      extras,
    ]);
    // Polling's initial invalidation can reload unchanged config. Keep its snapshot
    // instead of restarting polling and triggering another initial invalidation.
    if (signature === watcherSignature) return;
    stopWatchingProject();
    stopWatchingProject = watchCatalogInputs(
      rootDirectoryPath,
      projectConfig,
      ignored,
      (changedPaths) => {
        if (stopped) return;
        changedPaths.forEach((changedPath) => pendingChangedPaths.add(path.resolve(changedPath)));
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          queueRebuild();
        }, CATALOG_WATCH_DEBOUNCE_MS);
      },
      extras,
    );
    watcherSignature = signature;
  };

  const runRebuildAndReload = async () => {
    if (stopped) return;
    if (exportInFlight) {
      exportQueued = true;
      return;
    }

    exportInFlight = true;
    const changedPaths = Array.from(pendingChangedPaths);
    pendingChangedPaths.clear();
    console.log("\n[catalog] Rebuilding because project files changed");

    try {
      const configChanged = changedPaths.includes(configPath);
      const gitChanged =
        changedPaths.some((file) => gitWatchPaths.includes(file)) ||
        (devSession && devSession.gitFingerprint !== getGitFingerprint(rootDirectoryPath));
      const testsChanged = catalogTestInputsChanged(projectConfig, changedPaths, rootDirectoryPath);

      if (configChanged) {
        if (!runtime.reloadCatalogProject) {
          throw new Error(
            "Catalog watch mode cannot reload this project's configuration. Restart the Catalog process.",
          );
        }

        const reloaded = await runtime.reloadCatalogProject(rootDirectoryPath);
        const nextOutputDirectoryPath = getCatalogOutputDirectoryPath(
          rootDirectoryPath,
          reloaded.projectConfig,
          parsed,
        );
        projectConfig = reloaded.projectConfig;
        datasource = reloaded.datasource;
        outputDirectoryPath = nextOutputDirectoryPath;
      }

      let nextDevSession = devSession;
      if (configChanged || gitChanged || testsChanged) {
        nextDevSession =
          typeof datasource.listHistoryEntries === "function"
            ? await createCatalogDevSession(rootDirectoryPath, projectConfig, datasource, {
                outDir: parsed.outDir,
                branch: parsed.branch,
              })
            : undefined;
        // Parsed definitions stay valid across Git and test input changes, because each is
        // reused only while its source fingerprint matches. A configuration change can swap
        // the parser or directories, so it starts empty.
        if (nextDevSession && devSession && !configChanged) {
          nextDevSession.definitions = devSession.definitions;
          nextDevSession.realPaths = devSession.realPaths;
        }
      }
      const nextStateWatchPaths = await getStateWatchPaths();
      const statePathsChanged =
        JSON.stringify(nextStateWatchPaths) !== JSON.stringify(stateWatchPaths);
      stateWatchPaths = nextStateWatchPaths;
      if (configChanged || gitChanged || statePathsChanged) {
        gitWatchPaths = getGitWatchPaths(rootDirectoryPath);
        configureWatcher();
      }
      if (stopped) return;

      const outputDirectoryChanged =
        path.resolve(outputDirectoryPath) !== path.resolve(servedOutputDirectoryPath);
      await api.exportCatalog(rootDirectoryPath, projectConfig, datasource, {
        outDir: parsed.outDir,
        copyAssets: outputDirectoryChanged ? shouldCopyAssets(parsed) : false,
        preserveAssets: !outputDirectoryChanged,
        browserRouter,
        dev: true,
        testReport: parsed.testReport || parsed["test-report"],
        devSession: nextDevSession,
        changedPaths: configChanged || gitChanged || testsChanged ? undefined : changedPaths,
        compactStorage: true,
        ...getCatalogSerializationOptions(parsed),
      });
      devSession = nextDevSession;
      if (stopped) return;
      server.setOutputDirectoryPath(outputDirectoryPath);
      server.setBasePath(projectConfig.catalogBasePath || "/");
      servedOutputDirectoryPath = outputDirectoryPath;
      server.triggerReload();
    } catch (error) {
      changedPaths.forEach((file) => pendingChangedPaths.add(file));
      console.error("[catalog] Export failed during watch mode");
      console.error(error);
    } finally {
      exportInFlight = false;

      if (exportQueued && !stopped) {
        exportQueued = false;
        queueRebuild();
      }
    }
  };

  const queueRebuild = () => {
    if (stopped) return;
    if (exportInFlight) {
      exportQueued = true;
      return;
    }
    activeRebuild = runRebuildAndReload();
  };

  configureWatcher();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    process.off("exit", stop);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    stopWatchingProject();
    pendingChangedPaths.clear();
    exportQueued = false;
  };
  process.on("exit", stop);

  return {
    stop: () => {
      if (closing) return closing;
      stop();
      closing = Promise.all([server.close(), activeRebuild]).then(() => undefined);
      return closing;
    },
  };
}

export function createCatalogPlugin(
  runtime: CatalogRuntime,
  api: ReturnType<typeof createCatalogApi> = createCatalogApi(runtime),
): CatalogPlugin {
  return {
    command: "catalog [subcommand]",
    handler: async ({ rootDirectoryPath, projectConfig, datasource, parsed }) => {
      const allowedSubcommands = ["export", "serve"];
      const browserRouter = !(parsed.hashRouter || parsed["hash-router"]);

      if (!parsed.subcommand) {
        await startCatalogDevMode(
          runtime,
          api,
          rootDirectoryPath,
          projectConfig,
          datasource,
          parsed,
        );
        return;
      }

      if (allowedSubcommands.indexOf(parsed.subcommand) === -1) {
        console.log("Please specify a subcommand: `export` or `serve`");
        return false;
      }

      if (parsed.subcommand === "export") {
        await api.exportCatalog(rootDirectoryPath, projectConfig, datasource, {
          outDir: parsed.outDir,
          copyAssets: shouldCopyAssets(parsed),
          browserRouter,
          testReport: parsed.testReport || parsed["test-report"],
          compactStorage: true,
          branch: parsed.branch,
          ...getCatalogSerializationOptions(parsed),
        });
      }

      if (parsed.subcommand === "serve") {
        await api.serveCatalog(rootDirectoryPath, projectConfig, datasource, {
          outDir: parsed.outDir,
          port: parsed.port || parsed.p,
          browserRouter,
          ...getCatalogSerializationOptions(parsed),
          copyAssets: shouldCopyAssets(parsed),
          testReport: parsed.testReport || parsed["test-report"],
          branch: parsed.branch,
        });
      }
    },
    examples: [
      {
        command: "catalog",
        description: "Generate and serve the static Catalog locally",
      },
      {
        command: "catalog export",
        description: "Generate a static Catalog with project data",
      },
      {
        command: "catalog serve",
        description: "Serve the generated Catalog locally",
      },
    ],
  };
}
