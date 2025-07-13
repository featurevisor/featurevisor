import { SCHEMA_VERSION, ProjectConfig } from "../config";
import { Datasource } from "../datasource";

import { getNextRevision } from "./revision";
import { buildDatafile, getCustomDatafile } from "./buildDatafile";
import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";
import type { DatafileContent } from "@featurevisor/types";

export interface BuildCLIOptions {
  revision?: string;
  revisionFromHash?: boolean;
  schemaVersion?: string;

  // all three together
  environment?: string;
  feature?: string;
  json?: boolean;
  pretty?: boolean;
  stateFiles?: boolean; // --no-state-files in CLI
  inflate?: number;
  datafilesDir?: string;
}

async function buildForEnvironment({
  projectConfig,
  datasource,
  nextRevision,
  environment,
  tags,
  cliOptions,
}: {
  projectConfig: ProjectConfig;
  datasource: Datasource;
  nextRevision: string;
  environment: string | false;
  tags: string[];
  cliOptions: BuildCLIOptions;
}) {
  console.log(`\nBuilding datafiles for environment: ${environment}`);

  const existingState = await datasource.readState(environment);

  for (const tag of tags) {
    console.log(`\n  => Tag: ${tag}`);

    const datafileContent = await buildDatafile(
      projectConfig,
      datasource,
      {
        schemaVersion: cliOptions.schemaVersion || SCHEMA_VERSION,
        revision: nextRevision,
        revisionFromHash: cliOptions.revisionFromHash,
        environment: environment,
        tag: tag,
        inflate: cliOptions.inflate,
      },
      existingState,
    );

    // write datafile for environment/tag
    await datasource.writeDatafile(datafileContent as DatafileContent, {
      environment,
      tag,
      datafilesDir: cliOptions.datafilesDir,
    });
  }

  if (typeof cliOptions.stateFiles === "undefined" || cliOptions.stateFiles) {
    // write state for environment
    await datasource.writeState(environment, existingState);

    // write revision
    await datasource.writeRevision(nextRevision);
  }
}

export async function buildProject(deps: Dependencies, cliOptions: BuildCLIOptions = {}) {
  const { projectConfig, datasource } = deps;

  /**
   * This build process does not write to disk, and prints only to stdout.
   *
   * This is ideally for test runners in other languages,
   * when they wish to get datafile for a single feature and/or environment,
   * so they can run tests against their own SDKs in other languages.
   *
   * This way we centralize the datafile generation in one place,
   * while tests can be run anywhere else.
   */
  if (cliOptions.environment && cliOptions.json) {
    const datafileContent = await getCustomDatafile({
      featureKey: cliOptions.feature,
      environment: cliOptions.environment,
      projectConfig,
      datasource,
      revision: cliOptions.revision,
      schemaVersion: cliOptions.schemaVersion,
    });

    if (cliOptions.pretty) {
      console.log(JSON.stringify(datafileContent, null, 2));
    } else {
      console.log(JSON.stringify(datafileContent));
    }

    return;
  }

  /**
   * Regular build process that writes to disk.
   */
  const tags = projectConfig.tags;
  const environments = projectConfig.environments;

  const currentRevision = await datasource.readRevision();
  console.log("\nCurrent revision:", currentRevision);

  const nextRevision =
    (cliOptions.revision && cliOptions.revision.toString()) || getNextRevision(currentRevision);

  // with environments
  if (Array.isArray(environments)) {
    for (const environment of environments) {
      await buildForEnvironment({
        projectConfig,
        datasource,
        nextRevision,
        environment,
        tags,
        cliOptions,
      });
    }
  }

  // no environment
  if (environments === false) {
    await buildForEnvironment({
      projectConfig,
      datasource,
      nextRevision,
      environment: false,
      tags,
      cliOptions,
    });
  }

  console.log("\nLatest revision:", nextRevision);
}

export const buildPlugin: Plugin = {
  command: "build",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    await buildProject(
      {
        rootDirectoryPath,
        projectConfig,
        datasource,
        options: parsed,
      },
      parsed as BuildCLIOptions,
    );
  },
  examples: [
    {
      command: "build",
      description: "build datafiles for all environments and tags",
    },
    {
      command: "build --revision=123",
      description: "build datafiles starting with revision value as 123",
    },
    {
      command: "build --environment=production",
      description: "build datafiles for production environment",
    },
    {
      command: "build --print --environment=production --feature=featureKey",
      description: "print datafile for a feature in production environment",
    },
    {
      command: "build --print --environment=production --pretty",
      description: "print datafile with pretty print",
    },
    {
      command: "build --no-state-files",
      description: "build datafiles without writing state files",
    },
  ],
};
