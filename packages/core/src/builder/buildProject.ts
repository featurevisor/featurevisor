import { SCHEMA_VERSION } from "../config";

import { getNextRevision } from "./revision";
import { buildDatafile, getCustomDatafile, buildScopedDatafile } from "./buildDatafile";
import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";

export interface BuildCLIOptions {
  revision?: string;

  // all three together
  environment?: string;
  feature?: string;
  print?: boolean;
  pretty?: boolean;
  stateFiles?: boolean; // --no-state-files in CLI
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
  if (cliOptions.environment && cliOptions.print) {
    const datafileContent = await getCustomDatafile({
      featureKey: cliOptions.feature,
      environment: cliOptions.environment,
      projectConfig,
      datasource,
      revision: cliOptions.revision,
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
  const { tags, environments, scopes } = projectConfig;

  const currentRevision = await datasource.readRevision();
  console.log("\nCurrent revision:", currentRevision);

  const nextRevision =
    (cliOptions.revision && cliOptions.revision.toString()) || getNextRevision(currentRevision);

  for (const environment of environments) {
    console.log(`\nBuilding datafiles for environment: ${environment}`);

    const existingState = await datasource.readState(environment);

    for (const tag of tags) {
      console.log(`\n  => Tag: ${tag}`);

      const datafileContent = await buildDatafile(
        projectConfig,
        datasource,
        {
          schemaVersion: SCHEMA_VERSION,
          revision: nextRevision,
          environment: environment,
          tag: tag,
        },
        existingState,
      );

      // write datafile for environment/tag
      await datasource.writeDatafile(datafileContent, {
        environment,
        tag,
      });
    }

    if (typeof cliOptions.stateFiles === "undefined" || cliOptions.stateFiles) {
      // write state for environment
      await datasource.writeState(environment, existingState);

      // write revision
      await datasource.writeRevision(nextRevision);
    }

    // scopes
    for (const scope of scopes) {
      console.log(`\n  => Scope: ${scope}`);

      const tag = scope.tag;
      const taggedDatafileContent = await datasource.readDatafile({ environment, tag });
      const scopedDatafileContent = buildScopedDatafile(taggedDatafileContent, scope);

      // write scoped datafile
      await datasource.writeDatafile(scopedDatafileContent, {
        environment,
        tag,
        scope,
      });
    }
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
