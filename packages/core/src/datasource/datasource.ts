import * as path from "path";
import * as fs from "fs";

import { ParsedFeature, Segment, Attribute, Group, FeatureKey, Test } from "@featurevisor/types";

import { ProjectConfig } from "../config";
import { parsers } from "./parsers";

export type EntityType = "feature" | "group" | "segment" | "attribute" | "test";

export class Datasource {
  private extension;
  private parse;

  constructor(private config: ProjectConfig) {
    if (typeof config.parser === "string") {
      // built-in parsers
      if (typeof parsers[config.parser] !== "function") {
        throw new Error(`Invalid parser: ${config.parser}`);
      }

      this.extension = config.parser;
      this.parse = parsers[config.parser];
    } else if (typeof config.parser === "object") {
      // custom parser
      if (typeof config.parser.extension !== "string") {
        throw new Error(`Invalid parser extension: ${config.parser.extension}`);
      }

      if (typeof config.parser.parse !== "function") {
        throw new Error(`Invalid parser parse function: ${config.parser.parse}`);
      }

      this.extension = config.parser.extension;
      this.parse = config.parser.parse;
    } else {
      throw new Error(`Invalid parser: ${config.parser}`);
    }
  }

  getExtension() {
    return this.extension;
  }

  /**
   * Common methods
   */
  async listEntities(entityType: EntityType): Promise<string[]> {
    const directoryPath = this.getEntityDirectoryPath(entityType);

    return fs
      .readdirSync(directoryPath)
      .filter((fileName) => fileName.endsWith(`.${this.extension}`))
      .map((fileName) => fileName.replace(`.${this.extension}`, ""));
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

    return path.join(basePath, `${entityKey}.${this.extension}`);
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
    const entityContent = this.readEntity(entityType, entityKey);

    return this.parse(entityContent) as T;
  }

  /**
   * Entity specific methods
   */

  // features
  async listFeatures() {
    return await this.listEntities("feature");
  }

  readFeature(featureKey: string) {
    return this.parseEntity<ParsedFeature>("feature", featureKey);
  }

  async getRequiredFeaturesChain(
    featureKey: FeatureKey,
    chain = new Set<FeatureKey>(),
  ): Promise<Set<FeatureKey>> {
    chain.add(featureKey);

    if (!this.entityExists("feature", featureKey)) {
      throw new Error(`Feature not found: ${featureKey}`);
    }

    const feature = await this.readFeature(featureKey);

    if (!feature.required) {
      return chain;
    }

    for (const r of feature.required) {
      const requiredKey = typeof r === "string" ? r : r.key;

      if (chain.has(requiredKey)) {
        throw new Error(`Circular dependency detected: ${chain.toString()}`);
      }

      await this.getRequiredFeaturesChain(requiredKey, chain);
    }

    return chain;
  }

  // segments
  listSegments() {
    return this.listEntities("segment");
  }

  readSegment(segmentKey: string) {
    return this.parseEntity<Segment>("segment", segmentKey);
  }

  // attributes
  listAttributes() {
    return this.listEntities("attribute");
  }

  readAttribute(attributeKey: string) {
    return this.parseEntity<Attribute>("attribute", attributeKey);
  }

  // groups
  async listGroups() {
    return this.listEntities("group");
  }

  readGroup(groupKey: string) {
    return this.parseEntity<Group>("group", groupKey);
  }

  // tests
  listTests() {
    return this.listEntities("test");
  }

  readTest(testKey: string) {
    return this.parseEntity<Test>("test", testKey);
  }
}
