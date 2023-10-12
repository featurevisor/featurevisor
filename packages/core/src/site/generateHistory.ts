import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

import { HistoryEntry } from "@featurevisor/types";

import { ProjectConfig } from "../config";

import { getRelativePaths } from "./getRelativePaths";

export function generateHistory(rootDirectoryPath, projectConfig: ProjectConfig): HistoryEntry[] {
  try {
    // raw history
    const rawHistoryFilePath = path.join(projectConfig.siteExportDirectoryPath, "history-raw.txt");

    const { relativeFeaturesPath, relativeSegmentsPath, relativeAttributesPath } = getRelativePaths(
      rootDirectoryPath,
      projectConfig,
    );

    const separator = "|";

    const cmd = `git log --name-only --pretty=format:"%h${separator}%an${separator}%aI" --no-merges --relative -- ${relativeFeaturesPath} ${relativeSegmentsPath} ${relativeAttributesPath} > ${rawHistoryFilePath}`;
    execSync(cmd);

    console.log(`History (raw) generated at: ${rawHistoryFilePath}`);

    // structured history
    const rawHistory = fs.readFileSync(rawHistoryFilePath, "utf8");

    const fullHistory: HistoryEntry[] = [];

    let entry: HistoryEntry = {
      commit: "",
      author: "",
      timestamp: "",
      entities: [],
    };

    rawHistory.split("\n").forEach((line, index) => {
      if (index === 0 && line.length === 0) {
        // no history found
        return;
      }

      if (index > 0 && line.length === 0) {
        // commit finished
        fullHistory.push(entry);

        return;
      }

      if (line.indexOf(separator) > -1) {
        // commit line
        const parts = line.split("|");

        entry = {
          commit: parts[0],
          author: parts[1],
          timestamp: parts[2],
          entities: [],
        };
      } else {
        // file line
        const lineSplit = line.split(path.sep);
        const fileName = lineSplit.pop() as string;
        const relativeDir = lineSplit.join(path.sep);

        const key = fileName.replace("." + projectConfig.parser, "");

        let type = "feature" as "attribute" | "segment" | "feature";

        if (relativeDir === relativeSegmentsPath) {
          type = "segment";
        } else if (relativeDir === relativeAttributesPath) {
          type = "attribute";
        }

        entry.entities.push({
          type,
          key,
        });
      }
    });

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
