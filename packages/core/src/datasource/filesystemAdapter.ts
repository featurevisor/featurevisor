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
  ParsedFeature,
  Expose,
  Force,
  Rule,
} from "@featurevisor/types";

import { Adapter, DatafileOptions } from "./adapter";
import { ProjectConfig } from "../config";
import { CustomParser } from "../parsers";
import { getCommit } from "../utils/git";

const FEATURE_ENVIRONMENT_ALLOWED_KEYS = ["rules", "force", "expose"];

class FeatureSplitConfigError extends Error {
  featurevisorFilePath: string;

  constructor(filePath: string, message: string) {
    super(message);
    this.featurevisorFilePath = filePath;
    this.name = "FeatureSplitConfigError";
  }
}

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

export function getAllEntityFilePathsRecursively(directoryPath, extension) {
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
    } else if (file.endsWith(`.${extension}`)) {
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
    } else if (entityType === "test") {
      return this.config.testsDirectoryPath;
    }

    return this.config.attributesDirectoryPath;
  }

  getEntityPath(entityType: EntityType, entityKey: string): string {
    const basePath = this.getEntityDirectoryPath(entityType);

    // taking care of windows paths
    const relativeEntityPath = entityKey.replace(/\//g, path.sep);

    return path.join(basePath, `${relativeEntityPath}.${this.parser.extension}`);
  }

  getFeatureEnvironmentPath(featureKey: string, environment: string): string {
    const relativeEntityPath = featureKey.replace(/\//g, path.sep);

    return path.join(
      this.config.environmentsDirectoryPath,
      environment,
      `${relativeEntityPath}.${this.parser.extension}`,
    );
  }

  private assertSplitByEnvironmentIsValidFeatureBase(
    baseFeature: ParsedFeature,
    featurePath: string,
  ) {
    if (
      typeof baseFeature.rules !== "undefined" ||
      typeof baseFeature.force !== "undefined" ||
      typeof baseFeature.expose !== "undefined"
    ) {
      throw new FeatureSplitConfigError(
        featurePath,
        `Feature "${baseFeature.key}" base file must not define rules, force, or expose when splitByEnvironment=true`,
      );
    }
  }

  private readFeatureEnvironmentEntity(featureKey: string, environment: string) {
    const featureEnvironmentPath = this.getFeatureEnvironmentPath(featureKey, environment);

    if (!fs.existsSync(featureEnvironmentPath)) {
      throw new FeatureSplitConfigError(
        featureEnvironmentPath,
        `Missing environment feature file: environments/${environment}/${featureKey}.${this.parser.extension}`,
      );
    }

    const content = fs.readFileSync(featureEnvironmentPath, "utf8");
    const parsed = this.parser.parse<Record<string, unknown>>(content, featureEnvironmentPath);
    const keys = Object.keys(parsed);
    const unknownKeys = keys.filter((key) => FEATURE_ENVIRONMENT_ALLOWED_KEYS.indexOf(key) === -1);

    if (unknownKeys.length > 0) {
      throw new FeatureSplitConfigError(
        featureEnvironmentPath,
        `Unknown key(s) in environment feature file: ${unknownKeys.join(", ")}`,
      );
    }

    return parsed;
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

        // take care of windows paths
        .map((filterPath) => filterPath.replace(/\\/g, "/"))
    );
  }

  async entityExists(entityType: EntityType, entityKey: string): Promise<boolean> {
    const entityPath = this.getEntityPath(entityType, entityKey);

    return fs.existsSync(entityPath);
  }

  async readEntity<T>(entityType: EntityType, entityKey: string): Promise<T> {
    if (entityType === "feature" && this.config.splitByEnvironment) {
      const featurePath = this.getEntityPath(entityType, entityKey);
      const featureContent = fs.readFileSync(featurePath, "utf8");
      const baseFeature = this.parser.parse<ParsedFeature>(featureContent, featurePath);

      this.assertSplitByEnvironmentIsValidFeatureBase(baseFeature, featurePath);

      if (!Array.isArray(this.config.environments)) {
        throw new FeatureSplitConfigError(
          featurePath,
          "splitByEnvironment=true requires environments to be configured as an array",
        );
      }

      const rulesByEnvironment: Record<string, Rule[]> = {};
      const forceByEnvironment: Record<string, Force[]> = {};
      const exposeByEnvironment: Record<string, Expose> = {};

      for (const environment of this.config.environments) {
        const envFeature = this.readFeatureEnvironmentEntity(entityKey, environment);

        if (typeof envFeature.rules !== "undefined") {
          rulesByEnvironment[environment] = envFeature.rules as Rule[];
        }

        if (typeof envFeature.force !== "undefined") {
          forceByEnvironment[environment] = envFeature.force as Force[];
        }

        if (typeof envFeature.expose !== "undefined") {
          exposeByEnvironment[environment] = envFeature.expose as Expose;
        }
      }

      const mergedFeature: ParsedFeature = {
        ...baseFeature,
        rules: Object.keys(rulesByEnvironment).length > 0 ? rulesByEnvironment : undefined,
        force: Object.keys(forceByEnvironment).length > 0 ? forceByEnvironment : undefined,
        expose: Object.keys(exposeByEnvironment).length > 0 ? exposeByEnvironment : undefined,
      };

      return mergedFeature as T;
    }

    const filePath = this.getEntityPath(entityType, entityKey);
    const entityContent = fs.readFileSync(filePath, "utf8");

    return this.parser.parse<T>(entityContent, filePath);
  }

  async writeEntity<T>(entityType: EntityType, entityKey: string, entity: T): Promise<T> {
    const filePath = this.getEntityPath(entityType, entityKey);

    if (!fs.existsSync(this.getEntityDirectoryPath(entityType))) {
      fs.mkdirSync(this.getEntityDirectoryPath(entityType), { recursive: true });
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
      // eslint-disable-next-line
    } catch (e) {
      return "0";
    }
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
  getDatafilePath(options: DatafileOptions): string {
    const pattern = this.config.datafileNamePattern || "featurevisor-%s.json";

    const fileName = options.scope
      ? pattern.replace("%s", `scope-${options.scope.name}`)
      : pattern.replace("%s", `tag-${options.tag}`);

    const dir = options.datafilesDir || this.config.datafilesDirectoryPath;

    if (options.environment) {
      return path.join(dir, options.environment, fileName);
    }

    return path.join(dir, fileName);
  }

  async readDatafile(options: DatafileOptions): Promise<DatafileContent> {
    const filePath = this.getDatafilePath(options);
    const content = fs.readFileSync(filePath, "utf8");
    const datafileContent = JSON.parse(content);

    return datafileContent;
  }

  async writeDatafile(datafileContent: DatafileContent, options: DatafileOptions): Promise<void> {
    const dir = options.datafilesDir || this.config.datafilesDirectoryPath;

    const outputEnvironmentDirPath = options.environment
      ? path.join(dir, options.environment)
      : dir;
    fs.mkdirSync(outputEnvironmentDirPath, { recursive: true });

    const outputFilePath = this.getDatafilePath(options);

    fs.writeFileSync(
      outputFilePath,
      this.config.prettyDatafile
        ? JSON.stringify(datafileContent, null, 2)
        : JSON.stringify(datafileContent),
    );

    const root = path.resolve(dir, "..");

    const shortPath = outputFilePath.replace(root + path.sep, "");
    console.log(`     Datafile generated: ${shortPath}`);
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

      if (
        entityType === "feature" &&
        this.config.splitByEnvironment &&
        Array.isArray(this.config.environments)
      ) {
        for (const environment of this.config.environments) {
          pathPatterns.push(this.getFeatureEnvironmentPath(entityKey, environment));
        }
      }
    } else if (entityType) {
      if (entityType === "attribute") {
        pathPatterns = [this.config.attributesDirectoryPath];
      } else if (entityType === "segment") {
        pathPatterns = [this.config.segmentsDirectoryPath];
      } else if (entityType === "feature") {
        pathPatterns = [this.config.featuresDirectoryPath];
        if (this.config.splitByEnvironment) {
          pathPatterns.push(this.config.environmentsDirectoryPath);
        }
      } else if (entityType === "group") {
        pathPatterns = [this.config.groupsDirectoryPath];
      } else if (entityType === "schema") {
        pathPatterns = [this.config.schemasDirectoryPath];
      } else if (entityType === "test") {
        pathPatterns = [this.config.testsDirectoryPath];
      }
    } else {
      pathPatterns = [
        this.config.featuresDirectoryPath,
        ...(this.config.splitByEnvironment ? [this.config.environmentsDirectoryPath] : []),
        this.config.attributesDirectoryPath,
        this.config.segmentsDirectoryPath,
        this.config.groupsDirectoryPath,
        this.config.schemasDirectoryPath,
        this.config.testsDirectoryPath,
      ];
    }

    return pathPatterns.map((p) => p.replace((this.rootDirectoryPath as string) + path.sep, ""));
  }

  async getFeatureSourcePaths(featureKey: string) {
    const baseFilePath = this.getEntityPath("feature", featureKey);
    const environmentFilePaths: Record<string, string> = {};

    if (this.config.splitByEnvironment && Array.isArray(this.config.environments)) {
      for (const environment of this.config.environments) {
        environmentFilePaths[environment] = this.getFeatureEnvironmentPath(featureKey, environment);
      }
    }

    return {
      baseFilePath,
      environmentFilePaths,
    };
  }

  async getFeaturePropertySourcePath(
    featureKey: string,
    _property: "rules" | "force" | "expose",
    environment?: string,
  ) {
    if (this.config.splitByEnvironment && environment) {
      return this.getFeatureEnvironmentPath(featureKey, environment);
    }

    return this.getEntityPath("feature", featureKey);
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
        } else if (
          this.config.splitByEnvironment &&
          isWithinDirectory(this.config.environmentsDirectoryPath, relativeDir)
        ) {
          type = "feature";
        } else if (isWithinDirectory(this.config.groupsDirectoryPath, relativeDir)) {
          type = "group";
        } else if (isWithinDirectory(this.config.schemasDirectoryPath, relativeDir)) {
          type = "schema";
        } else if (isWithinDirectory(this.config.testsDirectoryPath, relativeDir)) {
          type = "test";
        } else {
          continue;
        }

        if (type === "feature") {
          if (
            this.config.splitByEnvironment &&
            relativePath.startsWith(
              this.config.environmentsDirectoryPath.replace(
                (this.rootDirectoryPath as string) + path.sep,
                "",
              ) + path.sep,
            )
          ) {
            const featureRelativePath = relativePath
              .replace(
                this.config.environmentsDirectoryPath.replace(
                  (this.rootDirectoryPath as string) + path.sep,
                  "",
                ) + path.sep,
                "",
              )
              .split(path.sep)
              .slice(1)
              .join(path.sep)
              .replace(extensionWithDot, "");

            entities.push({
              type,
              key: featureRelativePath.replace(/\\/g, "/"),
            });

            continue;
          }

          const baseRelativePath = absolutePath
            .replace(this.config.featuresDirectoryPath + path.sep, "")
            .replace(extensionWithDot, "")
            .replace(/\\/g, "/");

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
