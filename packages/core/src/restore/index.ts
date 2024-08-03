import * as path from "path";
import { execSync } from "child_process";

import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";

export async function restoreProject(deps: Dependencies) {
  const { rootDirectoryPath, projectConfig } = deps;

  const relativeStateDirPath = path.relative(rootDirectoryPath, projectConfig.stateDirectoryPath);
  const cmd = `git checkout -- ${relativeStateDirPath}${path.sep}`;

  try {
    execSync(cmd, {
      cwd: rootDirectoryPath,
    });

    console.log("State files restored successfully.");
  } catch (e) {
    console.log("error:", e.message);

    throw new Error("Failed to restore state files.");
  }
}

export const restorePlugin: Plugin = {
  command: "restore",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    return restoreProject({
      rootDirectoryPath,
      projectConfig,
      datasource,
      options: parsed,
    });
  },
  examples: [
    {
      command: "restore",
      description: "restore state files",
    },
  ],
};
