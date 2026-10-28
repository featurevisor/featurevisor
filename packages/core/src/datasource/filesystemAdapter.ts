import * as fs from "fs";
import * as path from "path";
import { execFileSync, spawn } from "child_process";
import { gzipSync } from "zlib";

import type {
  ExistingState,
  EnvironmentKey,
  DatafileContent,
  EntityType,
  HistoryEntry,
  Commit,
  CommitHash,
} from "@featurevisor/types";
import { parsers, type CustomParser } from "@featurevisor/parsers";

import { Adapter, DatafileFile, DatafileOptions } from "./adapter";
import { ProjectConfig } from "../config";
import { getCommit, getHistoryEntity } from "../utils/git";
import { isScenarioSpec, testSpecKeyFromStorageKey } from "./testSpecs";
import { EntityParseError } from "./parseError";
import { formatWrittenDefinition } from "../formatter/formatDefinition";
import { orderValue } from "../formatter/layout";
import {
  AttributeNamespaceError,
  assertFlatAttributeKeys,
  isFlatAttributeKey,
} from "./attributeNamespaces";
import { CLI_COLOR_CYAN, CLI_COLOR_GREEN, colorize } from "../tester/cliFormat";

export function getExistingStateFilePath(
  projectConfig: ProjectConfig,
  environment: EnvironmentKey | false,
): string {
  const fileName = environment ? `existing-state-${environment}.json` : `existing-state.json`;

  return path.join(projectConfig.stateDirectoryPath, fileName);
}

export function getRevisionFilePath(projectConfig: ProjectConfig): string {
  return path.join(projectConfig.stateDirectoryPath, projectConfig.revisionFileName);
}

export function getAllEntityFilePathsRecursively(directoryPath, extension?: string) {
  let entities: string[] = [];

  if (!fs.existsSync(directoryPath)) {
    return entities;
  }

  const files = fs.readdirSync(directoryPath);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(directoryPath, file);

    if (fs.statSync(filePath).isDirectory()) {
      entities = entities.concat(getAllEntityFilePathsRecursively(filePath, extension));
    } else if (!extension || file.endsWith(`.${extension}`)) {
      entities.push(filePath);
    }
  }

  return entities;
}

function getPathSegmentsFromKey(
  namespaceCharacter: string,
  key: string,
  entityType?: EntityType,
): string[] {
  const pathSegments = namespaceCharacter ? key.split(namespaceCharacter) : [key];

  if (
    (entityType === "test" || entityType === "scenario") &&
    pathSegments.length > 1 &&
    ["spec", "feature", "segment"].includes(pathSegments[pathSegments.length - 1])
  ) {
    const suffix = pathSegments[pathSegments.length - 1];
    pathSegments[pathSegments.length - 2] = `${pathSegments[pathSegments.length - 2]}.${suffix}`;
    pathSegments.pop();
  }

  return pathSegments;
}

/** Coarse filesystems record modification times in whole seconds, some in two. */
const RACY_FILE_MARGIN_MS = 2000;

function statIdentity(filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino };
  } catch {
    return undefined;
  }
}

export class FilesystemAdapter extends Adapter {
  private parser: CustomParser;
  private testSpecCache = new Map<
    string,
    {
      content: string;
      result: { value: unknown } | { error: unknown };
      stat?: { size: number; mtimeMs: number; ino: number };
      readAt: number;
    }
  >();
  private scenarioPathIndex?: Map<string, string>;
  private testPathIndex?: Map<string, string>;

  constructor(
    private config: ProjectConfig,
    private rootDirectoryPath?: string,
  ) {
    super();

    this.parser = config.parser as CustomParser;
  }

  getEntityDirectoryPath(entityType: EntityType): string {
    if (entityType === "feature") {
      return this.config.featuresDirectoryPath;
    } else if (entityType === "segment") {
      return this.config.segmentsDirectoryPath;
    } else if (entityType === "schema") {
      return this.config.schemasDirectoryPath;
    } else if (entityType === "variable") {
      return this.config.variablesDirectoryPath;
    } else if (entityType === "target") {
      return this.config.targetsDirectoryPath;
    } else if (entityType === "test" || entityType === "scenario") {
      return this.config.testsDirectoryPath;
    }

    return this.config.attributesDirectoryPath;
  }

  async listSets(): Promise<string[]> {
    if (!this.config.sets || !fs.existsSync(this.config.setsDirectoryPath)) {
      return [];
    }

    const entries = await fs.promises.readdir(this.config.setsDirectoryPath, {
      withFileTypes: true,
    });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  getEntityPath(entityType: EntityType, entityKey: string): string {
    if (entityType === "scenario") return this.getScenarioSourcePath(entityKey);
    if (entityType === "test") return this.getTestSourcePath(entityKey);
    const basePath = this.getEntityDirectoryPath(entityType);
    if (entityType === "attribute") {
      assertFlatAttributeKeys(
        [entityKey],
        basePath,
        this.config.namespaceCharacter,
        this.parser.extension,
      );
    }
    const pathSegments = getPathSegmentsFromKey(
      this.config.namespaceCharacter,
      entityKey,
      entityType,
    );
    return path.join(basePath, ...pathSegments) + `.${this.parser.extension}`;
  }

  /** Public test identities omit a terminal .spec, while source files keep their names. */
  private scenarioPaths(refresh = false): Map<string, string> {
    if (this.scenarioPathIndex && !refresh) return this.scenarioPathIndex;
    this.scenarioPathIndex = undefined;
    this.testPathIndex = undefined;
    const directory = this.config.testsDirectoryPath;
    const paths = new Map<string, string>();
    const testPaths = new Map<string, string>();
    const filePaths = getAllEntityFilePathsRecursively(directory, this.parser.extension);
    const existingPaths = new Set(filePaths);
    for (const cachedPath of this.testSpecCache.keys()) {
      if (!existingPaths.has(cachedPath)) this.testSpecCache.delete(cachedPath);
    }
    for (const filePath of filePaths) {
      let scenario = false;
      try {
        scenario = isScenarioSpec(this.readTestSpecFile(filePath, false));
      } catch {
        // An unreadable spec remains in the entity test collection for diagnostics.
      }
      const relative = path
        .relative(directory, filePath)
        .slice(0, -(this.parser.extension.length + 1));
      const parts = relative.split(path.sep);
      parts[parts.length - 1] = parts[parts.length - 1].replace(/\.spec$/, "");
      const key = parts.join(this.config.namespaceCharacter);
      const collection = scenario ? paths : testPaths;
      const previous = collection.get(key);
      if (previous) {
        throw new Error(
          `${scenario ? "Scenario" : "Test"} key collision for "${key}": ${previous} and ${filePath}. Rename one source file.`,
        );
      }
      collection.set(key, filePath);
    }
    for (const [key, scenarioPath] of paths) {
      const testPath = testPaths.get(key);
      if (testPath) {
        throw new Error(
          `Test identity collision for "${key}": ${testPath} and ${scenarioPath}. Rename one source file.`,
        );
      }
    }
    this.testPathIndex = testPaths;
    this.scenarioPathIndex = paths;
    return paths;
  }

  getTestSourcePath(key: string): string {
    const parts = this.config.namespaceCharacter
      ? key.split(this.config.namespaceCharacter)
      : [key];
    const direct =
      path.join(this.config.testsDirectoryPath, ...parts) + `.${this.parser.extension}`;
    const withSpec = path.join(
      this.config.testsDirectoryPath,
      ...parts.slice(0, -1),
      `${parts[parts.length - 1]}.spec.${this.parser.extension}`,
    );
    this.scenarioPaths();
    let existing = this.testPathIndex?.get(key);
    let stillEntity = false;
    if (existing && fs.existsSync(existing)) {
      try {
        stillEntity = !isScenarioSpec(this.readTestSpecFile(existing, false));
      } catch {
        stillEntity = true;
      }
    }
    if (
      (existing && !stillEntity) ||
      (direct !== existing && fs.existsSync(direct)) ||
      (withSpec !== existing && fs.existsSync(withSpec))
    ) {
      this.scenarioPaths(true);
      existing = this.testPathIndex?.get(key);
    }
    return existing || withSpec;
  }

  getScenarioSourcePath(key: string): string {
    const parts = this.config.namespaceCharacter
      ? key.split(this.config.namespaceCharacter)
      : [key];
    const direct =
      path.join(this.config.testsDirectoryPath, ...parts) + `.${this.parser.extension}`;
    const withSpec = path.join(
      this.config.testsDirectoryPath,
      ...parts.slice(0, -1),
      `${parts[parts.length - 1]}.spec.${this.parser.extension}`,
    );
    const isScenarioPath = (filePath: string) => {
      if (!fs.existsSync(filePath)) return false;
      try {
        return isScenarioSpec(this.readTestSpecFile(filePath, false));
      } catch {
        return false;
      }
    };
    let existing = this.scenarioPaths().get(key);
    if (existing && !isScenarioPath(existing)) existing = this.scenarioPaths(true).get(key);
    const directMatches = direct !== existing && isScenarioPath(direct);
    const specMatches = withSpec !== existing && isScenarioPath(withSpec);
    if (
      directMatches ||
      specMatches ||
      (!existing && (fs.existsSync(direct) || fs.existsSync(withSpec)))
    ) {
      existing = this.scenarioPaths(true).get(key);
    }
    return existing || withSpec;
  }

  async listEntities(entityType: EntityType): Promise<string[]> {
    if (entityType === "scenario") return Array.from(this.scenarioPaths(true).keys());
    if (entityType === "test") {
      this.scenarioPaths(true);
      return Array.from(this.testPathIndex!.keys());
    }
    const directoryPath = this.getEntityDirectoryPath(entityType);
    const filePaths = getAllEntityFilePathsRecursively(directoryPath, this.parser.extension);
    if (entityType === "attribute") {
      const keyForPath = (filePath: string) =>
        path
          .relative(directoryPath, filePath)
          .slice(0, -(this.parser.extension.length + 1))
          .split(path.sep)
          .join(this.config.namespaceCharacter);
      const isNested = (filePath: string) =>
        path.dirname(path.relative(directoryPath, filePath)) !== ".";
      const invalidFiles = filePaths.filter(
        (filePath) =>
          isNested(filePath) ||
          !isFlatAttributeKey(keyForPath(filePath), this.config.namespaceCharacter),
      );
      if (invalidFiles.length) {
        const invalidPaths = new Set(invalidFiles);
        throw new AttributeNamespaceError(
          invalidFiles.map((filePath) => ({ key: keyForPath(filePath), filePath })),
          filePaths.filter((filePath) => !invalidPaths.has(filePath)).map(keyForPath),
        );
      }
    }
    return filePaths
      .map((filePath) => path.relative(directoryPath, filePath))
      .map((filePath) => filePath.slice(0, -(this.parser.extension.length + 1)))
      .map((filePath) => filePath.split(path.sep).join(this.config.namespaceCharacter));
  }

  /**
   * Path, size, modification time and inode. An editor's atomic save changes the inode even
   * when size and time match. Only built in parsers qualify: a custom parser may read other
   * files, so its output is not tied to this file alone.
   */
  async getEntityFingerprint(entityType: EntityType, entityKey: string) {
    if (!Object.values(parsers).includes(this.parser as (typeof parsers)[keyof typeof parsers]))
      return undefined;
    try {
      const filePath = this.getEntityPath(entityType, entityKey);
      const stat = await fs.promises.stat(filePath);
      return `${filePath}\0${stat.size}:${stat.mtimeMs}:${stat.ino}`;
    } catch {
      return undefined;
    }
  }

  private readTestSpecFile<T>(filePath: string, clone = true): T {
    let cached = this.testSpecCache.get(filePath);
    const stat = statIdentity(filePath);
    // Listing and reading specs repeatedly, as watch mode does, skips unchanged files. A file
    // modified shortly before it was read may have changed within the same timestamp, so
    // its contents are compared instead, as Git does for racily clean files.
    const unchanged =
      cached?.stat &&
      stat &&
      cached.stat.size === stat.size &&
      cached.stat.mtimeMs === stat.mtimeMs &&
      cached.stat.ino === stat.ino &&
      stat.mtimeMs < cached.readAt - RACY_FILE_MARGIN_MS;
    if (!cached || !unchanged) {
      const readAt = Date.now();
      const content = fs.readFileSync(filePath, "utf8");
      if (!cached || cached.content !== content) {
        try {
          cached = {
            content,
            result: { value: this.parseEntityContent(content, filePath) },
            stat,
            readAt,
          };
        } catch (error) {
          cached = { content, result: { error }, stat, readAt };
        }
      } else {
        cached = { ...cached, stat, readAt };
      }
      this.testSpecCache.set(filePath, cached);
    }
    if ("error" in cached.result) throw cached.result.error;
    // Consumers can expand or normalize a spec without mutating the cached authoring value.
    return (clone ? structuredClone(cached.result.value) : cached.result.value) as T;
  }

  async entityExists(entityType: EntityType, entityKey: string): Promise<boolean> {
    const entityPath = this.getEntityPath(entityType, entityKey);

    return fs.existsSync(entityPath);
  }

  async readEntity<T>(entityType: EntityType, entityKey: string): Promise<T> {
    const filePath = this.getEntityPath(entityType, entityKey);
    if (entityType === "test" || entityType === "scenario") {
      return this.readTestSpecFile<T>(filePath);
    }
    const entityContent = fs.readFileSync(filePath, "utf8");

    return this.parseEntityContent<T>(entityContent, filePath);
  }

  private parseEntityContent<T>(content: string, filePath: string): T {
    try {
      return this.parser.parse<T>(content, filePath);
    } catch (error) {
      throw new EntityParseError(filePath, error, this.rootDirectoryPath);
    }
  }

  async writeEntity<T>(entityType: EntityType, entityKey: string, entity: T): Promise<T> {
    const filePath = this.getEntityPath(entityType, entityKey);
    if (entityType === "scenario" || entityType === "test") {
      this.scenarioPaths(true);
      const oppositePath =
        entityType === "scenario"
          ? this.testPathIndex?.get(entityKey)
          : this.scenarioPathIndex?.get(entityKey);
      if (oppositePath && oppositePath !== filePath) {
        throw new Error(
          `Test identity collision for "${entityKey}": another spec already uses this key.`,
        );
      }
    }

    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    // Written in the same layout and key order as featurevisor fmt, so a written file is
    // already formatted and its diff shows only what changed.
    const text = this.parser.stringify(orderValue(entityType, entity), filePath);
    fs.writeFileSync(filePath, formatWrittenDefinition(entityType, text, this.parser));
    this.testSpecCache.delete(filePath);
    if (entityType === "test" || entityType === "scenario") {
      this.scenarioPathIndex = undefined;
      this.testPathIndex = undefined;
    }

    return entity;
  }

  async deleteEntity(entityType: EntityType, entityKey: string): Promise<void> {
    const filePath = this.getEntityPath(entityType, entityKey);

    if (!fs.existsSync(filePath)) {
      return;
    }

    fs.unlinkSync(filePath);
    this.testSpecCache.delete(filePath);
    if (entityType === "test" || entityType === "scenario") {
      this.scenarioPathIndex = undefined;
      this.testPathIndex = undefined;
    }
  }

  /**
   * State
   */
  async readState(environment: EnvironmentKey): Promise<ExistingState> {
    const filePath = getExistingStateFilePath(this.config, environment);

    if (!fs.existsSync(filePath)) {
      return {
        features: {},
      };
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  async writeState(environment: EnvironmentKey, existingState: ExistingState) {
    const filePath = getExistingStateFilePath(this.config, environment);

    if (!fs.existsSync(this.config.stateDirectoryPath)) {
      fs.mkdirSync(this.config.stateDirectoryPath, { recursive: true });
    }
    fs.writeFileSync(
      filePath,
      this.config.prettyState
        ? JSON.stringify(existingState, null, 2)
        : JSON.stringify(existingState),
    );
  }

  /**
   * Revision
   */
  async readRevision(): Promise<string> {
    const filePath = getRevisionFilePath(this.config);

    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8");
    }

    return "0";
  }

  async writeRevision(revision: string, datafilesDir?: string): Promise<void> {
    const filePath = getRevisionFilePath(this.config);
    const outputDirectory = datafilesDir || this.config.datafilesDirectoryPath;
    fs.mkdirSync(outputDirectory, { recursive: true });

    // write to state directory
    if (!fs.existsSync(this.config.stateDirectoryPath)) {
      fs.mkdirSync(this.config.stateDirectoryPath, { recursive: true });
    }

    fs.writeFileSync(filePath, revision);

    // write to datafiles directory, as part of the build process
    fs.writeFileSync(path.join(outputDirectory, this.config.revisionFileName), revision);
  }

  /**
   * Datafile
   */
  async listDatafiles(): Promise<DatafileFile[]> {
    const directoryPath = this.config.datafilesDirectoryPath;

    return getAllEntityFilePathsRecursively(directoryPath)
      .filter((filePath) => path.basename(filePath) !== this.config.revisionFileName)
      .filter((filePath) => !path.basename(filePath).startsWith("."))
      .map((filePath) => {
        const content = fs.readFileSync(filePath);

        return {
          path: path.relative(directoryPath, filePath).split(path.sep).join("/"),
          size: content.length,
          gzipSize: gzipSync(content).length,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getDatafilePath(options: DatafileOptions): string {
    const pattern = this.config.datafileNamePattern || "featurevisor-%s.json";

    if (!options.target) {
      throw new Error("Datafile target is required.");
    }

    const targetPathSegments = options.target.split(this.config.namespaceCharacter);
    const targetFileKey = targetPathSegments.pop() || options.target;
    const fileName = pattern.replace("%s", targetFileKey);
    const targetDirectory = targetPathSegments.length > 0 ? path.join(...targetPathSegments) : "";

    const dir = options.datafilesDir || this.config.datafilesDirectoryPath;

    if (options.environment) {
      return path.join(dir, options.environment, targetDirectory, fileName);
    }

    return path.join(dir, targetDirectory, fileName);
  }

  async readDatafile(options: DatafileOptions): Promise<DatafileContent> {
    const filePath = this.getDatafilePath(options);
    const content = fs.readFileSync(filePath, "utf8");
    const datafileContent = JSON.parse(content);

    return datafileContent;
  }

  async writeDatafile(datafileContent: DatafileContent, options: DatafileOptions): Promise<void> {
    const dir = options.datafilesDir || this.config.datafilesDirectoryPath;

    const outputFilePath = this.getDatafilePath(options);
    fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });

    fs.writeFileSync(
      outputFilePath,
      this.config.prettyDatafile
        ? JSON.stringify(datafileContent, null, 2)
        : JSON.stringify(datafileContent),
    );

    const root = path.resolve(dir, "..");

    const shortPath = outputFilePath.replace(root + path.sep, "");
    console.log(`    ${colorize("✔", CLI_COLOR_GREEN)} ${colorize(shortPath, CLI_COLOR_CYAN)}`);
  }

  /**
   * History
   */
  async getRawHistory(pathPatterns: string[]): Promise<string> {
    const rootDirectoryPath = this.rootDirectoryPath;

    return new Promise(function (resolve, reject) {
      const child = spawn(
        "git",
        [
          "-c",
          "core.quotepath=false",
          "log",
          "--name-only",
          "--no-renames",
          "--pretty=format:%h|%an|%aI",
          "--relative",
          "--no-merges",
          "--",
          ...pathPatterns,
        ],
        { cwd: rootDirectoryPath },
      );
      let result = "";

      child.stdout.on("data", function (data) {
        result += data.toString();
      });

      child.stderr.on("data", function (data) {
        console.error(data.toString());
      });

      child.on("error", reject);

      child.on("close", function (code) {
        if (code === 0) {
          resolve(result);
        } else {
          reject(code);
        }
      });
    });
  }

  getPathPatterns(entityType?: EntityType, entityKey?: string): string[] {
    let pathPatterns: string[] = [];

    if (entityType && entityKey) {
      pathPatterns = [this.getEntityPath(entityType, entityKey)];
    } else if (entityType) {
      if (entityType === "attribute") {
        pathPatterns = [this.config.attributesDirectoryPath];
      } else if (entityType === "segment") {
        pathPatterns = [this.config.segmentsDirectoryPath];
      } else if (entityType === "feature") {
        pathPatterns = [this.config.featuresDirectoryPath];
      } else if (entityType === "schema") {
        pathPatterns = [this.config.schemasDirectoryPath];
      } else if (entityType === "variable") {
        pathPatterns = [this.config.variablesDirectoryPath];
      } else if (entityType === "target") {
        pathPatterns = [this.config.targetsDirectoryPath];
      } else if (entityType === "test" || entityType === "scenario") {
        pathPatterns = [this.config.testsDirectoryPath];
      }
    } else {
      pathPatterns = [
        this.config.featuresDirectoryPath,
        this.config.attributesDirectoryPath,
        this.config.segmentsDirectoryPath,
        this.config.schemasDirectoryPath,
        this.config.variablesDirectoryPath,
        this.config.targetsDirectoryPath,
        this.config.testsDirectoryPath,
      ];
    }

    return pathPatterns.map((p) => p.replace((this.rootDirectoryPath as string) + path.sep, ""));
  }

  async listHistoryEntries(entityType?: EntityType, entityKey?: string): Promise<HistoryEntry[]> {
    const pathPatterns = this.getPathPatterns(entityType, entityKey);
    const fullHistory: HistoryEntry[] = [];
    // Test specs are classified after the log ends, in one batch, rather than with two
    // `git show` processes per changed spec. Their entity slot is held by a placeholder.
    const pendingTests = new Map<
      HistoryEntry["entities"][number],
      { commit: string; relativePath: string; key: string }
    >();
    let entry: HistoryEntry | undefined;
    let field = 0;
    let firstPath = false;
    const finishEntry = () => {
      if (entry && entry.entities.length > 0) fullHistory.push(entry);
      entry = undefined;
      field = 0;
    };
    const consume = (token: string) => {
      if (field === 0) {
        if (!token) return;
        entry = { commit: token, author: "", timestamp: "", subject: "", entities: [] };
        field++;
      } else if (field === 1) {
        entry!.author = token;
        field++;
      } else if (field === 2) {
        entry!.timestamp = token;
        field++;
      } else if (field === 3) {
        entry!.subject = token;
        field++;
        firstPath = true;
      } else {
        // Git inserts one newline between the header and the first raw filename.
        const relativePath = firstPath && token.startsWith("\n") ? token.slice(1) : token;
        firstPath = false;
        if (!relativePath) {
          finishEntry();
          return;
        }
        const entity = getHistoryEntity(
          relativePath,
          {
            rootDirectoryPath: this.rootDirectoryPath as string,
            projectConfig: this.config,
          },
          this.config.namespaceCharacter,
        );
        if (!entity) return;

        if (entity.type === "test") {
          const placeholder = { type: entity.type, key: testSpecKeyFromStorageKey(entity.key) };
          pendingTests.set(placeholder, {
            commit: entry!.commit,
            relativePath,
            key: placeholder.key,
          });
          entry!.entities.push(placeholder);
          return;
        }
        if (!entityType || entity.type === entityType)
          entry!.entities.push({
            type: entity.type,
            key: testSpecKeyFromStorageKey(entity.key),
          });
      }
    };

    return new Promise((resolve, reject) => {
      const child = spawn(
        "git",
        [
          "log",
          "--name-only",
          "--no-renames",
          "-z",
          "--encoding=UTF-8",
          "--pretty=format:%x00%h%x00%an%x00%aI%x00%s%x00",
          "--relative",
          "--no-merges",
          "--",
          ...pathPatterns,
        ],
        { cwd: this.rootDirectoryPath, env: { ...process.env, LC_ALL: "C" } },
      );
      // Retain only the unfinished token, not the full log or a commit's file list.
      let fragments: string[] = [];
      let diagnostic = "";
      let failed = false;
      const fail = (error: unknown) => {
        if (failed) return;
        failed = true;
        child.kill();
        reject(error);
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (failed) return;
        try {
          let start = 0;
          let end: number;
          while ((end = chunk.indexOf("\0", start)) !== -1) {
            const part = chunk.slice(start, end);
            consume(fragments.length ? fragments.join("") + part : part);
            fragments = [];
            start = end + 1;
          }
          if (start < chunk.length) fragments.push(chunk.slice(start));
        } catch (error) {
          fail(error);
        }
      });
      child.stderr.on("data", (data) => {
        diagnostic += data.toString();
        // Bound diagnostics too; oversized messages must never qualify as empty history.
        if (diagnostic.length > 8192) {
          console.error(diagnostic);
          diagnostic = "Git diagnostics exceeded the history limit";
        }
      });
      child.stdout.on("error", fail);
      child.stderr.on("error", fail);
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" && fs.existsSync(this.rootDirectoryPath || ".")) {
          failed = true;
          resolve([]);
        } else fail(error);
      });
      child.on("close", (code) => {
        if (failed) return;
        if (code !== 0) {
          if (
            code === 128 &&
            (/^fatal: not a git repository \(or any of the parent directories\): \.git\s*$/.test(
              diagnostic,
            ) ||
              /^fatal: your current branch '[^'\n]+' does not have any commits yet\s*$/.test(
                diagnostic,
              ))
          ) {
            resolve([]);
            return;
          }
          if (diagnostic) console.error(diagnostic);
          reject(code);
          return;
        }
        if (diagnostic) console.error(diagnostic);
        try {
          if (fragments.length) consume(fragments.join(""));
          finishEntry();
        } catch (error) {
          fail(error);
          return;
        }
        this.resolveHistoricalTests(fullHistory, pendingTests, entityType).then(resolve, reject);
      });
    });
  }

  /**
   * Replace test placeholders with "test" and/or "scenario" entities. Both kinds are included
   * when a spec changes ownership, and the parent revision covers deletions.
   */
  private async resolveHistoricalTests(
    history: HistoryEntry[],
    pending: Map<HistoryEntry["entities"][number], { commit: string; relativePath: string }>,
    entityType?: EntityType,
  ): Promise<HistoryEntry[]> {
    if (pending.size === 0) return history;

    const requests: Array<{ revision: string; relativePath: string }> = [];
    for (const { commit, relativePath } of pending.values()) {
      requests.push({ revision: commit, relativePath }, { revision: `${commit}^`, relativePath });
    }
    const kinds = await this.classifyHistoricalTestSpecs(requests);

    const resolved: HistoryEntry[] = [];
    for (const historyEntry of history) {
      historyEntry.entities = historyEntry.entities.flatMap((entity) => {
        const item = pending.get(entity);
        if (!item) return [entity];
        const types = new Set<EntityType>();
        for (const revision of [item.commit, `${item.commit}^`]) {
          const kind = kinds.get(`${revision}:${item.relativePath}`);
          if (kind) types.add(kind);
        }
        if (types.size === 0) types.add("test");
        return [...types]
          .filter((type) => !entityType || type === entityType)
          .map((type) => ({ type, key: entity.key }));
      });
      if (historyEntry.entities.length > 0) resolved.push(historyEntry);
    }
    return resolved;
  }

  /** Classify a historical spec the same way as before: a parse failure still counts as a test. */
  private classifyHistoricalContent(content: string, relativePath: string): "test" | "scenario" {
    try {
      const value = this.parser.parse(
        content,
        path.join(this.rootDirectoryPath as string, relativePath),
      );
      return isScenarioSpec(value) ? "scenario" : "test";
    } catch {
      return "test";
    }
  }

  private classifyHistoricalTestSpecFallback(revision: string, relativePath: string) {
    try {
      const value = this.readHistoricalTestSpec(revision, relativePath);
      if (typeof value === "undefined") return undefined;
      return isScenarioSpec(value) ? "scenario" : "test";
    } catch {
      return "test";
    }
  }

  /**
   * Read many `revision:path` specs through one `git cat-file --batch` process. Answers arrive
   * in request order. Identical blobs at the same path are classified once. Any request the
   * batch cannot answer exactly falls back to an individual `git show`.
   */
  private async classifyHistoricalTestSpecs(
    requests: Array<{ revision: string; relativePath: string }>,
  ): Promise<Map<string, "test" | "scenario" | undefined>> {
    const kinds = new Map<string, "test" | "scenario" | undefined>();
    const unique = [
      ...new Map(
        requests.map((request) => [`${request.revision}:${request.relativePath}`, request]),
      ).values(),
    ];
    // cat-file reads one object name per line, so line breaks in a path cannot be batched.
    const batchable = unique.filter((request) => !/[\r\n]/.test(request.relativePath));
    const fallback = (request: { revision: string; relativePath: string }) =>
      kinds.set(
        `${request.revision}:${request.relativePath}`,
        this.classifyHistoricalTestSpecFallback(request.revision, request.relativePath),
      );

    if (batchable.length > 0) {
      const answered = await new Promise<number>((resolve) => {
        const byBlob = new Map<string, "test" | "scenario">();
        let index = 0;
        let pendingBytes: Buffer[] = [];
        let pendingLength = 0;
        let header: { oid: string; type: string; size: number } | undefined;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve(index);
        };
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn("git", ["cat-file", "--batch"], {
            cwd: this.rootDirectoryPath,
            stdio: ["pipe", "pipe", "ignore"],
          });
        } catch {
          finish();
          return;
        }
        // Without both pipes the batch cannot run. Every request falls back to `git show`.
        if (!child.stdin || !child.stdout) {
          finish();
          return;
        }
        const stdin = child.stdin;
        const take = (length: number) => {
          const joined = pendingBytes.length === 1 ? pendingBytes[0] : Buffer.concat(pendingBytes);
          pendingBytes = length < joined.length ? [joined.subarray(length)] : [];
          pendingLength = joined.length - length;
          return joined.subarray(0, length);
        };
        child.stdout.on("data", (chunk: Buffer) => {
          pendingBytes.push(chunk);
          pendingLength += chunk.length;
          while (index < batchable.length) {
            if (!header) {
              const joined =
                pendingBytes.length === 1 ? pendingBytes[0] : Buffer.concat(pendingBytes);
              pendingBytes = [joined];
              const newline = joined.indexOf(10);
              if (newline === -1) return;
              const line = take(newline + 1)
                .subarray(0, newline)
                .toString("utf8");
              const match = /^([0-9a-f]{40,64}) (\w+) (\d+)$/.exec(line);
              if (!match) {
                // "missing" or "ambiguous": `git show` would fail for these too.
                const request = batchable[index++];
                kinds.set(`${request.revision}:${request.relativePath}`, undefined);
                continue;
              }
              header = { oid: match[1], type: match[2], size: Number(match[3]) };
            }
            if (pendingLength < header.size + 1) return;
            const content = take(header.size + 1).subarray(0, header.size);
            const request = batchable[index++];
            const id = `${request.revision}:${request.relativePath}`;
            if (header.type !== "blob") {
              fallback(request);
            } else {
              const blobKey = `${header.oid}:${request.relativePath}`;
              let kind = byBlob.get(blobKey);
              if (!kind) {
                kind = this.classifyHistoricalContent(
                  content.toString("utf8"),
                  request.relativePath,
                );
                byBlob.set(blobKey, kind);
              }
              kinds.set(id, kind);
            }
            header = undefined;
          }
        });
        child.on("error", finish);
        child.on("close", finish);
        stdin.on("error", finish);
        stdin.end(
          batchable.map((request) => `${request.revision}:./${request.relativePath}`).join("\n") +
            "\n",
        );
      });
      // Anything the batch did not answer, for example after a Git failure, is read individually.
      batchable.slice(answered).forEach(fallback);
    }

    unique.filter((request) => /[\r\n]/.test(request.relativePath)).forEach(fallback);
    return kinds;
  }

  readHistoricalTestSpec(revision: string, relativePath: string): unknown {
    let content: string;
    try {
      content = execFileSync("git", ["show", `${revision}:./${relativePath}`], {
        cwd: this.rootDirectoryPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      return undefined;
    }
    return this.parser.parse(content, path.join(this.rootDirectoryPath as string, relativePath));
  }

  async readCommit(
    commitHash: CommitHash,
    entityType?: EntityType,
    entityKey?: string,
  ): Promise<Commit> {
    const pathPatterns = this.getPathPatterns(entityType, entityKey);
    const gitShowOutput = execFileSync(
      "git",
      [
        "-c",
        "core.quotepath=false",
        "show",
        "--no-renames",
        "--relative",
        commitHash,
        "--",
        ...pathPatterns,
      ],
      { cwd: this.rootDirectoryPath, encoding: "utf8" },
    );
    const commit = getCommit(gitShowOutput, {
      rootDirectoryPath: this.rootDirectoryPath as string,
      projectConfig: this.config,
      readTestSpec: (revision, filePath) => this.readHistoricalTestSpec(revision, filePath),
    });

    if (entityType) {
      commit.entities = commit.entities.filter((entity) => entity.type === entityType);
    }

    return commit;
  }
}
