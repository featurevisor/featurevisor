import * as path from "path";

import type { ProjectConfig } from "./config";
import type { Datasource } from "./datasource";

export interface ProjectSetExecution {
  set: string;
  projectConfig: ProjectConfig;
  datasource: Datasource;
}

export async function getProjectSetExecutions(
  projectConfig: ProjectConfig,
  datasource: Datasource,
  selectedSet?: string,
): Promise<ProjectSetExecution[]> {
  if (!projectConfig.sets) {
    return [{ set: "", projectConfig, datasource }];
  }

  const availableSetKeys = await datasource.listSets();

  if (selectedSet && !availableSetKeys.includes(selectedSet)) {
    throw new Error(
      `Unknown set "${selectedSet}". Available sets: ${availableSetKeys.join(", ") || "none"}.`,
    );
  }

  const setKeys = selectedSet ? [selectedSet] : availableSetKeys;

  if (setKeys.length === 0) {
    throw new Error(`No sets found in ${projectConfig.setsDirectoryPath}.`);
  }

  return setKeys.map((set) => {
    const setDatasource = datasource.forSet(set);

    return {
      set,
      projectConfig: setDatasource.getConfig(),
      datasource: setDatasource,
    };
  });
}

export function assertProjectSetJsonSelection(
  projectConfig: ProjectConfig,
  selectedSet: string | undefined,
  json: boolean | undefined,
) {
  if (projectConfig.sets && json && !selectedSet) {
    throw new Error("Pass --set=<set> when using --json in a project with sets enabled.");
  }
}

export function getProjectSetRelativeFilePath(
  projectConfig: ProjectConfig,
  set: string,
  filePath: string,
) {
  const setDirectoryPath = path.join(projectConfig.setsDirectoryPath, set);

  if (filePath === setDirectoryPath || filePath.startsWith(`${setDirectoryPath}${path.sep}`)) {
    return filePath;
  }

  return path.join(setDirectoryPath, filePath);
}

export function printSetHeader(projectConfig: ProjectConfig, set: string, silent = false) {
  if (projectConfig.sets && !silent) {
    console.log("");
    console.log(`Set "${set}"`);
  }
}
