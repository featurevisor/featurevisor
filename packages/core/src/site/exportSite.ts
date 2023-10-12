import * as fs from "fs";
import * as path from "path";

import * as mkdirp from "mkdirp";

import { ProjectConfig } from "../config";

import { generateHistory } from "./generateHistory";
import { getRepoDetails } from "./getRepoDetails";
import { generateSiteSearchIndex } from "./generateSiteSearchIndex";

export function exportSite(rootDirectoryPath: string, projectConfig: ProjectConfig) {
  const hasError = false;

  mkdirp.sync(projectConfig.siteExportDirectoryPath);

  const sitePackagePath = path.dirname(require.resolve("@featurevisor/site/package.json"));

  // copy site dist
  const siteDistPath = path.join(sitePackagePath, "dist");
  fs.cpSync(siteDistPath, projectConfig.siteExportDirectoryPath, { recursive: true });

  const sitePublicPath = path.join(sitePackagePath, "public");
  fs.cpSync(sitePublicPath, projectConfig.siteExportDirectoryPath, { recursive: true });

  console.log("Site dist copied to:", projectConfig.siteExportDirectoryPath);

  // generate history
  const fullHistory = generateHistory(rootDirectoryPath, projectConfig);

  // site search index
  const repoDetails = getRepoDetails();
  const searchIndex = generateSiteSearchIndex(
    rootDirectoryPath,
    projectConfig,
    fullHistory,
    repoDetails,
  );
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
