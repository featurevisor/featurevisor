import * as fs from "fs";
import * as path from "path";

import { generateHistory } from "./generateHistory";
import { getRepoDetails } from "./getRepoDetails";
import { generateSiteSearchIndex } from "./generateSiteSearchIndex";
import { Dependencies } from "../dependencies";

export async function exportSite(deps: Dependencies) {
  const { projectConfig } = deps;

  const hasError = false;

  fs.mkdirSync(projectConfig.siteExportDirectoryPath, { recursive: true });

  const sitePackagePath = path.dirname(require.resolve("@featurevisor/site/package.json"));

  // copy site dist
  const siteDistPath = path.join(sitePackagePath, "dist");
  fs.cpSync(siteDistPath, projectConfig.siteExportDirectoryPath, { recursive: true });

  console.log("Site dist copied to:", projectConfig.siteExportDirectoryPath);

  // generate history
  const fullHistory = await generateHistory(deps);

  // site search index
  const repoDetails = getRepoDetails();
  const searchIndex = await generateSiteSearchIndex(deps, fullHistory, repoDetails);
  const searchIndexFilePath = path.join(projectConfig.siteExportDirectoryPath, "search-index.json");
  fs.writeFileSync(searchIndexFilePath, JSON.stringify(searchIndex));
  console.log(`Site search index written at: ${searchIndexFilePath}`);

  // copy datafiles
  fs.cpSync(
    projectConfig.datafilesDirectoryPath,
    path.join(projectConfig.siteExportDirectoryPath, "datafiles"),
    { recursive: true },
  );

  return hasError;
}
