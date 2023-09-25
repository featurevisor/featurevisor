import * as path from "path";
import * as fs from "fs";

import { Tag, ParsedFeature, Segment, Attribute, Group, Spec } from "@featurevisor/types";

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
  listEntities(entityType: EntityType): string[] {
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

  entityExists(entityType: EntityType, entityKey: string): boolean {
    const entityPath = this.getEntityPath(entityType, entityKey);

    return fs.existsSync(entityPath);
  }

  readEntity(entityType: EntityType, entityKey: string): string {
    const filePath = this.getEntityPath(entityType, entityKey);

    return fs.readFileSync(filePath, "utf8");
  }

  parseEntity<T>(entityType: EntityType, entityKey: string): T {
    const entityContent = this.readEntity(entityType, entityKey);

    return this.parse(entityContent) as T;
  }

  /**
   * Entity specific methods
   */

  // features
  listFeatures(tag?: Tag) {
    const features = this.listEntities("feature");

    if (tag) {
      return features.filter((feature) => {
        const featureContent = this.parseEntity<ParsedFeature>("feature", feature);

        return featureContent.tags.indexOf(tag) !== -1;
      });
    }

    return features;
  }

  readFeature(featureKey: string) {
    return this.parseEntity<ParsedFeature>("feature", featureKey);
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
    return this.parseEntity<Segment>("segment", segmentKey);
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
    return this.parseEntity<Attribute>("attribute", attributeKey);
  }

  // groups
  listGroups(featuresList?: string[]) {
    const groups = this.listEntities("group");

    if (featuresList) {
      return groups.filter((group) => {
        const groupContent = this.parseEntity<Group>("group", group);

        return groupContent.slots.some((slot) => {
          if (!slot.feature) {
            return false;
          }

          return featuresList.indexOf(slot.feature) !== -1;
        });
      });
    }

    return groups;
  }

  readGroup(groupKey: string) {
    return this.parseEntity<Group>("group", groupKey);
  }

  // tests
  listTests() {
    return this.listEntities("test");
  }

  readTest(testKey: string) {
    return this.parseEntity<Spec>("test", testKey);
  }
}
