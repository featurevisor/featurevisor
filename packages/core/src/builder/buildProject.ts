import * as path from "path";

import { ProjectConfig } from "../config";
import { Datasource } from "../datasource";

import { getNextRevision } from "./revision";
import { buildDatafile, getCustomDatafile } from "./buildDatafile";
import { applyContextToDatafile } from "./applyContextToDatafile";
import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";

import type { DatafileContent, Target } from "@featurevisor/types";
import { assertProjectSetJsonSelection, getProjectSetExecutions, printSetHeader } from "../sets";
import { CLI_COLOR_CYAN, CLI_FORMAT_BOLD, CLI_FORMAT_GREEN, colorize } from "../tester/cliFormat";
import { resolveTargets } from "../targeting";

export interface BuildCLIOptions {
  revision?: string;
  revisionFromHash?: boolean;

  // all three together
  environment?: string;
  feature?: string;
  json?: boolean;
  pretty?: boolean;
  stateFiles?: boolean; // --no-state-files in CLI
  inflate?: number;
  datafilesDir?: string;

  target?: string | string[];
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
  targets,
  cliOptions,
}: {
  projectConfig: ProjectConfig;
  datasource: Datasource;
  nextRevision: string;
  environment: string | false;
  targets: Array<Target & { key: string }>;
  cliOptions: BuildCLIOptions;
}) {
  console.log("");
  console.log(CLI_FORMAT_BOLD, getEnvironmentLabel(environment));

  const existingState = await datasource.readState(environment);
  const featurevisorVersion = getFeaturevisorVersion();

  for (const target of targets) {
    console.log(`  ${colorize("Target", CLI_COLOR_CYAN)}: ${target.key}`);

    const datafileContent = await buildTargetDatafile({
      projectConfig,
      datasource,
      target,
      environment,
      existingState,
      revision: nextRevision,
      revisionFromHash: cliOptions.revisionFromHash,
      inflate: cliOptions.inflate,
      featurevisorVersion,
    });

    await datasource.writeDatafile(datafileContent, {
      environment,
      target: target.key,
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

export async function buildTargetDatafile({
  projectConfig,
  datasource,
  target,
  environment,
  existingState,
  revision,
  revisionFromHash,
  inflate,
  featurevisorVersion,
}: {
  projectConfig: ProjectConfig;
  datasource: Datasource;
  target: Target;
  environment: string | false;
  existingState: Awaited<ReturnType<Datasource["readState"]>>;
  revision: string;
  revisionFromHash?: boolean;
  inflate?: number;
  featurevisorVersion?: string;
}): Promise<DatafileContent> {
  const datafileContent = await buildDatafile(
    projectConfig,
    datasource,
    {
      revision,
      revisionFromHash,
      environment,
      tag: target.tag,
      tags: target.tags,
      includeFeatures: target.includeFeatures,
      excludeFeatures: target.excludeFeatures,
      inflate,
      featurevisorVersion,
    },
    existingState,
  );

  if (target.context) {
    return applyContextToDatafile(datafileContent as DatafileContent, target.context);
  }

  return datafileContent as DatafileContent;
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
  if (cliOptions.json) {
    const environment = cliOptions.environment || false;

    if (Array.isArray(projectConfig.environments) && !cliOptions.environment) {
      throw new Error("Pass --environment=<environment> when printing a datafile.");
    }

    const targets = await resolveTargets(datasource, cliOptions.target, {
      defaultToAll: false,
      requireTargets: false,
    });
    if (targets.length > 1) {
      throw new Error("Only one --target can be used with --json or --print.");
    }
    const target = targets[0];

    let datafileContent = await getCustomDatafile({
      featureKey: cliOptions.feature,
      environment,
      projectConfig,
      datasource,
      revision: cliOptions.revision,
      inflate: cliOptions.inflate,
      tag: target?.tag,
      tags: target?.tags,
      includeFeatures: target?.includeFeatures,
      excludeFeatures: target?.excludeFeatures,
      featurevisorVersion: getFeaturevisorVersion(),
    });

    if (target?.context) {
      datafileContent = applyContextToDatafile(datafileContent as DatafileContent, target.context);
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
  const { environments } = projectConfig;
  const targets = await resolveTargets(datasource, cliOptions.target);

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
        targets,
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
      targets,
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
    if (parsed.print) {
      parsed.json = true;
    }

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
      description: "build datafiles for all environments and targets",
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
      command: "build --print --environment=production --feature=featureKey --target=web",
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
