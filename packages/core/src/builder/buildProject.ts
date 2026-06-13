import * as path from "path";

import { SCHEMA_VERSION, ProjectConfig } from "../config";
import { Datasource } from "../datasource";

import { getNextRevision } from "./revision";
import { buildDatafile, getCustomDatafile } from "./buildDatafile";
import { buildScopedDatafile } from "./buildScopedDatafile";
import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";
import type { Scope } from "../config";

import type { DatafileContent } from "@featurevisor/types";
import { assertProjectSetJsonSelection, getProjectSetExecutions, printSetHeader } from "../sets";
import { CLI_COLOR_CYAN, CLI_FORMAT_BOLD, CLI_FORMAT_GREEN, colorize } from "../tester/cliFormat";

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

  tag?: string;
  scope?: string; // scope name only
  set?: string;
}

function getFeaturevisorVersion(): string {
  try {
    const cliPackage = require(require.resolve("@featurevisor/cli/package.json"));

    return cliPackage.version;
    // eslint-disable-next-line
  } catch (error) {
    return "unknown";
  }
}

function getEnvironmentLabel(environment: string | false) {
  return environment === false ? "No environment" : `Environment "${environment}"`;
}

async function buildForEnvironment({
  projectConfig,
  datasource,
  nextRevision,
  environment,
  tags,
  scopes,
  cliOptions,
}: {
  projectConfig: ProjectConfig;
  datasource: Datasource;
  nextRevision: string;
  environment: string | false;
  tags: string[];
  scopes?: Scope[];
  cliOptions: BuildCLIOptions;
}) {
  console.log("");
  console.log(CLI_FORMAT_BOLD, getEnvironmentLabel(environment));

  const existingState = await datasource.readState(environment);
  const featurevisorVersion = getFeaturevisorVersion();

  // by tag
  for (const tag of tags) {
    console.log(`  ${colorize("Tag", CLI_COLOR_CYAN)}: ${tag}`);

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
        featurevisorVersion,
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

  // by scope
  if (scopes) {
    for (const scope of scopes) {
      console.log(`  ${colorize("Scope", CLI_COLOR_CYAN)}: ${scope.name}`);

      const datafileContent = await buildDatafile(
        projectConfig,
        datasource,
        {
          schemaVersion: cliOptions.schemaVersion || SCHEMA_VERSION,
          revision: nextRevision,
          revisionFromHash: cliOptions.revisionFromHash,
          environment: environment,
          tag: scope.tag,
          tags: scope.tags,
          inflate: cliOptions.inflate,
          featurevisorVersion,
        },
        existingState,
      );

      const scopedDatafileContent = buildScopedDatafile(
        datafileContent as DatafileContent,
        scope.context,
      );

      // write scoped datafile
      await datasource.writeDatafile(scopedDatafileContent, {
        environment,
        tag: scope.tag,
        scope: scope,
        datafilesDir: cliOptions.datafilesDir,
      });
    }
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
    const scope = cliOptions.scope
      ? projectConfig.scopes?.find((scope) => scope.name === cliOptions.scope)
      : undefined;

    let datafileContent = await getCustomDatafile({
      featureKey: cliOptions.feature,
      environment: cliOptions.environment,
      projectConfig,
      datasource,
      revision: cliOptions.revision,
      schemaVersion: cliOptions.schemaVersion,
      tag: cliOptions.tag,
      tags: scope?.tags,
    });

    if (scope) {
      datafileContent = buildScopedDatafile(datafileContent as DatafileContent, scope.context);
    }

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
  console.log("");
  console.log(CLI_FORMAT_BOLD, "Building Featurevisor datafiles");
  console.log(`  Current revision: ${currentRevision}`);

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
        scopes,
        cliOptions,
      });
    }
  }

  // no environment
  if (!Array.isArray(environments)) {
    await buildForEnvironment({
      projectConfig,
      datasource,
      nextRevision,
      environment: false,
      tags,
      scopes,
      cliOptions,
    });
  }

  console.log("");
  console.log(CLI_FORMAT_GREEN, "Datafiles built");
  console.log(CLI_FORMAT_BOLD, `Latest revision: ${nextRevision}`);
}

export async function buildProjectSets(deps: Dependencies, cliOptions: BuildCLIOptions = {}) {
  const { projectConfig, datasource } = deps;

  assertProjectSetJsonSelection(projectConfig, cliOptions.set, cliOptions.json);

  const executions = await getProjectSetExecutions(projectConfig, datasource, cliOptions.set);
  const currentRevision = await datasource.readRevision();
  const nextRevision =
    (cliOptions.revision && cliOptions.revision.toString()) || getNextRevision(currentRevision);

  if (projectConfig.sets && !cliOptions.json) {
    console.log("");
    console.log(CLI_FORMAT_BOLD, "Building Featurevisor sets");
    console.log(`  Sets: ${executions.map((execution) => execution.set).join(", ")}`);
    console.log(`  Current project revision: ${currentRevision}`);
  }

  for (const execution of executions) {
    printSetHeader(projectConfig, execution.set, cliOptions.json);

    const executionCliOptions =
      projectConfig.sets && cliOptions.datafilesDir
        ? {
            ...cliOptions,
            datafilesDir: path.join(cliOptions.datafilesDir, execution.set),
          }
        : cliOptions;

    await buildProject(
      {
        ...deps,
        projectConfig: execution.projectConfig,
        datasource: execution.datasource,
      },
      {
        ...executionCliOptions,
        revision: projectConfig.sets ? nextRevision : cliOptions.revision,
      },
    );
  }

  if (
    projectConfig.sets &&
    !cliOptions.json &&
    (typeof cliOptions.stateFiles === "undefined" || cliOptions.stateFiles) &&
    !cliOptions.revision
  ) {
    await datasource.writeRevision(nextRevision);
    console.log("");
    console.log(CLI_FORMAT_GREEN, "Featurevisor sets built");
    console.log(CLI_FORMAT_BOLD, `Latest project revision: ${nextRevision}`);
  }
}

export const buildPlugin: Plugin = {
  command: "build",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    await buildProjectSets(
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
