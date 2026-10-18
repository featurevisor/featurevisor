import * as path from "path";

import type { Commit, EntityDiff, EntityType, HistoryEntity } from "@featurevisor/types";
import { CustomParser } from "@featurevisor/parsers";

import { ProjectConfig } from "../config";
import { isScenarioSpec, testSpecKeyFromStorageKey } from "../datasource/testSpecs";

interface HistoryOptions {
  rootDirectoryPath: string;
  projectConfig: ProjectConfig;
}

export function getHistoryEntity(
  file: string,
  { rootDirectoryPath, projectConfig }: HistoryOptions,
  namespaceCharacter = "/",
): HistoryEntity | undefined {
  const absolutePath = path.resolve(rootDirectoryPath, file);
  const extension = "." + (projectConfig.parser as CustomParser).extension;
  if (!absolutePath.endsWith(extension)) return;

  const directories: Array<[EntityType, string]> = [
    ["attribute", projectConfig.attributesDirectoryPath],
    ["segment", projectConfig.segmentsDirectoryPath],
    ["feature", projectConfig.featuresDirectoryPath],
    ["schema", projectConfig.schemasDirectoryPath],
    ["variable", projectConfig.variablesDirectoryPath],
    ["target", projectConfig.targetsDirectoryPath],
    ["test", projectConfig.testsDirectoryPath],
  ];
  for (const [type, directory] of directories) {
    if (!isWithinDirectory(directory, path.dirname(absolutePath))) continue;
    return {
      type,
      key: path
        .relative(directory, absolutePath)
        .slice(0, -extension.length)
        .split(path.sep)
        .join(namespaceCharacter),
    };
  }
}

function unquoteGitPath(value: string): string {
  return value.startsWith('"') ? JSON.parse(value) : value;
}

function isWithinDirectory(directoryPath: string, fileDirectoryPath: string): boolean {
  return (
    fileDirectoryPath === directoryPath || fileDirectoryPath.startsWith(directoryPath + path.sep)
  );
}

function parseGitCommitShowOutput(gitShowOutput: string) {
  const result = {
    hash: "",
    author: "",
    date: "",
    message: "",
    diffs: {},
  };

  const lines = gitShowOutput.split("\n");
  let currentFile = "";
  let parsingDiffs = false;
  let parsingMessage = false;

  lines.forEach((line) => {
    if (line.startsWith("commit ")) {
      result.hash = line.replace("commit ", "").trim();
    } else if (line.startsWith("Author:")) {
      result.author = line.replace("Author:", "").trim();
      parsingMessage = false;
    } else if (line.startsWith("Date:")) {
      result.date = line.replace("Date:", "").trim();
      parsingMessage = true; // Start parsing commit message
    } else if (line.startsWith("diff --git")) {
      if (currentFile) {
        // Finish capturing the previous file's diff
        parsingDiffs = false;
      }
      const paths = /^diff --git ("a\/.*"|a\/.*?) ("b\/.*"|b\/.*)$/.exec(line);
      currentFile = paths ? unquoteGitPath(paths[1]).substring(2) : "";
      result.diffs[currentFile] = line + "\n"; // Include the diff --git line
      parsingDiffs = true;
      parsingMessage = false; // Stop parsing commit message
    } else if (parsingDiffs) {
      result.diffs[currentFile] += line + "\n";
    } else if (parsingMessage && line.trim() !== "") {
      result.message += line.trim() + "\n"; // Capture commit message
    }
  });

  return result;
}

function analyzeFileChange(diff) {
  let status = "updated"; // Default to 'updated'

  // Check for file creation or deletion
  if (diff.includes("new file mode")) {
    status = "created";
  } else if (diff.includes("deleted file mode")) {
    status = "deleted";
  }

  return status;
}

export function getCommit(
  gitShowOutput: string,
  options: HistoryOptions & {
    readTestSpec?: (revision: string, filePath: string) => unknown;
  },
): Commit {
  const parsed = parseGitCommitShowOutput(gitShowOutput);

  const commit: Commit = {
    hash: parsed.hash,
    author: parsed.author,
    timestamp: parsed.date,
    entities: [],
  };

  Object.keys(parsed.diffs).forEach((file) => {
    const diff = parsed.diffs[file];
    const status = analyzeFileChange(diff);

    const renamedTo = /^rename to (.+)$/m.exec(diff)?.[1];
    const changes = renamedTo
      ? [
          { file, status: "deleted" },
          { file: unquoteGitPath(renamedTo), status: "created" },
        ]
      : [{ file, status }];

    for (const change of changes) {
      const entity = getHistoryEntity(change.file, options);
      if (!entity) continue;
      if (entity.type === "test" && options.readTestSpec) {
        const readKind = (revision: string): EntityType | undefined => {
          try {
            const value = options.readTestSpec!(revision, change.file);
            if (typeof value === "undefined") return;
            return isScenarioSpec(value) ? "scenario" : "test";
          } catch {
            // A diff alone cannot classify unreadable historical content. Keep the test change.
            return "test";
          }
        };
        const before = change.status !== "created" ? readKind(`${parsed.hash}^`) : undefined;
        const after = change.status !== "deleted" ? readKind(parsed.hash) : undefined;
        if (before && after && before !== after) {
          commit.entities.push(
            {
              ...entity,
              type: before,
              key: testSpecKeyFromStorageKey(entity.key),
              content: diff,
              deleted: true,
            },
            {
              ...entity,
              type: after,
              key: testSpecKeyFromStorageKey(entity.key),
              content: diff,
              created: true,
            },
          );
          continue;
        }
        entity.type = after || before || "test";
        entity.key = testSpecKeyFromStorageKey(entity.key);
      }
      const entityDiff: EntityDiff = { ...entity, content: diff };
      if (change.status === "created") entityDiff.created = true;
      else if (change.status === "deleted") entityDiff.deleted = true;
      else entityDiff.updated = true;
      commit.entities.push(entityDiff);
    }
  });

  return commit;
}
