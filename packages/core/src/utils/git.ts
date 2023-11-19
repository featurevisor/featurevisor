import * as path from "path";

import { Commit, EntityDiff, EntityType } from "@featurevisor/types";

import { CustomParser, ProjectConfig } from "../config";

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
      currentFile = line.split(" ")[2].substring(2);
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
  options: { rootDirectoryPath: string; projectConfig: ProjectConfig },
): Commit {
  const parsed = parseGitCommitShowOutput(gitShowOutput);
  const { rootDirectoryPath, projectConfig } = options;

  const commit: Commit = {
    hash: parsed.hash,
    author: parsed.author,
    timestamp: parsed.date,
    entities: [],
  };

  Object.keys(parsed.diffs).forEach((file) => {
    const diff = parsed.diffs[file];
    const status = analyzeFileChange(diff);

    const absolutePath = path.join(rootDirectoryPath, file);
    const relativeDir = path.dirname(absolutePath);

    // get entity type
    let type: EntityType = "attribute";
    if (relativeDir === projectConfig.attributesDirectoryPath) {
      type = "attribute";
    } else if (relativeDir === projectConfig.segmentsDirectoryPath) {
      type = "segment";
    } else if (relativeDir === projectConfig.featuresDirectoryPath) {
      type = "feature";
    } else if (relativeDir === projectConfig.groupsDirectoryPath) {
      type = "group";
    } else if (relativeDir === projectConfig.testsDirectoryPath) {
      type = "test";
    } else {
      // unknown type
      return;
    }

    // get entity key
    const fileName = absolutePath.split(path.sep).pop() as string;
    const extensionWithDot = "." + (projectConfig.parser as CustomParser).extension;

    if (!fileName.endsWith(extensionWithDot)) {
      // unknown extension
      return;
    }

    const key = fileName.replace(extensionWithDot, "");

    const entityDiff: EntityDiff = {
      type,
      key,
      content: diff,
    };

    if (status === "created") {
      entityDiff.created = true;
    } else if (status === "deleted") {
      entityDiff.deleted = true;
    } else {
      entityDiff.updated = true;
    }

    commit.entities.push(entityDiff);
  });

  return commit;
}
