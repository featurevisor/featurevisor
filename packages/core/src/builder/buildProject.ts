import * as fs from "fs";
import * as path from "path";

import * as mkdirp from "mkdirp";

import { ExistingState, EnvironmentKey } from "@featurevisor/types";

import { SCHEMA_VERSION, ProjectConfig } from "../config";
import { Datasource } from "../datasource";

import { buildDatafile } from "./buildDatafile";

export function getDatafilePath(
  projectConfig: ProjectConfig,
  environment: EnvironmentKey,
  tag: string,
): string {
  const fileName = `datafile-tag-${tag}.json`;

  return path.join(projectConfig.outputDirectoryPath, environment, fileName);
}

export function getExistingStateFilePath(
  projectConfig: ProjectConfig,
  environment: EnvironmentKey,
): string {
  return path.join(projectConfig.stateDirectoryPath, `existing-state-${environment}.json`);
}

export interface BuildCLIOptions {
  revision?: string;
}

export async function buildProject(
  rootDirectoryPath,
  projectConfig: ProjectConfig,
  cliOptions: BuildCLIOptions = {},
) {
  const tags = projectConfig.tags;
  const environments = projectConfig.environments;

  const pkg = require(path.join(rootDirectoryPath, "package.json"));
  const datasource = new Datasource(projectConfig);

  for (const environment of environments) {
    console.log(`\nBuilding datafiles for environment: ${environment}`);

    const existingStateFilePath = getExistingStateFilePath(projectConfig, environment);
    const existingState: ExistingState = fs.existsSync(existingStateFilePath)
      ? require(existingStateFilePath)
      : {
          features: {},
        };

    for (const tag of tags) {
      console.log(`\n  => Tag: ${tag}`);
      const datafileContent = await buildDatafile(
        projectConfig,
        datasource,
        {
          schemaVersion: SCHEMA_VERSION,
          revision: cliOptions.revision || pkg.version,
          environment: environment,
          tag: tag,
        },
        existingState,
      );

      // write datafile for environment/tag
      const outputEnvironmentDirPath = path.join(projectConfig.outputDirectoryPath, environment);
      mkdirp.sync(outputEnvironmentDirPath);

      const outputFilePath = getDatafilePath(projectConfig, environment, tag);
      fs.writeFileSync(
        outputFilePath,
        projectConfig.prettyDatafile
          ? JSON.stringify(datafileContent, null, 2)
          : JSON.stringify(datafileContent),
      );
      const shortPath = outputFilePath.replace(rootDirectoryPath + path.sep, "");
      console.log(`     Datafile generated: ${shortPath}`);
    }

    // write state for environment
    if (!fs.existsSync(projectConfig.stateDirectoryPath)) {
      mkdirp.sync(projectConfig.stateDirectoryPath);
    }
    fs.writeFileSync(
      existingStateFilePath,
      projectConfig.prettyState
        ? JSON.stringify(existingState, null, 2)
        : JSON.stringify(existingState),
    );
  }
}
