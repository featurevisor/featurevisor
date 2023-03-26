import * as fs from "fs";
import * as path from "path";

import { Attribute, ParsedFeature, Segment } from "@featurevisor/types";

import { ProjectConfig } from "./config";
import { parseYaml } from "./utils";

export function generateSearchIndex(projectConfig: ProjectConfig) {
  const result = {
    entities: {
      attributes: [] as Attribute[],
      segments: [] as Segment[],
      features: [] as ParsedFeature[],
    },
  };

  /**
   * Entities
   */

  // attributes
  const attributeFiles = fs.readdirSync(projectConfig.attributesDirectoryPath);
  attributeFiles
    .filter((fileName) => fileName.endsWith(".yml"))
    .forEach((fileName) => {
      const filePath = path.join(projectConfig.attributesDirectoryPath, fileName);
      const entityName = fileName.replace(".yml", "");

      const fileContent = fs.readFileSync(filePath, "utf8");
      const parsed = parseYaml(fileContent) as Attribute;

      result.entities.attributes.push({
        ...parsed,
        key: entityName,
      });
    });

  // segments
  const segmentFiles = fs.readdirSync(projectConfig.segmentsDirectoryPath);
  segmentFiles
    .filter((fileName) => fileName.endsWith(".yml"))
    .forEach((fileName) => {
      const filePath = path.join(projectConfig.segmentsDirectoryPath, fileName);
      const entityName = fileName.replace(".yml", "");

      const fileContent = fs.readFileSync(filePath, "utf8");
      const parsed = parseYaml(fileContent) as Segment;

      result.entities.segments.push({
        ...parsed,
        key: entityName,
      });
    });

  // features
  const featureFiles = fs.readdirSync(projectConfig.featuresDirectoryPath);
  featureFiles
    .filter((fileName) => fileName.endsWith(".yml"))
    .forEach((fileName) => {
      const filePath = path.join(projectConfig.featuresDirectoryPath, fileName);
      const entityName = fileName.replace(".yml", "");

      const fileContent = fs.readFileSync(filePath, "utf8");
      const parsed = parseYaml(fileContent) as ParsedFeature;

      result.entities.features.push({
        ...parsed,
        key: entityName,
      });
    });

  return result;
}

export function generateSite(rootDirectoryPath: string, projectConfig: ProjectConfig) {
  const hasError = false;

  const searchIndex = generateSearchIndex(projectConfig);
  const searchIndexFilePath = path.join(projectConfig.outputDirectoryPath, "search-index.json");

  fs.writeFileSync(searchIndexFilePath, JSON.stringify(searchIndex, null, 2));
  console.log(`File written at: ${searchIndexFilePath}`);

  return hasError;
}
