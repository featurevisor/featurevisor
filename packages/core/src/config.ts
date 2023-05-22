import * as path from "path";

import { BucketBy } from "@featurevisor/types";

export const FEATURES_DIRECTORY_NAME = "features";
export const SEGMENTS_DIRECTORY_NAME = "segments";
export const ATTRIBUTES_DIRECTORY_NAME = "attributes";
export const GROUPS_DIRECTORY_NAME = "groups";
export const TESTS_DIRECTORY_NAME = "tests";
export const STATE_DIRECTORY_NAME = ".featurevisor";
export const OUTPUT_DIRECTORY_NAME = "dist";
export const SITE_EXPORT_DIRECTORY_NAME = "out";

export const CONFIG_MODULE_NAME = "featurevisor.config.js";
export const ROOT_DIR_PLACECOLDER = "<rootDir>";

export const DEFAULT_ENVIRONMENTS = ["staging", "production"];
export const DEFAULT_TAGS = ["all"];
export const DEFAULT_BUCKET_BY_ATTRIBUTE = "userId";

export const DEFAULT_PRETTY_STATE = false;
export const DEFAULT_PRETTY_DATAFILE = false;

export const SCHEMA_VERSION = "1";

export interface ProjectConfig {
  featuresDirectoryPath: string;
  segmentsDirectoryPath: string;
  attributesDirectoryPath: string;
  groupsDirectoryPath: string;
  testsDirectoryPath: string;
  stateDirectoryPath: string;
  outputDirectoryPath: string;
  environments: string[];
  tags: string[];
  defaultBucketBy: BucketBy;
  prettyState: boolean;
  prettyDatafile: boolean;
  siteExportDirectoryPath: string;
}

// rootDirectoryPath: path to the root directory of the project (without ending with a slash)
export function getProjectConfig(rootDirectoryPath: string): ProjectConfig {
  const baseConfig: ProjectConfig = {
    featuresDirectoryPath: path.join(rootDirectoryPath, FEATURES_DIRECTORY_NAME),
    segmentsDirectoryPath: path.join(rootDirectoryPath, SEGMENTS_DIRECTORY_NAME),
    attributesDirectoryPath: path.join(rootDirectoryPath, ATTRIBUTES_DIRECTORY_NAME),
    groupsDirectoryPath: path.join(rootDirectoryPath, GROUPS_DIRECTORY_NAME),
    testsDirectoryPath: path.join(rootDirectoryPath, TESTS_DIRECTORY_NAME),

    stateDirectoryPath: path.join(rootDirectoryPath, STATE_DIRECTORY_NAME),
    outputDirectoryPath: path.join(rootDirectoryPath, OUTPUT_DIRECTORY_NAME),

    environments: DEFAULT_ENVIRONMENTS,
    tags: DEFAULT_TAGS,
    defaultBucketBy: "userId",

    prettyState: DEFAULT_PRETTY_STATE,
    prettyDatafile: DEFAULT_PRETTY_DATAFILE,

    siteExportDirectoryPath: path.join(rootDirectoryPath, SITE_EXPORT_DIRECTORY_NAME),
  };

  const configModulePath = path.join(rootDirectoryPath, CONFIG_MODULE_NAME);
  const customConfig = require(configModulePath);

  const finalConfig = {};

  Object.keys(baseConfig).forEach((key) => {
    finalConfig[key] = customConfig[key] || baseConfig[key];

    if (key.endsWith("Path") && finalConfig[key].indexOf(ROOT_DIR_PLACECOLDER) !== -1) {
      finalConfig[key] = finalConfig[key].replace(ROOT_DIR_PLACECOLDER, rootDirectoryPath);
    }
  });

  return finalConfig as ProjectConfig;
}
