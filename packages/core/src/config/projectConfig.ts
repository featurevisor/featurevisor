import * as path from "path";

import type { BucketBy } from "@featurevisor/types";
import { Parser, parsers } from "@featurevisor/parsers";

import { FilesystemAdapter } from "../datasource/filesystemAdapter";
import type { Plugin } from "../cli";
import { CLI_COLOR_CYAN, CLI_FORMAT_BOLD, colorize } from "../tester/cliFormat";

export const FEATURES_DIRECTORY_NAME = "features";
export const SEGMENTS_DIRECTORY_NAME = "segments";
export const ATTRIBUTES_DIRECTORY_NAME = "attributes";
export const GROUPS_DIRECTORY_NAME = "groups";
export const SCHEMAS_DIRECTORY_NAME = "schemas";
export const TARGETS_DIRECTORY_NAME = "targets";
export const TESTS_DIRECTORY_NAME = "tests";
export const STATE_DIRECTORY_NAME = ".featurevisor";
export const DATAFILES_DIRECTORY_NAME = "datafiles";
export const DATAFILE_NAME_PATTERN = "featurevisor-%s.json";
export const REVISION_FILE_NAME = "REVISION";
export const SITE_EXPORT_DIRECTORY_NAME = "out";
export const SETS_DIRECTORY_NAME = "sets";

export const CONFIG_MODULE_NAME = "featurevisor.config.js";
export const ROOT_DIR_PLACEHOLDER = "<rootDir>";

export const DEFAULT_NAMESPACE_CHARACTER = ".";
export const DEFAULT_TAGS = ["all"];
export const DEFAULT_BUCKET_BY_ATTRIBUTE = "userId";
export const DEFAULT_SETS = false;

export const DEFAULT_PRETTY_STATE = true;
export const DEFAULT_PRETTY_DATAFILE = false;

export const DEFAULT_PARSER: Parser = "yml";

export const SCHEMA_VERSION = "2"; // default schema version

export interface ProjectConfig {
  promotionFlows?: Array<{
    from: string;
    to: string;
  }>;
  namespaceCharacter: string;
  featuresDirectoryPath: string;
  segmentsDirectoryPath: string;
  attributesDirectoryPath: string;
  groupsDirectoryPath: string;
  schemasDirectoryPath: string;
  targetsDirectoryPath: string;
  testsDirectoryPath: string;
  stateDirectoryPath: string;
  datafilesDirectoryPath: string;
  datafileNamePattern: string;
  revisionFileName: string;
  siteExportDirectoryPath: string;
  setsDirectoryPath: string;

  environments?: string[];
  sets: boolean;
  tags: string[];

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
    environments: undefined,
    sets: DEFAULT_SETS,
    promotionFlows: undefined,
    namespaceCharacter: DEFAULT_NAMESPACE_CHARACTER,
    tags: DEFAULT_TAGS,
    defaultBucketBy: "userId",

    parser: DEFAULT_PARSER,

    prettyState: DEFAULT_PRETTY_STATE,
    prettyDatafile: DEFAULT_PRETTY_DATAFILE,
    stringify: true,

    adapter: FilesystemAdapter,

    featuresDirectoryPath: path.join(rootDirectoryPath, FEATURES_DIRECTORY_NAME),
    setsDirectoryPath: path.join(rootDirectoryPath, SETS_DIRECTORY_NAME),
    segmentsDirectoryPath: path.join(rootDirectoryPath, SEGMENTS_DIRECTORY_NAME),
    attributesDirectoryPath: path.join(rootDirectoryPath, ATTRIBUTES_DIRECTORY_NAME),
    groupsDirectoryPath: path.join(rootDirectoryPath, GROUPS_DIRECTORY_NAME),
    schemasDirectoryPath: path.join(rootDirectoryPath, SCHEMAS_DIRECTORY_NAME),
    targetsDirectoryPath: path.join(rootDirectoryPath, TARGETS_DIRECTORY_NAME),
    testsDirectoryPath: path.join(rootDirectoryPath, TESTS_DIRECTORY_NAME),
    stateDirectoryPath: path.join(rootDirectoryPath, STATE_DIRECTORY_NAME),
    datafilesDirectoryPath: path.join(rootDirectoryPath, DATAFILES_DIRECTORY_NAME),
    datafileNamePattern: DATAFILE_NAME_PATTERN,
    revisionFileName: REVISION_FILE_NAME,
    siteExportDirectoryPath: path.join(rootDirectoryPath, SITE_EXPORT_DIRECTORY_NAME),

    enforceCatchAllRule: false,
    plugins: [],

    maxVariableStringLength: undefined,
    maxVariableArrayStringifiedLength: undefined,
    maxVariableObjectStringifiedLength: undefined,
    maxVariableJSONStringifiedLength: undefined,
  };

  const configModulePath = path.join(rootDirectoryPath, CONFIG_MODULE_NAME);
  const customConfig = require(configModulePath);

  if (typeof customConfig.scopes !== "undefined") {
    throw new Error(
      'Config "scopes" is no longer supported. Define datafile targets in targets/ instead.',
    );
  }

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

  if (typeof finalConfig.sets !== "boolean") {
    throw new Error(`Invalid sets: ${finalConfig.sets}. It must be a boolean.`);
  }

  if (typeof finalConfig.environments !== "undefined") {
    if (!Array.isArray(finalConfig.environments)) {
      throw new Error(
        `Invalid environments: ${finalConfig.environments}. It must be an array of strings when defined.`,
      );
    }

    finalConfig.environments.forEach((environment: unknown, index: number) => {
      if (typeof environment !== "string") {
        throw new Error(`Invalid environments[${index}]: ${environment}. It must be a string.`);
      }
    });
  }

  if (
    typeof finalConfig.namespaceCharacter !== "string" ||
    finalConfig.namespaceCharacter.length === 0
  ) {
    throw new Error(
      `Invalid namespaceCharacter: ${finalConfig.namespaceCharacter}. It must be a non-empty string.`,
    );
  }

  if (typeof finalConfig.promotionFlows !== "undefined") {
    if (!Array.isArray(finalConfig.promotionFlows)) {
      throw new Error(
        `Invalid promotionFlows: ${finalConfig.promotionFlows}. It must be an array.`,
      );
    }

    finalConfig.promotionFlows.forEach((entry: any, index: number) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Error(
          `Invalid promotionFlows[${index}]: ${entry}. Each entry must be an object with exactly "from" and "to" string fields.`,
        );
      }

      const keys = Object.keys(entry).sort();

      if (keys.length !== 2 || keys[0] !== "from" || keys[1] !== "to") {
        throw new Error(
          `Invalid promotionFlows[${index}]: ${JSON.stringify(entry)}. Each entry must contain exactly "from" and "to".`,
        );
      }

      if (typeof entry.from !== "string" || typeof entry.to !== "string") {
        throw new Error(
          `Invalid promotionFlows[${index}]: ${JSON.stringify(entry)}. "from" and "to" must be strings.`,
        );
      }
    });
  }

  return finalConfig as ProjectConfig;
}

export function getProjectConfigForSet(projectConfig: ProjectConfig, set: string): ProjectConfig {
  const setRootDirectoryPath = path.join(projectConfig.setsDirectoryPath, set);

  return {
    ...projectConfig,
    featuresDirectoryPath: path.join(setRootDirectoryPath, FEATURES_DIRECTORY_NAME),
    segmentsDirectoryPath: path.join(setRootDirectoryPath, SEGMENTS_DIRECTORY_NAME),
    attributesDirectoryPath: path.join(setRootDirectoryPath, ATTRIBUTES_DIRECTORY_NAME),
    groupsDirectoryPath: path.join(setRootDirectoryPath, GROUPS_DIRECTORY_NAME),
    schemasDirectoryPath: path.join(setRootDirectoryPath, SCHEMAS_DIRECTORY_NAME),
    targetsDirectoryPath: path.join(setRootDirectoryPath, TARGETS_DIRECTORY_NAME),
    testsDirectoryPath: path.join(setRootDirectoryPath, TESTS_DIRECTORY_NAME),
    stateDirectoryPath: path.join(projectConfig.stateDirectoryPath, SETS_DIRECTORY_NAME, set),
    datafilesDirectoryPath: path.join(projectConfig.datafilesDirectoryPath, set),
  };
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

  console.log("");
  console.log(CLI_FORMAT_BOLD, "Project configuration");
  console.log("");

  const keys = Object.keys(projectConfig);
  const longestKeyLength = keys.reduce((acc, key) => (key.length > acc ? key.length : acc), 0);
  const ignoreKeys = ["adapter", "parser"];

  for (const key of keys) {
    if (ignoreKeys.indexOf(key) !== -1) {
      continue;
    }

    console.log(
      `  ${colorize(key.padEnd(longestKeyLength, " "), CLI_COLOR_CYAN)}: ${projectConfig[key]}`,
    );
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
