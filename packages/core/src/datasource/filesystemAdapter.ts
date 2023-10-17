import * as fs from "fs";
import * as path from "path";

import * as mkdirp from "mkdirp";

import { ExistingState, EnvironmentKey } from "@featurevisor/types";

import { Adapter, EntityType } from "./adapter";
import { ProjectConfig } from "../config";
import { CustomParser } from "./parsers";

export function getExistingStateFilePath(
  projectConfig: ProjectConfig,
  environment: EnvironmentKey,
): string {
  return path.join(projectConfig.stateDirectoryPath, `existing-state-${environment}.json`);
}

export class FilesystemAdapter extends Adapter {
  private parser: CustomParser;

  constructor(private config: ProjectConfig) {
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

  async readEntity(entityType: EntityType, entityKey: string): Promise<string> {
    const filePath = this.getEntityPath(entityType, entityKey);

    return fs.readFileSync(filePath, "utf8");
  }

  async parseEntity<T>(entityType: EntityType, entityKey: string): Promise<T> {
    const entityContent = await this.readEntity(entityType, entityKey);

    return this.parser.parse<T>(entityContent);
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
}
