import { Datasource } from "../datasource";
import { ProjectConfig } from "../config";

import { findDuplicateSegments } from "./findDuplicateSegments";

export function findDuplicateSegmentsInProject(rootDirectoryPath, projectConfig: ProjectConfig) {
  const datasource = new Datasource(projectConfig);

  const duplicates = findDuplicateSegments(datasource);

  if (duplicates.length === 0) {
    console.log("No duplicate segments found");
    return;
  }

  console.log(`Found ${duplicates.length} duplicates:\n`);

  duplicates.forEach((segmentKeys) => {
    console.log(`  - ${segmentKeys.join(", ")}`);
  });
}
