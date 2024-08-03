import * as fs from "fs";
import * as path from "path";

import { CONFIG_MODULE_NAME, getProjectConfig, Datasource, runCLI } from "@featurevisor/core";

process.on("unhandledRejection", (reason) => {
  console.error(reason);
  process.exit(1);
});

async function main() {
  const rootDirectoryPath = process.cwd();
  const useRootDirectoryPath = rootDirectoryPath; // @TODO: see if can get it from CLI args if overridden

  const configModulePath = path.join(rootDirectoryPath, CONFIG_MODULE_NAME);
  if (!fs.existsSync(configModulePath)) {
    // not an existing project
    await runCLI({ rootDirectoryPath: useRootDirectoryPath });
  } else {
    // existing project
    const projectConfig = getProjectConfig(useRootDirectoryPath);
    const datasource = new Datasource(projectConfig, useRootDirectoryPath);

    await runCLI({
      rootDirectoryPath: useRootDirectoryPath,
      projectConfig,
      datasource,
    });
  }
}

main();
