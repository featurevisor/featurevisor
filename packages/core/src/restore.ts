import * as path from "path";
import { execSync } from "child_process";

import { ProjectConfig } from "./config";

export function restoreProject(rootDirectoryPath, projectConfig: ProjectConfig) {
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
