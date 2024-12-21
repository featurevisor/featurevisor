import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

import * as mkdirp from "mkdirp";

import {
  ExistingState,
  EnvironmentKey,
  DatafileContent,
  EntityType,
  HistoryEntry,
  Commit,
  CommitHash,
  HistoryEntity,
} from "@featurevisor/types";

import { Adapter, DatafileOptions } from "./adapter";
import { ProjectConfig, CustomParser } from "../config";
import { getCommit } from "../utils/git";

const commitRegex = /^commit (\w+)\nAuthor: (.+) <(.+)>\nDate:   (.+)\n\n(.+)/gm;

export function getExistingStateFilePath(
  projectConfig: ProjectConfig,
  environment: EnvironmentKey,
): string {
  return path.join(projectConfig.stateDirectoryPath, `existing-state-${environment}.json`);
}

export function getRevisionFilePath(projectConfig: ProjectConfig): string {
  return path.join(projectConfig.stateDirectoryPath, `REVISION`);
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
    } else if (entityType === "test") {
      return this.config.testsDirectoryPath;
    }

    return this.config.attributesDirectoryPath;
  }

  getEntityPath(entityType: EntityType, entityKey: string): string {
    const basePath = this.getEntityDirectoryPath(entityType);

    return path.join(basePath, `${entityKey}.${this.parser.extension}`);
  }

  async listEntities(entityType: EntityType): Promise<string[]> {
    const directoryPath = this.getEntityDirectoryPath(entityType);

    if (!fs.existsSync(directoryPath)) {
      return [];
    }

    return fs
      .readdirSync(directoryPath)
      .filter((fileName) => fileName.endsWith(`.${this.parser.extension}`))
      .map((fileName) => fileName.replace(`.${this.parser.extension}`, ""));
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

    if (!fs.existsSync(this.getEntityDirectoryPath(entityType))) {
      mkdirp.sync(this.getEntityDirectoryPath(entityType));
    }

    fs.writeFileSync(filePath, this.parser.stringify(entity));

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
      mkdirp.sync(this.config.stateDirectoryPath);
    }
    fs.writeFileSync(
      filePath,
      this.config.prettyState
        ? JSON.stringify(existingState, null, 2)
        : JSON.stringify(existingState),
    );

    fs.writeFileSync(filePath, JSON.stringify(existingState, null, 2));
  }

  /**
   * Revision
   */
  async readRevision(): Promise<string> {
    const filePath = getRevisionFilePath(this.config);

    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8");
    }

    // maintain backwards compatibility
    try {
      const pkg = require(path.join(this.rootDirectoryPath as string, "package.json"));
      const pkgVersion = pkg.version;

      if (pkgVersion) {
        return pkgVersion;
      }

      return "0";
    } catch (e) {
      return "0";
    }
  }

  async writeRevision(revision: string): Promise<void> {
    const filePath = getRevisionFilePath(this.config);

    if (!fs.existsSync(this.config.stateDirectoryPath)) {
      mkdirp.sync(this.config.stateDirectoryPath);
    }

    fs.writeFileSync(filePath, revision);
  }

  /**
   * Datafile
   */
  getDatafilePath(options: DatafileOptions): string {
    let fileName = `datafile-tag-${options.tag}`;

    if (options.scope) {
      fileName = `datafile-scope-${options.scope.name}`;
    }

    fileName += ".json";

    return path.join(this.config.outputDirectoryPath, options.environment, fileName);
  }

  async readDatafile(options: DatafileOptions): Promise<DatafileContent> {
    const filePath = this.getDatafilePath(options);
    const content = fs.readFileSync(filePath, "utf8");
    const datafileContent = JSON.parse(content);

    return datafileContent;
  }

  async writeDatafile(datafileContent: DatafileContent, options: DatafileOptions): Promise<void> {
    const outputEnvironmentDirPath = path.join(
      this.config.outputDirectoryPath,
      options.environment,
    );
    mkdirp.sync(outputEnvironmentDirPath);

    const outputFilePath = this.getDatafilePath(options);

    fs.writeFileSync(
      outputFilePath,
      this.config.prettyDatafile
        ? JSON.stringify(datafileContent, null, 2)
        : JSON.stringify(datafileContent),
    );

    const root = path.resolve(this.config.outputDirectoryPath, "..");

    const shortPath = outputFilePath.replace(root + path.sep, "");
    console.log(`     Datafile generated: ${shortPath}`);
  }

  /**
   * History
   */
  getRawHistory(pathPatterns: string[]) {
    const gitPaths = pathPatterns.join(" ");

    const logCommand = `git log --name-only --pretty=format:"%h|%an|%aI" --relative --no-merges -- ${gitPaths}`;
    const fullCommand = `(cd ${this.rootDirectoryPath} && ${logCommand})`;

    return execSync(fullCommand, { encoding: "utf8" }).toString();
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
      } else if (entityType === "test") {
        pathPatterns = [this.config.testsDirectoryPath];
      }
    } else {
      pathPatterns = [
        this.config.featuresDirectoryPath,
        this.config.attributesDirectoryPath,
        this.config.segmentsDirectoryPath,
        this.config.groupsDirectoryPath,
        this.config.testsDirectoryPath,
      ];
    }

    return pathPatterns.map((p) => p.replace((this.rootDirectoryPath as string) + path.sep, ""));
  }

  async listHistoryEntries(entityType?: EntityType, entityKey?: string): Promise<HistoryEntry[]> {
    const pathPatterns = this.getPathPatterns(entityType, entityKey);
    const rawHistory = this.getRawHistory(pathPatterns);

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

        const key = fileName.replace("." + this.parser.extension, "");

        let type: EntityType = "attribute";
        if (relativeDir === this.config.attributesDirectoryPath) {
          type = "attribute";
        } else if (relativeDir === this.config.segmentsDirectoryPath) {
          type = "segment";
        } else if (relativeDir === this.config.featuresDirectoryPath) {
          type = "feature";
        } else if (relativeDir === this.config.groupsDirectoryPath) {
          type = "group";
        } else if (relativeDir === this.config.testsDirectoryPath) {
          type = "test";
        } else {
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
