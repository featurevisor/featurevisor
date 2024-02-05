import * as path from "path";
import * as fs from "fs";

import { HistoryEntry } from "@featurevisor/types";
import { Dependencies } from "../dependencies";

export async function generateHistory(deps: Dependencies): Promise<HistoryEntry[]> {
  const { projectConfig, datasource } = deps;

  try {
    const fullHistory = await datasource.listHistoryEntries();

    const filteredHistory = fullHistory
      .map((historyEntry) => {
        return {
          ...historyEntry,
          entities: historyEntry.entities.filter((entity) => {
            // ignore test specs
            return entity.type !== "test";
          }),
        };
      })
      .filter((historyEntry) => historyEntry.entities.length > 0);

    const fullHistoryFilePath = path.join(
      projectConfig.siteExportDirectoryPath,
      "history-full.json",
    );
    fs.writeFileSync(fullHistoryFilePath, JSON.stringify(filteredHistory));
    console.log(`History (full) generated at: ${fullHistoryFilePath}`);

    return filteredHistory;
  } catch (error) {
    console.error(
      `Error when generating history from git: ${error.status}\n${error.stderr.toString()}`,
    );

    return [];
  }
}
