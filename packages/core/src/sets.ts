import * as path from "path";

import type { ProjectConfig } from "./config";
import type { Datasource } from "./datasource";
import { FeaturevisorCLIError } from "./error";
import { CLI_FORMAT_BOLD } from "./tester/cliFormat";

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
    if (selectedSet !== undefined) {
      throw new FeaturevisorCLIError("This project does not configure Sets. Omit --set.", {
        code: "invalid_set",
        details: { set: selectedSet, available: [] },
      });
    }
    return [{ set: "", projectConfig, datasource }];
  }

  const availableSetKeys = await datasource.listSets();

  if (selectedSet !== undefined && !availableSetKeys.includes(selectedSet)) {
    throw new FeaturevisorCLIError(
      `Unknown set "${selectedSet}". Available sets: ${availableSetKeys.join(", ") || "none"}.`,
      { code: "invalid_set", details: { set: selectedSet, available: availableSetKeys } },
    );
  }

  const setKeys = selectedSet !== undefined ? [selectedSet] : availableSetKeys;

  if (setKeys.length === 0) {
    throw new FeaturevisorCLIError(`No sets found in ${projectConfig.setsDirectoryPath}.`, {
      code: "no_sets",
    });
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
    throw new FeaturevisorCLIError(
      "Pass --set=<set> when using --json in a project with sets enabled.",
      { code: "missing_set" },
    );
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
    console.log(CLI_FORMAT_BOLD, `Set "${set}"`);
  }
}
