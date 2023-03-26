import * as fs from "fs";
import * as path from "path";

import { ProjectConfig, Attribute, ParsedFeature, Segment } from "@featurevisor/types";
import { parseYaml } from "./utils";

export function generateSearchIndex(projectConfig: ProjectConfig) {
  const result = {
    attributes: [] as Attribute[],
    segments: [] as Segment[],
    features: [] as ParsedFeature[],
  };

  // attributes
  const attributeFiles = fs.readdirSync(projectConfig.attributesDirectoryPath);
  attributeFiles
    .filter((fileName) => fileName.endsWith(".yml"))
    .forEach((fileName) => {
      const filePath = path.join(projectConfig.attributesDirectoryPath, fileName);
      const entityName = fileName.replace(".yml", "");

      const fileContent = fs.readFileSync(filePath, "utf8");
      const parsed = parseYaml(fileContent) as Attribute;

      result.attributes.push({
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

      result.segments.push({
        ...parsed,
        key: entityName,
      });
    });

  // features
  const featureFiles = fs.readdirSync(projectConfig.featuresDirectoryPath);
  segmentFiles
    .filter((fileName) => fileName.endsWith(".yml"))
    .forEach((fileName) => {
      const filePath = path.join(projectConfig.featuresDirectoryPath, fileName);
      const entityName = fileName.replace(".yml", "");

      const fileContent = fs.readFileSync(filePath, "utf8");
      const parsed = parseYaml(fileContent) as ParsedFeature;

      result.features.push({
        ...parsed,
        key: entityName,
      });
    });

  return result;
}
