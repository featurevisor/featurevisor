import * as path from "path";
import * as fs from "fs";

import { HistoryEntry } from "@featurevisor/types";
import { Dependencies } from "../dependencies";

export async function generateHistory(deps: Dependencies): Promise<HistoryEntry[]> {
  const { projectConfig, datasource } = deps;

  try {
    const fullHistory = await datasource.listHistoryEntries();

    const fullHistoryFilePath = path.join(
      projectConfig.siteExportDirectoryPath,
      "history-full.json",
    );
    fs.writeFileSync(fullHistoryFilePath, JSON.stringify(fullHistory));
    console.log(`History (full) generated at: ${fullHistoryFilePath}`);

    return fullHistory;
  } catch (error) {
    console.error(
      `Error when generating history from git: ${error.status}\n${error.stderr.toString()}`,
    );

    return [];
  }
}
