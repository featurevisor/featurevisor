import * as path from "path";

import { SCHEMA_VERSION } from "../config";

import { buildDatafile, getCustomDatafile } from "./buildDatafile";
import { Dependencies } from "../dependencies";

export interface BuildCLIOptions {
  revision?: string;

  // all three together
  environment?: string;
  feature?: string;
  print?: boolean;
  pretty?: boolean;
}

export async function buildProject(deps: Dependencies, cliOptions: BuildCLIOptions = {}) {
  const { rootDirectoryPath, projectConfig, datasource } = deps;

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
  const tags = projectConfig.tags;
  const environments = projectConfig.environments;

  const pkg = require(path.join(rootDirectoryPath, "package.json"));

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
          revision: cliOptions.revision || pkg.version,
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

    // write state for environment
    await datasource.writeState(environment, existingState);
  }
}
