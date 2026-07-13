import * as childProcess from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import type {
  Attribute,
  Condition,
  Group,
  GroupSegment,
  HistoryEntry,
  ParsedFeature,
  Schema,
  Segment,
  Target,
  Test,
} from "@featurevisor/types";

import type {
  CatalogEntityType,
  CatalogIndex,
  CatalogManifest,
  DevEditor,
  EntityDetail,
  EntitySummary,
  HistoryEntry as CatalogHistoryEntry,
  LastModified,
} from "../types";
import { sortSetKeys } from "../entityTypes";

const CATALOG_SCHEMA_VERSION = "1";
const CATALOG_HISTORY_PAGE_SIZE = 50;
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
  getProjectSetExecutions: (
    projectConfig: any,
    datasource: any,
    selectedSet?: string,
  ) => Promise<Array<{ set: string; projectConfig: any; datasource: any }>>;
}

export interface CatalogExportOptions {
  outDir?: string;
  copyAssets?: boolean;
  browserRouter?: boolean;
  dev?: boolean;
  devEditors?: DevEditor[];
  devSession?: CatalogDevSession;
  preserveAssets?: boolean;
}

export interface CatalogServeOptions {
  outDir?: string;
  port?: number | string;
  browserRouter?: boolean;
  liveReload?: boolean;
}

export interface CatalogServerHandle {
  close: () => Promise<void>;
  triggerReload: () => void;
}

interface CatalogHistoryIndex {
  entries: CatalogHistoryEntry[];
  bySet: Record<string, CatalogHistoryEntry[]>;
  byEntity: Record<string, CatalogHistoryEntry[]>;
  lastModifiedByEntity: Record<string, LastModified>;
}

interface CatalogDevSession {
  outputDirectoryPath: string;
  devEditors: DevEditor[];
  historyIndex: CatalogHistoryIndex;
  links: CatalogManifest["links"];
  repositoryRootDirectoryPath: string;
  repositorySourceRootDirectoryPath: string;
}

interface CatalogBuildContext {
  rootDirectoryPath: string;
  repositorySourceRootDirectoryPath: string;
  outputDirectoryPath: string;
  dataDirectoryPath: string;
  historyIndex: CatalogHistoryIndex;
  devEditors: DevEditor[];
  progress: CatalogProgressReporter;
  writer: CatalogJsonWriter;
}

type EntityMaps = {
  feature: Record<string, ParsedFeature>;
  segment: Record<string, Segment>;
  attribute: Record<string, Attribute>;
  target: Record<string, Target>;
  group: Record<string, Group>;
  schema: Record<string, Schema>;
  test: Record<string, Test>;
};

type RelationshipMaps = {
  featureTargets: Record<string, Set<string>>;
  featureTests: Record<string, Set<string>>;
  featureRequiredBy: Record<string, Set<string>>;
  featureSegments: Record<string, Set<string>>;
  featureAttributes: Record<string, Set<string>>;
  featureSchemas: Record<string, Set<string>>;
  featureGroups: Record<string, Set<string>>;
  segmentsUsedInFeatures: Record<string, Set<string>>;
  attributesUsedInFeatures: Record<string, Set<string>>;
  attributesUsedInSegments: Record<string, Set<string>>;
  segmentTargets: Record<string, Set<string>>;
  attributeTargets: Record<string, Set<string>>;
  groupsUsedInFeatures: Record<string, Set<string>>;
  schemasUsedInFeatures: Record<string, Set<string>>;
  segmentTests: Record<string, Set<string>>;
  targetFeatures: Record<string, Set<string>>;
};

interface SourceFileInfo {
  sourcePath: string;
  absolutePath: string;
}

class CatalogJsonWriter {
  async write(filePath: string, value: unknown) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(value, null, 2));
  }
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
  const result: Record<string, T> = {};

  for (const key of keys) {
    result[key] = await read(key);
  }

  return result;
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

function collectAttributeKeysFromConditions(
  condition: Condition | Condition[] | "*" | undefined,
  result: Set<string>,
) {
  if (!condition || condition === "*") {
    return;
  }

  if (Array.isArray(condition)) {
    condition.forEach((item) => collectAttributeKeysFromConditions(item, result));
    return;
  }

  if (typeof condition === "string") {
    return;
  }

  if ("attribute" in condition) {
    result.add(condition.attribute);
    return;
  }

  if ("and" in condition) collectAttributeKeysFromConditions(condition.and, result);
  if ("or" in condition) collectAttributeKeysFromConditions(condition.or, result);
  if ("not" in condition) collectAttributeKeysFromConditions(condition.not, result);
}

function collectSegmentKeys(
  segments: GroupSegment | GroupSegment[] | "*" | undefined,
  result: Set<string>,
) {
  if (!segments || segments === "*") {
    return;
  }

  if (typeof segments === "string") {
    result.add(segments);
    return;
  }

  if (Array.isArray(segments)) {
    segments.forEach((segment) => collectSegmentKeys(segment, result));
    return;
  }

  if ("and" in segments) collectSegmentKeys(segments.and, result);
  if ("or" in segments) collectSegmentKeys(segments.or, result);
  if ("not" in segments) collectSegmentKeys(segments.not, result);
}

function collectFeatureKeysFromRequired(required: ParsedFeature["required"], result: Set<string>) {
  for (const item of required || []) {
    result.add(typeof item === "string" ? item : item.key);
  }
}

function collectSchemaKeysFromVariables(
  variablesSchema: ParsedFeature["variablesSchema"],
  result: Set<string>,
) {
  for (const schema of Object.values(variablesSchema || {})) {
    if ("schema" in schema && typeof schema.schema === "string") {
      result.add(schema.schema);
    }
  }
}

function collectGroupKeysFromRules(rules: ParsedFeature["rules"], result: Set<string>) {
  const ruleRows = Array.isArray(rules) ? rules : Object.values(rules || {}).flat();

  for (const rule of ruleRows) {
    if (rule.segments && !Array.isArray(rule.segments) && typeof rule.segments === "object") {
      for (const groupKey of ["and", "or", "not"] as const) {
        if (groupKey in rule.segments) {
          result.add(JSON.stringify(rule.segments));
        }
      }
    }
  }
}

function getFeatureRules(feature: ParsedFeature) {
  return Array.isArray(feature.rules) ? feature.rules : Object.values(feature.rules || {}).flat();
}

function getFeatureForce(feature: ParsedFeature) {
  return Array.isArray(feature.force) ? feature.force : Object.values(feature.force || {}).flat();
}

function matchesFeaturePatterns(featureKey: string, patterns?: "*" | string[]) {
  if (!patterns) {
    return false;
  }

  const normalizedPatterns = patterns === "*" ? [patterns] : patterns;

  return normalizedPatterns.some((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(featureKey);
  });
}

function targetIncludesFeature(target: Target, featureKey: string, feature: ParsedFeature) {
  const featureTags = feature.tags || [];
  let matchesTags = true;

  if (target.tag) {
    matchesTags = featureTags.includes(target.tag);
  } else if (Array.isArray(target.tags)) {
    matchesTags = target.tags.some((tag) => featureTags.includes(tag));
  } else if (target.tags && "or" in target.tags) {
    matchesTags = target.tags.or.some((tag) => featureTags.includes(tag));
  } else if (target.tags && "and" in target.tags) {
    matchesTags = target.tags.and.every((tag) => featureTags.includes(tag));
  }

  const matchesIncludedFeatures = target.includeFeatures
    ? matchesFeaturePatterns(featureKey, target.includeFeatures)
    : true;
  const matchesExcludedFeatures = matchesFeaturePatterns(featureKey, target.excludeFeatures);

  return matchesTags && matchesIncludedFeatures && !matchesExcludedFeatures;
}

function getHistoryEntityKey(type: CatalogEntityType, key: string, set?: string) {
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
  type: CatalogEntityType,
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
    ...extra,
    lastModified: getLastModified(historyIndex, type, key, set),
    href: `entities/${type}/${encodeKeyUrlPath(key)}.json`,
  };
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

function getFeatureEnvironmentStatus(
  feature: ParsedFeature,
): Pick<EntitySummary, "environmentStatus" | "environmentStatusEnvironment"> {
  if (Array.isArray(feature.rules)) {
    return {};
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
    author: entry.author,
    timestamp: entry.timestamp,
    entities: entry.entities.map((entity) => ({
      type: entity.type,
      key: entity.key,
      set,
    })),
  };
}

async function getGitHistoryIndex(
  projectConfig: any,
  datasource: any,
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
  writer: CatalogJsonWriter,
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
    group: projectConfig.groupsDirectoryPath,
    schema: projectConfig.schemasDirectoryPath,
    test: projectConfig.testsDirectoryPath,
  };
  const filePath = key.split(projectConfig.namespaceCharacter || ".").join(path.sep);

  return path.join(directoryByType[type], `${filePath}.${datasource.getExtension()}`);
}

function getSourceFileInfo(
  repositorySourceRootDirectoryPath: string,
  projectConfig: any,
  datasource: any,
  type: CatalogEntityType,
  key: string,
  options: { resolveAbsolutePath?: boolean } = {},
): SourceFileInfo {
  const filePath = path.resolve(getEntityFilePath(projectConfig, datasource, type, key));
  const absolutePath = options.resolveAbsolutePath ? getRealPath(filePath) : filePath;

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
    editors.push({ id: "cursor", label: "Cursor", icon: "cursor" });
  }

  if (hasKnownEditorInstall("vscode")) {
    editors.push({ id: "vscode", label: "VS Code", icon: "vscode" });
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

function getRepoLinks(rootDirectoryPath: string): CatalogManifest["links"] {
  try {
    const origin = runGit(rootDirectoryPath, ["config", "--get", "remote.origin.url"]).trim();
    const branch = encodeURI(getCurrentBranch(rootDirectoryPath));
    const providers: Record<
      NonNullable<NonNullable<CatalogManifest["links"]>["provider"]>,
      {
        host: string;
        repository: (owner: string, repo: string) => string;
        source: (owner: string, repo: string) => string;
        commit: (owner: string, repo: string) => string;
      }
    > = {
      github: {
        host: "github.com",
        repository: (owner, repo) => `https://github.com/${owner}/${repo}`,
        source: (owner, repo) => `https://github.com/${owner}/${repo}/blob/${branch}/{{path}}`,
        commit: (owner, repo) => `https://github.com/${owner}/${repo}/commit/{{hash}}`,
      },
      gitlab: {
        host: "gitlab.com",
        repository: (owner, repo) => `https://gitlab.com/${owner}/${repo}`,
        source: (owner, repo) => `https://gitlab.com/${owner}/${repo}/-/blob/${branch}/{{path}}`,
        commit: (owner, repo) => `https://gitlab.com/${owner}/${repo}/-/commit/{{hash}}`,
      },
      bitbucket: {
        host: "bitbucket.org",
        repository: (owner, repo) => `https://bitbucket.org/${owner}/${repo}`,
        source: (owner, repo) => `https://bitbucket.org/${owner}/${repo}/src/${branch}/{{path}}`,
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
          commit: config.commit(details.owner, details.repo),
        };
      }
    }
  } catch {
    return undefined;
  }
}

function buildRelationships(maps: EntityMaps): RelationshipMaps {
  const relationships: RelationshipMaps = {
    featureTargets: {},
    featureTests: {},
    featureRequiredBy: {},
    featureSegments: {},
    featureAttributes: {},
    featureSchemas: {},
    featureGroups: {},
    segmentsUsedInFeatures: {},
    attributesUsedInFeatures: {},
    attributesUsedInSegments: {},
    segmentTargets: {},
    attributeTargets: {},
    groupsUsedInFeatures: {},
    schemasUsedInFeatures: {},
    segmentTests: {},
    targetFeatures: {},
  };

  for (const [featureKey, feature] of Object.entries(maps.feature)) {
    const required = new Set<string>();
    const segments = new Set<string>();
    const attributes = new Set<string>();
    const schemas = new Set<string>();
    const groups = new Set<string>();

    collectFeatureKeysFromRequired(feature.required, required);
    collectSchemaKeysFromVariables(feature.variablesSchema, schemas);
    collectGroupKeysFromRules(feature.rules, groups);

    for (const rule of getFeatureRules(feature)) {
      collectSegmentKeys(rule.segments, segments);
      collectAttributeKeysFromConditions(
        (rule as { conditions?: Condition | Condition[] | "*" }).conditions,
        attributes,
      );
    }

    for (const force of getFeatureForce(feature)) {
      collectSegmentKeys(force.segments, segments);
      collectAttributeKeysFromConditions(force.conditions, attributes);
    }

    for (const variation of feature.variations || []) {
      for (const overrides of Object.values(variation.variableOverrides || {})) {
        for (const override of overrides) {
          collectSegmentKeys(override.segments, segments);
          collectAttributeKeysFromConditions(override.conditions, attributes);
        }
      }
    }

    for (const requiredKey of required) {
      addToSet(relationships.featureRequiredBy, requiredKey, featureKey);
    }

    for (const segmentKey of segments) {
      addToSet(relationships.featureSegments, featureKey, segmentKey);
      addToSet(relationships.segmentsUsedInFeatures, segmentKey, featureKey);
    }

    for (const attributeKey of attributes) {
      addToSet(relationships.featureAttributes, featureKey, attributeKey);
      addToSet(relationships.attributesUsedInFeatures, attributeKey, featureKey);
    }

    for (const schemaKey of schemas) {
      addToSet(relationships.featureSchemas, featureKey, schemaKey);
      addToSet(relationships.schemasUsedInFeatures, schemaKey, featureKey);
    }

    for (const groupKey of groups) {
      addToSet(relationships.featureGroups, featureKey, groupKey);
      addToSet(relationships.groupsUsedInFeatures, groupKey, featureKey);
    }
  }

  for (const [segmentKey, segment] of Object.entries(maps.segment)) {
    const attributes = new Set<string>();
    collectAttributeKeysFromConditions(segment.conditions, attributes);

    for (const attributeKey of attributes) {
      addToSet(relationships.attributesUsedInSegments, attributeKey, segmentKey);
    }
  }

  for (const [targetKey, target] of Object.entries(maps.target)) {
    for (const [featureKey, feature] of Object.entries(maps.feature)) {
      if (targetIncludesFeature(target, featureKey, feature)) {
        addToSet(relationships.targetFeatures, targetKey, featureKey);
        addToSet(relationships.featureTargets, featureKey, targetKey);
      }
    }
  }

  for (const [featureKey, targetKeys] of Object.entries(relationships.featureTargets)) {
    for (const targetKey of targetKeys) {
      for (const segmentKey of relationships.featureSegments[featureKey] || []) {
        addToSet(relationships.segmentTargets, segmentKey, targetKey);

        const segmentAttributes = new Set<string>();
        collectAttributeKeysFromConditions(maps.segment[segmentKey]?.conditions, segmentAttributes);

        for (const attributeKey of segmentAttributes) {
          addToSet(relationships.attributeTargets, attributeKey, targetKey);
        }
      }

      for (const attributeKey of relationships.featureAttributes[featureKey] || []) {
        addToSet(relationships.attributeTargets, attributeKey, targetKey);
      }
    }
  }

  for (const [testKey, test] of Object.entries(maps.test)) {
    if ("feature" in test) {
      addToSet(relationships.featureTests, test.feature, testKey);
    }

    if ("segment" in test) {
      addToSet(relationships.segmentTests, test.segment, testKey);
    }
  }

  return relationships;
}

function getEntityRelationships(
  type: CatalogEntityType,
  key: string,
  relationships: RelationshipMaps,
): Record<string, string[]> {
  if (type === "feature") {
    return {
      targets: sortSet(relationships.featureTargets[key]),
      tests: sortSet(relationships.featureTests[key]),
      requiredBy: sortSet(relationships.featureRequiredBy[key]),
      segments: sortSet(relationships.featureSegments[key]),
      attributes: sortSet(relationships.featureAttributes[key]),
      schemas: sortSet(relationships.featureSchemas[key]),
      groups: sortSet(relationships.featureGroups[key]),
    };
  }

  if (type === "segment") {
    return {
      features: sortSet(relationships.segmentsUsedInFeatures[key]),
      tests: sortSet(relationships.segmentTests[key]),
      attributes: sortSet(relationships.attributesUsedInSegments[key]),
      targets: sortSet(relationships.segmentTargets[key]),
    };
  }

  if (type === "attribute") {
    return {
      features: sortSet(relationships.attributesUsedInFeatures[key]),
      segments: sortSet(relationships.attributesUsedInSegments[key]),
      targets: sortSet(relationships.attributeTargets[key]),
    };
  }

  if (type === "target") {
    return {
      features: sortSet(relationships.targetFeatures[key]),
    };
  }

  if (type === "schema") {
    return {
      features: sortSet(relationships.schemasUsedInFeatures[key]),
    };
  }

  if (type === "group") {
    return {
      features: sortSet(relationships.groupsUsedInFeatures[key]),
    };
  }

  return {};
}

async function buildSetCatalog(
  context: CatalogBuildContext,
  set: string,
  projectConfig: any,
  datasource: any,
  outputRelativeDirectory: string,
) {
  const outputDirectoryPath = path.join(context.dataDirectoryPath, outputRelativeDirectory);
  const setStartedAt = context.progress.setStart(set || undefined);
  const entitiesStartedAt = context.progress.step("Processing entities");
  const [featureKeys, segmentKeys, attributeKeys, targetKeys, groupKeys, schemaKeys, testKeys] =
    await Promise.all([
      datasource.listFeatures(),
      datasource.listSegments(),
      datasource.listAttributes(),
      datasource.listTargets(),
      datasource.listGroups(),
      datasource.listSchemas(),
      datasource.listTests(),
    ]);
  const maps: EntityMaps = {
    feature: await readAll<ParsedFeature>(featureKeys, (key) => datasource.readFeature(key)),
    segment: await readAll<Segment>(segmentKeys, (key) => datasource.readSegment(key)),
    attribute: await readAll<Attribute>(attributeKeys, (key) => datasource.readAttribute(key)),
    target: await readAll<Target>(targetKeys, (key) => datasource.readTarget(key)),
    group: await readAll<Group>(groupKeys, (key) => datasource.readGroup(key)),
    schema: await readAll<Schema>(schemaKeys, (key) => datasource.readSchema(key)),
    test: await readAll<Test>(testKeys, (key) => datasource.readTest(key)),
  };
  context.progress.done(
    entitiesStartedAt,
    `(${[
      pluralize(featureKeys.length, "feature"),
      pluralize(segmentKeys.length, "segment"),
      pluralize(attributeKeys.length, "attribute"),
      pluralize(targetKeys.length, "target"),
      pluralize(groupKeys.length, "group"),
      pluralize(schemaKeys.length, "schema"),
      pluralize(testKeys.length, "test"),
    ].join(", ")})`,
  );

  const relationshipsStartedAt = context.progress.step("Mapping relationships");
  const relationships = buildRelationships(maps);
  context.progress.done(relationshipsStartedAt);

  const history = set ? context.historyIndex.bySet[set] || [] : context.historyIndex.entries;
  const index: CatalogIndex = {
    set,
    counts: {
      feature: featureKeys.length,
      segment: segmentKeys.length,
      attribute: attributeKeys.length,
      target: targetKeys.length,
      group: groupKeys.length,
      schema: schemaKeys.length,
      test: testKeys.length,
    },
    entities: {
      feature: [],
      segment: [],
      attribute: [],
      target: [],
      group: [],
      schema: [],
      test: [],
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
    { type: "group", keys: groupKeys, entities: maps.group },
    { type: "schema", keys: schemaKeys, entities: maps.schema },
    { type: "test", keys: testKeys, entities: maps.test },
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
        { resolveAbsolutePath: context.devEditors.length > 0 },
      );
      const lastModified = getLastModified(context.historyIndex, plan.type, key, set);
      const entityRelationships = getEntityRelationships(plan.type, key, relationships);
      const entityTests =
        plan.type === "feature" || plan.type === "segment"
          ? (entityRelationships.tests || []).map((testKey) => ({
              ...maps.test[testKey],
              key: maps.test[testKey].key || testKey,
            }))
          : undefined;
      const detail: EntityDetail = {
        type: plan.type,
        key,
        entity,
        sourcePath: sourceFileInfo.sourcePath,
        editLinks: getEditorLinks(context.devEditors, sourceFileInfo),
        lastModified,
        relationships: entityRelationships,
        tests: entityTests?.length ? entityTests : undefined,
        environments: projectConfig.environments,
        historyPath: `${path.posix.join(
          "data",
          outputRelativeDirectory.split(path.sep).join(path.posix.sep),
          "entities",
          plan.type,
          encodeKeyUrlPath(key),
          "history",
        )}`,
      };

      await context.writer.write(
        path.join(outputDirectoryPath, "entities", plan.type, `${encodeKeyPath(key)}.json`),
        detail,
      );

      await writeHistoryPages(
        context.writer,
        path.join(outputDirectoryPath, "entities", plan.type, encodeKeyPath(key), "history"),
        context.historyIndex.byEntity[getHistoryEntityKey(plan.type, key, set)] || [],
      );

      index.entities[plan.type].push(
        getEntitySummary(entity, plan.type, key, context.historyIndex, set, {
          tags: entity.tags ? entity.tags : undefined,
          targets:
            plan.type === "feature"
              ? sortSet(relationships.featureTargets[key])
              : plan.type === "segment"
                ? sortSet(relationships.segmentTargets[key])
                : plan.type === "attribute"
                  ? sortSet(relationships.attributeTargets[key])
                  : undefined,
          usedInFeatureCount:
            plan.type === "segment"
              ? sortSet(relationships.segmentsUsedInFeatures[key]).length
              : undefined,
          usedInSegmentCount:
            plan.type === "attribute"
              ? sortSet(relationships.attributesUsedInSegments[key]).length
              : undefined,
          environments:
            plan.type === "feature"
              ? getFeatureEnvironmentKeys(entity, projectConfig.environments)
              : projectConfig.environments,
          variationValues: plan.type === "feature" ? getFeatureVariationValues(entity) : undefined,
          variableKeys: plan.type === "feature" ? getFeatureVariableKeys(entity) : undefined,
          hasVariations: plan.type === "feature" ? Boolean(entity.variations?.length) : undefined,
          hasVariables:
            plan.type === "feature"
              ? Object.keys(entity.variablesSchema || {}).length > 0
              : undefined,
          ...featureEnvironmentStatus,
        }),
      );
    }

    index.entities[plan.type].sort((a, b) => a.key.localeCompare(b.key));
  }
  context.progress.done(detailsStartedAt);

  await context.writer.write(path.join(outputDirectoryPath, "index.json"), index);
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
  options: CatalogExportOptions = {},
) {
  const outputDirectoryPath = options.outDir
    ? path.resolve(rootDirectoryPath, options.outDir)
    : projectConfig.catalogDirectoryPath;
  const dataDirectoryPath = path.join(outputDirectoryPath, "data");
  const progress = new CatalogProgressReporter(rootDirectoryPath, outputDirectoryPath);
  const writer = new CatalogJsonWriter();

  progress.start({
    browserRouter: options.browserRouter !== false,
    sets: projectConfig.sets === true,
  });

  let stepStartedAt = progress.step("Preparing output directory");
  if (options.preserveAssets) {
    await fs.promises.rm(dataDirectoryPath, { recursive: true, force: true });
  } else {
    await fs.promises.rm(outputDirectoryPath, { recursive: true, force: true });
  }
  await fs.promises.mkdir(dataDirectoryPath, { recursive: true });
  progress.done(stepStartedAt);

  if (options.copyAssets !== false) {
    stepStartedAt = progress.step("Copying Catalog UI assets");
    await copyCatalogAssets(outputDirectoryPath);
    progress.done(stepStartedAt);
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
  const links = options.devSession?.links || getRepoLinks(repositoryRootDirectoryPath);
  progress.done(stepStartedAt, links?.repository ? `(${links.repository})` : "(none)");

  stepStartedAt = progress.step("Reading Git history");
  const historyIndex =
    options.devSession?.historyIndex || (await getGitHistoryIndex(projectConfig, datasource));
  progress.done(stepStartedAt, `(${pluralize(historyIndex.entries.length, "commit")})`);

  const context: CatalogBuildContext = {
    rootDirectoryPath,
    repositorySourceRootDirectoryPath,
    outputDirectoryPath,
    dataDirectoryPath,
    historyIndex,
    devEditors,
    progress,
    writer,
  };

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

  const setIndexes: Record<string, CatalogIndex> = {};
  for (const execution of executions) {
    const outputRelativeDirectory = projectConfig.sets ? path.join("sets", execution.set) : "root";
    setIndexes[execution.set || "root"] = await buildSetCatalog(
      context,
      execution.set,
      execution.projectConfig,
      execution.datasource,
      outputRelativeDirectory,
    );
  }

  stepStartedAt = progress.step("Writing manifest");
  const manifest: CatalogManifest = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    router: options.browserRouter === false ? "hash" : "browser",
    sets: projectConfig.sets,
    setKeys: projectConfig.sets ? sortSetKeys(executions.map((execution) => execution.set)) : [],
    projectConfig: {
      tags: projectConfig.tags,
      environments: projectConfig.environments,
    },
    dev: options.dev ? { editors: devEditors } : undefined,
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
    counts: Object.fromEntries(Object.keys(setIndexes).map((key) => [key, setIndexes[key].counts])),
  };

  await writer.write(path.join(dataDirectoryPath, "manifest.json"), manifest);
  progress.done(stepStartedAt);
  progress.complete();

  return {
    outputDirectoryPath,
    manifest,
  };
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
    '  const source = new EventSource("/__featurevisor_catalog_reload");',
    '  source.addEventListener("reload", () => window.location.reload());',
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

function getCatalogInputWatchPaths(rootDirectoryPath: string, projectConfig: any) {
  const paths = [path.join(rootDirectoryPath, "featurevisor.config.js")];

  if (projectConfig.sets) {
    paths.push(projectConfig.setsDirectoryPath);
    return paths;
  }

  paths.push(
    projectConfig.featuresDirectoryPath,
    projectConfig.segmentsDirectoryPath,
    projectConfig.attributesDirectoryPath,
    projectConfig.targetsDirectoryPath,
    projectConfig.groupsDirectoryPath,
    projectConfig.schemasDirectoryPath,
    projectConfig.testsDirectoryPath,
  );

  return paths.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function createCatalogInputWatcher(
  rootDirectoryPath: string,
  projectConfig: any,
  ignoredDirectoryPaths: string[],
  onChange: (changedPaths: string[]) => void,
) {
  const watchPaths = getCatalogInputWatchPaths(rootDirectoryPath, projectConfig);

  function shouldIgnore(targetPath: string) {
    const resolvedTargetPath = path.resolve(targetPath);

    return ignoredDirectoryPaths.some((ignoredDirectoryPath) => {
      const resolvedIgnoredPath = path.resolve(ignoredDirectoryPath);

      return (
        resolvedTargetPath === resolvedIgnoredPath ||
        resolvedTargetPath.startsWith(`${resolvedIgnoredPath}${path.sep}`)
      );
    });
  }

  function collectSnapshotEntries(directoryPath: string, snapshotEntries: Map<string, string>) {
    if (shouldIgnore(directoryPath)) {
      return;
    }

    let entries: fs.Dirent[] = [];

    try {
      entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);

      if (shouldIgnore(entryPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        collectSnapshotEntries(entryPath, snapshotEntries);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      try {
        const stat = fs.statSync(entryPath);
        snapshotEntries.set(entryPath, `${stat.size}:${stat.mtimeMs}`);
      } catch {
        // Ignore transient editor save races.
      }
    }
  }

  function createSnapshot() {
    const snapshotEntries = new Map<string, string>();

    for (const watchPath of watchPaths) {
      if (!fs.existsSync(watchPath)) {
        continue;
      }

      const stat = fs.statSync(watchPath);

      if (stat.isFile()) {
        snapshotEntries.set(watchPath, `${stat.size}:${stat.mtimeMs}`);
        continue;
      }

      collectSnapshotEntries(watchPath, snapshotEntries);
    }

    return snapshotEntries;
  }

  function getSnapshotChanges(previous: Map<string, string>, next: Map<string, string>) {
    const changedPaths = new Set<string>();

    for (const [filePath, signature] of Array.from(next.entries())) {
      if (previous.get(filePath) !== signature) {
        changedPaths.add(filePath);
      }
    }

    for (const filePath of Array.from(previous.keys())) {
      if (!next.has(filePath)) {
        changedPaths.add(filePath);
      }
    }

    return Array.from(changedPaths);
  }

  let previousSnapshot = createSnapshot();
  const interval = setInterval(() => {
    const nextSnapshot = createSnapshot();
    const changedPaths = getSnapshotChanges(previousSnapshot, nextSnapshot);
    previousSnapshot = nextSnapshot;

    if (changedPaths.length > 0) {
      onChange(changedPaths);
    }
  }, 1000);

  return () => clearInterval(interval);
}

export async function serveCatalog(
  runtime: CatalogRuntime,
  rootDirectoryPath: string,
  projectConfig: any,
  datasource: any,
  options: CatalogServeOptions = {},
): Promise<CatalogServerHandle> {
  const outputDirectoryPath = options.outDir
    ? path.resolve(rootDirectoryPath, options.outDir)
    : projectConfig.catalogDirectoryPath;

  if (!fs.existsSync(outputDirectoryPath)) {
    await exportCatalog(runtime, rootDirectoryPath, projectConfig, datasource, {
      outDir: outputDirectoryPath,
      browserRouter: options.browserRouter,
    });
  }

  const port = Number(options.port || 3000);
  const liveReloadClients = new Set<http.ServerResponse>();

  function triggerReload() {
    liveReloadClients.forEach((client) => {
      client.write("event: reload\n");
      client.write("data: reload\n\n");
    });
  }

  const server = http.createServer((request, response) => {
    const requestedUrl = decodeURIComponent((request.url || "/").split("?")[0]);

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

    const requestedPath = requestedUrl === "/" ? "/index.html" : requestedUrl;
    const assetPath = requestedPath === "/favicon.ico" ? "/favicon.png" : requestedPath;
    const filePath = path.join(outputDirectoryPath, assetPath);
    const safeFilePath = filePath.startsWith(outputDirectoryPath)
      ? filePath
      : path.join(outputDirectoryPath, "index.html");

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
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("404 Not Found");
        return;
      }

      fs.readFile(path.join(outputDirectoryPath, "index.html"), (indexError, indexContent) => {
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
    });
  });

  server.on("error", (error) => {
    console.error(`Unable to serve catalog on http://127.0.0.1:${port}/`);
    console.error(error);
    process.exitCode = 1;
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Catalog running at http://127.0.0.1:${port}/`);
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
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
    historyIndex: await getGitHistoryIndex(projectConfig, datasource),
    links: getRepoLinks(repositoryRootDirectoryPath),
    repositoryRootDirectoryPath,
    repositorySourceRootDirectoryPath,
  };
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
        const outputDirectoryPath = parsed.outDir
          ? path.resolve(rootDirectoryPath, parsed.outDir)
          : projectConfig.catalogDirectoryPath;
        const devSession = await createCatalogDevSession(
          rootDirectoryPath,
          projectConfig,
          datasource,
          {
            outDir: parsed.outDir,
          },
        );

        await api.exportCatalog(rootDirectoryPath, projectConfig, datasource, {
          outDir: parsed.outDir,
          copyAssets: shouldCopyAssets(parsed),
          browserRouter,
          dev: true,
          devSession,
        });
        const server = await api.serveCatalog(rootDirectoryPath, projectConfig, datasource, {
          outDir: parsed.outDir,
          port: parsed.port || parsed.p,
          browserRouter,
          liveReload: true,
        });
        const ignoredDirectoryPaths = [
          path.join(rootDirectoryPath, ".git"),
          path.join(rootDirectoryPath, "node_modules"),
          path.join(rootDirectoryPath, ".featurevisor"),
          path.join(rootDirectoryPath, "datafiles"),
          path.join(rootDirectoryPath, "catalog"),
          outputDirectoryPath,
        ];
        let exportInFlight = false;
        let exportQueued = false;
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        const runRebuildAndReload = async () => {
          if (exportInFlight) {
            exportQueued = true;
            return;
          }

          exportInFlight = true;
          console.log("\n[catalog] Rebuilding because project files changed");

          try {
            await api.exportCatalog(rootDirectoryPath, projectConfig, datasource, {
              outDir: parsed.outDir,
              copyAssets: false,
              preserveAssets: true,
              browserRouter,
              dev: true,
              devSession,
            });
            server.triggerReload();
          } catch (error) {
            console.error("[catalog] Export failed during watch mode");
            console.error(error);
          } finally {
            exportInFlight = false;

            if (exportQueued) {
              exportQueued = false;
              void runRebuildAndReload();
            }
          }
        };

        const stopWatchingProject = createCatalogInputWatcher(
          rootDirectoryPath,
          projectConfig,
          ignoredDirectoryPaths,
          () => {
            if (debounceTimer) {
              clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
              debounceTimer = null;
              void runRebuildAndReload();
            }, 250);
          },
        );

        process.on("exit", stopWatchingProject);
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
        });
      }

      if (parsed.subcommand === "serve") {
        await api.serveCatalog(rootDirectoryPath, projectConfig, datasource, {
          outDir: parsed.outDir,
          port: parsed.port || parsed.p,
          browserRouter,
        });
      }
    },
    examples: [
      {
        command: "catalog",
        description: "generate and serve the static catalog locally",
      },
      {
        command: "catalog export",
        description: "generate static catalog with project data",
      },
      {
        command: "catalog serve",
        description: "serve the generated catalog locally",
      },
    ],
  };
}
