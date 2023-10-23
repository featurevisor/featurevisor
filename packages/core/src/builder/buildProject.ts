import * as path from "path";

import { SCHEMA_VERSION } from "../config";

import { buildDatafile } from "./buildDatafile";
import { Dependencies } from "../dependencies";

export interface BuildCLIOptions {
  revision?: string;
}

export async function buildProject(deps: Dependencies, cliOptions: BuildCLIOptions = {}) {
  const { rootDirectoryPath, projectConfig, datasource } = deps;

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
