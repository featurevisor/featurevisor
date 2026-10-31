import * as fs from "node:fs";
import * as path from "node:path";

import {
  ATTRIBUTES_DIRECTORY_NAME,
  FEATURES_DIRECTORY_NAME,
  SCHEMAS_DIRECTORY_NAME,
  SEGMENTS_DIRECTORY_NAME,
  TARGETS_DIRECTORY_NAME,
  TESTS_DIRECTORY_NAME,
  VARIABLES_DIRECTORY_NAME,
} from "../config/projectConfig";

/** The kinds of definition file a project has, as the commands that rewrite them read them */
export type Kind = "attribute" | "schema" | "segment" | "feature" | "variable" | "target" | "test";

/** Each kind with the setting naming its directory, and the directory's default name */
export const KINDS: [Kind, string, string][] = [
  ["attribute", "attributesDirectoryPath", ATTRIBUTES_DIRECTORY_NAME],
  ["schema", "schemasDirectoryPath", SCHEMAS_DIRECTORY_NAME],
  ["segment", "segmentsDirectoryPath", SEGMENTS_DIRECTORY_NAME],
  ["feature", "featuresDirectoryPath", FEATURES_DIRECTORY_NAME],
  ["variable", "variablesDirectoryPath", VARIABLES_DIRECTORY_NAME],
  ["target", "targetsDirectoryPath", TARGETS_DIRECTORY_NAME],
  ["test", "testsDirectoryPath", TESTS_DIRECTORY_NAME],
];

/** Every file with the extension under a directory, at any depth and sorted, skipping dot files */
export function filesIn(directory: string, extension: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .flatMap((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return filesIn(fullPath, extension);
      return entry.name.endsWith(`.${extension}`) ? [fullPath] : [];
    })
    .sort();
}
