import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";

import type {
  ExistingState,
  EnvironmentKey,
  DatafileContent,
  EntityType,
  HistoryEntry,
  Commit,
  CommitHash,
  HistoryEntity,
} from "@featurevisor/types";
import type { CustomParser } from "@featurevisor/parsers";

import { Adapter, DatafileFile, DatafileOptions } from "./adapter";
import { ProjectConfig } from "../config";
import { getCommit } from "../utils/git";
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

function isWithinDirectory(directoryPath: string, fileDirectoryPath: string): boolean {
  return (
    fileDirectoryPath === directoryPath || fileDirectoryPath.startsWith(directoryPath + path.sep)
  );
}

function getPathSegmentsFromKey(
  namespaceCharacter: string,
  key: string,
  entityType?: EntityType,
): string[] {
  const pathSegments = namespaceCharacter ? key.split(namespaceCharacter) : [key];

  if (
    entityType === "test" &&
    pathSegments.length > 1 &&
    ["spec", "feature", "segment"].includes(pathSegments[pathSegments.length - 1])
  ) {
    const suffix = pathSegments[pathSegments.length - 1];
    pathSegments[pathSegments.length - 2] = `${pathSegments[pathSegments.length - 2]}.${suffix}`;
    pathSegments.pop();
  }

  return pathSegments;
}

export class FilesystemAdapter extends Adapter {
  private parser: CustomParser;

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
    } else if (entityType === "group") {
      return this.config.groupsDirectoryPath;
    } else if (entityType === "segment") {
      return this.config.segmentsDirectoryPath;
    } else if (entityType === "schema") {
      return this.config.schemasDirectoryPath;
    } else if (entityType === "target") {
      return this.config.targetsDirectoryPath;
    } else if (entityType === "test") {
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
    const basePath = this.getEntityDirectoryPath(entityType);
    const pathSegments = getPathSegmentsFromKey(
      this.config.namespaceCharacter,
      entityKey,
      entityType,
    );
    return path.join(basePath, ...pathSegments) + `.${this.parser.extension}`;
  }

  async listEntities(entityType: EntityType): Promise<string[]> {
    const directoryPath = this.getEntityDirectoryPath(entityType);
    const filePaths = getAllEntityFilePathsRecursively(directoryPath, this.parser.extension);

    return (
      filePaths
        // keep only the files with the right extension
        .filter((filterPath) => filterPath.endsWith(`.${this.parser.extension}`))

        // remove the entity directory path from beginning
        .map((filePath) => filePath.replace(directoryPath + path.sep, ""))

        // remove the extension from the end
        .map((filterPath) => filterPath.replace(`.${this.parser.extension}`, ""))

        // take care of windows paths and apply namespace character
        .map((filterPath) => filterPath.split(path.sep).join(this.config.namespaceCharacter))
    );
  }

  async entityExists(entityType: EntityType, entityKey: string): Promise<boolean> {
    const entityPath = this.getEntityPath(entityType, entityKey);

    return fs.existsSync(entityPath);
  }

  async readEntity<T>(entityType: EntityType, entityKey: string): Promise<T> {
    const filePath = this.getEntityPath(entityType, entityKey);
    const entityContent = fs.readFileSync(filePath, "utf8");

    return this.parser.parse<T>(entityContent, filePath);
  }

  async writeEntity<T>(entityType: EntityType, entityKey: string, entity: T): Promise<T> {
    const filePath = this.getEntityPath(entityType, entityKey);

    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    fs.writeFileSync(filePath, this.parser.stringify(entity, filePath));

    return entity;
  }

  async deleteEntity(entityType: EntityType, entityKey: string): Promise<void> {
    const filePath = this.getEntityPath(entityType, entityKey);

    if (!fs.existsSync(filePath)) {
      return;
    }

    fs.unlinkSync(filePath);
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

    return require(filePath);
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

  async writeRevision(revision: string): Promise<void> {
    const filePath = getRevisionFilePath(this.config);

    // write to state directory
    if (!fs.existsSync(this.config.stateDirectoryPath)) {
      fs.mkdirSync(this.config.stateDirectoryPath, { recursive: true });
    }

    fs.writeFileSync(filePath, revision);

    // write to datafiles directory, as part of the build process
    fs.writeFileSync(
      path.join(this.config.datafilesDirectoryPath, this.config.revisionFileName),
      revision,
    );
  }

  /**
   * Datafile
   */
  async listDatafiles(): Promise<DatafileFile[]> {
    const directoryPath = this.config.datafilesDirectoryPath;

    return getAllEntityFilePathsRecursively(directoryPath)
      .filter((filePath) => path.basename(filePath) !== this.config.revisionFileName)
      .filter((filePath) => !path.basename(filePath).startsWith("."))
      .map((filePath) => ({
        path: path.relative(directoryPath, filePath).split(path.sep).join("/"),
        size: fs.statSync(filePath).size,
      }))
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
    const gitPaths = pathPatterns.join(" ");

    const logCommand = `git log --name-only --pretty=format:"%h|%an|%aI" --relative --no-merges -- ${gitPaths}`;
    const fullCommand = `(cd ${this.rootDirectoryPath} && ${logCommand})`;

    return new Promise(function (resolve, reject) {
      const child = spawn(fullCommand, { shell: true });
      let result = "";

      child.stdout.on("data", function (data) {
        result += data.toString();
      });

      child.stderr.on("data", function (data) {
        console.error(data.toString());
      });

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
      } else if (entityType === "group") {
        pathPatterns = [this.config.groupsDirectoryPath];
      } else if (entityType === "schema") {
        pathPatterns = [this.config.schemasDirectoryPath];
      } else if (entityType === "target") {
        pathPatterns = [this.config.targetsDirectoryPath];
      } else if (entityType === "test") {
        pathPatterns = [this.config.testsDirectoryPath];
      }
    } else {
      pathPatterns = [
        this.config.featuresDirectoryPath,
        this.config.attributesDirectoryPath,
        this.config.segmentsDirectoryPath,
        this.config.groupsDirectoryPath,
        this.config.schemasDirectoryPath,
        this.config.targetsDirectoryPath,
        this.config.testsDirectoryPath,
      ];
    }

    return pathPatterns.map((p) => p.replace((this.rootDirectoryPath as string) + path.sep, ""));
  }

  async listHistoryEntries(entityType?: EntityType, entityKey?: string): Promise<HistoryEntry[]> {
    const pathPatterns = this.getPathPatterns(entityType, entityKey);
    const rawHistory = await this.getRawHistory(pathPatterns);

    const fullHistory: HistoryEntry[] = [];
    const blocks = rawHistory.split("\n\n");

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      if (block.length === 0) {
        continue;
      }

      const lines = block.split("\n");

      const commitLine = lines[0];
      const [commitHash, author, timestamp] = commitLine.split("|");

      const entities: HistoryEntity[] = [];

      const filePathLines = lines.slice(1);
      for (let j = 0; j < filePathLines.length; j++) {
        const relativePath = filePathLines[j];
        const absolutePath = path.join(this.rootDirectoryPath as string, relativePath);
        const fileName = absolutePath.split(path.sep).pop() as string;
        const relativeDir = path.dirname(absolutePath);
        const extensionWithDot = "." + this.parser.extension;
        const key = fileName.replace(extensionWithDot, "");

        let type: EntityType = "attribute";
        if (isWithinDirectory(this.config.attributesDirectoryPath, relativeDir)) {
          type = "attribute";
        } else if (isWithinDirectory(this.config.segmentsDirectoryPath, relativeDir)) {
          type = "segment";
        } else if (isWithinDirectory(this.config.featuresDirectoryPath, relativeDir)) {
          type = "feature";
        } else if (isWithinDirectory(this.config.groupsDirectoryPath, relativeDir)) {
          type = "group";
        } else if (isWithinDirectory(this.config.schemasDirectoryPath, relativeDir)) {
          type = "schema";
        } else if (isWithinDirectory(this.config.targetsDirectoryPath, relativeDir)) {
          type = "target";
        } else if (isWithinDirectory(this.config.testsDirectoryPath, relativeDir)) {
          type = "test";
        } else {
          continue;
        }

        if (type === "feature" || type === "target") {
          const entityDirectoryPath =
            type === "feature"
              ? this.config.featuresDirectoryPath
              : this.config.targetsDirectoryPath;
          const baseRelativePath = absolutePath
            .replace(entityDirectoryPath + path.sep, "")
            .replace(extensionWithDot, "")
            .split(path.sep)
            .join(this.config.namespaceCharacter);

          entities.push({
            type,
            key: baseRelativePath,
          });

          continue;
        }

        entities.push({
          type,
          key,
        });
      }

      if (entities.length === 0) {
        continue;
      }

      fullHistory.push({
        commit: commitHash,
        author,
        timestamp,
        entities,
      });
    }

    return fullHistory;
  }

  async readCommit(
    commitHash: CommitHash,
    entityType?: EntityType,
    entityKey?: string,
  ): Promise<Commit> {
    const pathPatterns = this.getPathPatterns(entityType, entityKey);
    const gitPaths = pathPatterns.join(" ");
    const logCommand = `git show ${commitHash} --relative -- ${gitPaths}`;
    const fullCommand = `(cd ${this.rootDirectoryPath} && ${logCommand})`;

    const gitShowOutput = execSync(fullCommand, { encoding: "utf8" }).toString();
    const commit = getCommit(gitShowOutput, {
      rootDirectoryPath: this.rootDirectoryPath as string,
      projectConfig: this.config,
    });

    return commit;
  }
}
