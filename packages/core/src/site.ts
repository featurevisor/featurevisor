import * as fs from "fs";
import * as path from "path";

import * as mkdirp from "mkdirp";

import { Attribute, ParsedFeature, Segment } from "@featurevisor/types";

import { ProjectConfig } from "./config";
import { parseYaml } from "./utils";

export function generateSiteSearchIndex(projectConfig: ProjectConfig) {
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

export function exportSite(rootDirectoryPath: string, projectConfig: ProjectConfig) {
  const hasError = false;

  mkdirp.sync(projectConfig.siteExportDirectoryPath);

  const sitePackagePath = path.dirname(require.resolve("@featurevisor/site/package.json"));

  // copy site dist
  const siteDistPath = path.join(sitePackagePath, "dist");
  fs.cpSync(siteDistPath, projectConfig.siteExportDirectoryPath, { recursive: true });
  console.log("Site dist copied to:", projectConfig.siteExportDirectoryPath);

  // site search index
  const searchIndex = generateSiteSearchIndex(projectConfig);
  const searchIndexFilePath = path.join(projectConfig.siteExportDirectoryPath, "search-index.json");
  fs.writeFileSync(searchIndexFilePath, JSON.stringify(searchIndex));
  console.log(`Site search index written at: ${searchIndexFilePath}`);

  // copy datafiles
  fs.cpSync(
    projectConfig.outputDirectoryPath,
    path.join(projectConfig.siteExportDirectoryPath, "datafiles"),
    { recursive: true },
  );

  // @TODO: replace placeoholders in index.html

  return hasError;
}
