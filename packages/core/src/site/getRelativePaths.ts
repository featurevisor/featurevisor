import * as path from "path";

import { ProjectConfig } from "../config";

export function getRelativePaths(rootDirectoryPath, projectConfig: ProjectConfig) {
  const relativeFeaturesPath = path.relative(
    rootDirectoryPath,
    projectConfig.featuresDirectoryPath,
  );
  const relativeSegmentsPath = path.relative(
    rootDirectoryPath,
    projectConfig.segmentsDirectoryPath,
  );
  const relativeAttributesPath = path.relative(
    rootDirectoryPath,
    projectConfig.attributesDirectoryPath,
  );

  return {
    relativeFeaturesPath,
    relativeSegmentsPath,
    relativeAttributesPath,
  };
}
