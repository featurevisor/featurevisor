import * as path from "path";
import * as fs from "fs";

import { Tag } from "@featurevisor/types";

import { ProjectConfig } from "../config";
import { parsers } from "./parsers";

export type EntityType = "feature" | "group" | "segment" | "attribute" | "test";

export class Datasource {
  private extension;

  constructor(private config: ProjectConfig) {
    if (typeof parsers[config.parser] !== "function") {
      throw new Error(`Invalid parser: ${config.parser}`);
    }

    this.extension = config.parser;
  }

  /**
   * Common methods
   */
  listEntities(entityType: EntityType) {
    const directoryPath = this.getDirectoryPath(entityType);

    return fs
      .readdirSync(directoryPath)
      .filter((fileName) => fileName.endsWith(`.${this.extension}`))
      .map((fileName) => fileName.replace(`.${this.extension}`, ""));
  }

  getDirectoryPath(entityType: EntityType) {
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

  getPath(entityType: EntityType, entityKey: string) {
    const basePath = this.getDirectoryPath(entityType);

    return path.join(basePath, `${entityKey}.${this.extension}`);
  }

  readEntity(entityType: EntityType, entityKey: string) {
    const filePath = this.getPath(entityType, entityKey);

    return fs.readFileSync(filePath, "utf8");
  }

  parseEntity(entityType: EntityType, entityKey: string) {
    const entityContent = this.readEntity(entityType, entityKey);
    const parser = parsers[this.extension];

    return parser(entityContent);
  }

  /**
   * Entity specific methods
   */

  // features
  listFeatures(tag?: Tag) {
    const features = this.listEntities("feature");

    if (tag) {
      return features.filter((feature) => {
        const featureContent = this.parseEntity("feature", feature);

        return featureContent.tags.indexOf(tag) !== -1;
      });
    }

    return features;
  }

  readFeature(featureKey: string) {
    return this.parseEntity("feature", featureKey);
  }

  // segments
  listSegments(segmentsList?: string[]) {
    const segments = this.listEntities("segment");

    if (segmentsList) {
      return segments.filter((segment) => {
        return segmentsList.indexOf(segment) !== -1;
      });
    }

    return segments;
  }

  readSegment(segmentKey: string) {
    return this.parseEntity("segment", segmentKey);
  }

  // attributes
  listAttributes(attributesList?: string[]) {
    const attributes = this.listEntities("attribute");

    if (attributesList) {
      return attributes.filter((segment) => {
        return attributesList.indexOf(segment) !== -1;
      });
    }

    return attributes;
  }

  readAttribute(attributeKey: string) {
    return this.parseEntity("attribute", attributeKey);
  }

  // groups
  listGroups(featuresList?: string[]) {
    const groups = this.listEntities("group");

    if (featuresList) {
      return groups.filter((group) => {
        const groupContent = this.parseEntity("group", group);

        return groupContent.slots.some((slot) => {
          return featuresList.indexOf(slot.feature) !== -1;
        });
      });
    }

    return groups;
  }

  readGroup(groupKey: string) {
    return this.parseEntity("group", groupKey);
  }

  // tests
  listTests() {
    return this.listEntities("test");
  }

  readTest(testKey: string) {
    return this.parseEntity("test", testKey);
  }
}
