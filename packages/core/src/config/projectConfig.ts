import * as path from "path";

import type { BucketBy, Context, Tag } from "@featurevisor/types";

import { Parser, parsers } from "../parsers";
import { FilesystemAdapter } from "../datasource/filesystemAdapter";
import type { Plugin } from "../cli";
import type { BuildTags } from "../builder/buildDatafile";

export const FEATURES_DIRECTORY_NAME = "features";
export const SEGMENTS_DIRECTORY_NAME = "segments";
export const ATTRIBUTES_DIRECTORY_NAME = "attributes";
export const GROUPS_DIRECTORY_NAME = "groups";
export const SCHEMAS_DIRECTORY_NAME = "schemas";
export const TESTS_DIRECTORY_NAME = "tests";
export const STATE_DIRECTORY_NAME = ".featurevisor";
export const DATAFILES_DIRECTORY_NAME = "datafiles";
export const DATAFILE_NAME_PATTERN = "featurevisor-%s.json";
export const REVISION_FILE_NAME = "REVISION";
export const SITE_EXPORT_DIRECTORY_NAME = "out";
export const ENVIRONMENTS_DIRECTORY_NAME = "environments";

export const CONFIG_MODULE_NAME = "featurevisor.config.js";
export const ROOT_DIR_PLACEHOLDER = "<rootDir>";

export const DEFAULT_ENVIRONMENTS = ["staging", "production"];
export const DEFAULT_TAGS = ["all"];
export const DEFAULT_BUCKET_BY_ATTRIBUTE = "userId";

export const DEFAULT_PRETTY_STATE = true;
export const DEFAULT_PRETTY_DATAFILE = false;

export const DEFAULT_PARSER: Parser = "yml";

export const SCHEMA_VERSION = "2"; // default schema version

export interface Scope {
  name: string;
  context: Context;
  tag?: Tag;
  tags?: BuildTags;
}

export interface ProjectConfig {
  featuresDirectoryPath: string;
  segmentsDirectoryPath: string;
  attributesDirectoryPath: string;
  groupsDirectoryPath: string;
  schemasDirectoryPath: string;
  testsDirectoryPath: string;
  stateDirectoryPath: string;
  datafilesDirectoryPath: string;
  datafileNamePattern: string;
  revisionFileName: string;
  siteExportDirectoryPath: string;
  environmentsDirectoryPath: string;

  environments: string[] | false;
  splitByEnvironment: boolean;
  tags: string[];
  scopes?: Scope[];

  adapter: any; // @NOTE: type this properly later
  plugins: Plugin[];

  defaultBucketBy: BucketBy;
  parser: Parser;

  prettyState: boolean;
  prettyDatafile: boolean;
  stringify: boolean;

  enforceCatchAllRule?: boolean;
  maxVariableStringLength?: number;
  maxVariableArrayStringifiedLength?: number;
  maxVariableObjectStringifiedLength?: number;
  maxVariableJSONStringifiedLength?: number;
}

// rootDirectoryPath: path to the root directory of the project (without ending with a slash)
export function getProjectConfig(rootDirectoryPath: string): ProjectConfig {
  const baseConfig: ProjectConfig = {
    environments: DEFAULT_ENVIRONMENTS,
    tags: DEFAULT_TAGS,
    scopes: [],
    defaultBucketBy: "userId",

    parser: DEFAULT_PARSER,

    prettyState: DEFAULT_PRETTY_STATE,
    prettyDatafile: DEFAULT_PRETTY_DATAFILE,
    stringify: true,

    adapter: FilesystemAdapter,

    featuresDirectoryPath: path.join(rootDirectoryPath, FEATURES_DIRECTORY_NAME),
    environmentsDirectoryPath: path.join(rootDirectoryPath, ENVIRONMENTS_DIRECTORY_NAME),
    segmentsDirectoryPath: path.join(rootDirectoryPath, SEGMENTS_DIRECTORY_NAME),
    attributesDirectoryPath: path.join(rootDirectoryPath, ATTRIBUTES_DIRECTORY_NAME),
    groupsDirectoryPath: path.join(rootDirectoryPath, GROUPS_DIRECTORY_NAME),
    schemasDirectoryPath: path.join(rootDirectoryPath, SCHEMAS_DIRECTORY_NAME),
    testsDirectoryPath: path.join(rootDirectoryPath, TESTS_DIRECTORY_NAME),
    stateDirectoryPath: path.join(rootDirectoryPath, STATE_DIRECTORY_NAME),
    datafilesDirectoryPath: path.join(rootDirectoryPath, DATAFILES_DIRECTORY_NAME),
    datafileNamePattern: DATAFILE_NAME_PATTERN,
    revisionFileName: REVISION_FILE_NAME,
    siteExportDirectoryPath: path.join(rootDirectoryPath, SITE_EXPORT_DIRECTORY_NAME),

    enforceCatchAllRule: false,
    plugins: [],
    splitByEnvironment: false,

    maxVariableStringLength: undefined,
    maxVariableArrayStringifiedLength: undefined,
    maxVariableObjectStringifiedLength: undefined,
    maxVariableJSONStringifiedLength: undefined,
  };

  const configModulePath = path.join(rootDirectoryPath, CONFIG_MODULE_NAME);
  const customConfig = require(configModulePath);

  const mergedConfig = {};

  Object.keys(baseConfig).forEach((key) => {
    mergedConfig[key] =
      typeof customConfig[key] !== "undefined" ? customConfig[key] : baseConfig[key];

    if (key.endsWith("Path") && mergedConfig[key].indexOf(ROOT_DIR_PLACEHOLDER) !== -1) {
      mergedConfig[key] = mergedConfig[key].replace(ROOT_DIR_PLACEHOLDER, rootDirectoryPath);
    }
  });

  const finalConfig = mergedConfig as ProjectConfig;

  if (typeof finalConfig.parser === "string") {
    const allowedParsers = Object.keys(parsers);
    if (allowedParsers.indexOf(finalConfig.parser) === -1) {
      throw new Error(`Invalid parser: ${finalConfig.parser}`);
    }

    finalConfig.parser = parsers[finalConfig.parser];
  }

  if (finalConfig.splitByEnvironment && finalConfig.environments === false) {
    throw new Error(
      "Invalid configuration: splitByEnvironment=true requires environments to be an array",
    );
  }

  return finalConfig as ProjectConfig;
}

export interface ShowProjectConfigOptions {
  json?: boolean;
  pretty?: boolean;
}

export function showProjectConfig(
  projectConfig: ProjectConfig,
  options: ShowProjectConfigOptions = {},
) {
  if (options.json) {
    console.log(
      options.pretty ? JSON.stringify(projectConfig, null, 2) : JSON.stringify(projectConfig),
    );

    return;
  }

  console.log("\nProject configuration:\n");

  const keys = Object.keys(projectConfig);
  const longestKeyLength = keys.reduce((acc, key) => (key.length > acc ? key.length : acc), 0);
  const ignoreKeys = ["adapter", "parser"];

  for (const key of keys) {
    if (ignoreKeys.indexOf(key) !== -1) {
      continue;
    }

    console.log(`  - ${key.padEnd(longestKeyLength, " ")}: ${projectConfig[key]}`);
  }
}

export const configPlugin: Plugin = {
  command: "config",
  handler: async ({ rootDirectoryPath, parsed }) => {
    const projectConfig = getProjectConfig(rootDirectoryPath);
    showProjectConfig(projectConfig, {
      json: parsed.json,
      pretty: parsed.pretty,
    });
  },
  examples: [
    {
      command: "config",
      description: "show the project configuration",
    },
    {
      command: "config --print",
      description: "show the project configuration as JSON",
    },
    {
      command: "config --print --pretty",
      description: "show the project configuration (as pretty JSON)",
    },
  ],
};
