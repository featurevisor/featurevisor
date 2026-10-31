import * as fs from "node:fs";
import * as path from "node:path";

import { parsers, type CustomParser } from "@featurevisor/parsers";

import {
  CONFIG_MODULE_NAME,
  ROOT_DIR_PLACEHOLDER,
  SETS_DIRECTORY_NAME,
} from "../config/projectConfig";
import { filesIn, KINDS, type Kind } from "../rewrite/files";

/**
 * A v3 project as migration reads it. The v4 configuration loader rejects v3 settings, so this
 * reads featurevisor.config.js directly and finds the definition files by their directories.
 */

export interface DefinitionFile {
  kind: Kind;
  /** The Set it belongs to, in a project with Sets */
  set?: string;
  filePath: string;
}

export interface Project {
  rootDirectoryPath: string;
  parser: CustomParser;
  files: DefinitionFile[];
  config: { filePath: string; source: string; migrated: string; changes: string[] };
  /** Problems that stop migration before anything is written */
  blockers: { message: string; section: string }[];
  /** Attribute files v4 rejects for where they are */
  nestedAttributes: string[];
}

function requireFresh(filePath: string): Record<string, unknown> {
  const resolved = require.resolve(filePath);
  delete require.cache[resolved];
  try {
    return require(resolved);
  } finally {
    delete require.cache[resolved];
  }
}

/** The config text with the v3 settings v4 renamed or rejects rewritten, when that is safe */
function migrateConfigSource(source: string): { migrated: string; changes: string[] } {
  const changes: string[] = [];
  let migrated = source;
  if (/\ballowFeatureAndGlobalVariableKeyCollisions\b/.test(migrated)) {
    migrated = migrated.replace(
      /\ballowFeatureAndGlobalVariableKeyCollisions\b/g,
      "allowFeatureAndVariableKeyCollisions",
    );
    changes.push("allowFeatureAndVariableKeyCollisions");
  }
  const emptyEnvironments = /^[ \t]*environments\s*:\s*\[\s*\]\s*,?[ \t]*\r?\n/m;
  if (emptyEnvironments.test(migrated)) {
    migrated = migrated.replace(emptyEnvironments, "");
    changes.push("environments");
  }
  return { migrated, changes };
}

export function readProject(rootDirectoryPath: string): Project {
  const configPath = path.join(rootDirectoryPath, CONFIG_MODULE_NAME);
  const source = fs.readFileSync(configPath, "utf8");
  const config = requireFresh(configPath);
  const blockers: Project["blockers"] = [];

  let parser: CustomParser = parsers.yml;
  if (typeof config.parser === "string") {
    if (parsers[config.parser]) parser = parsers[config.parser];
    else
      blockers.push({
        message: `Unknown parser: ${config.parser}.`,
        section: "upgrade-the-project",
      });
  } else if (config.parser) {
    parser = config.parser as CustomParser;
    if (typeof parser.stringify !== "function") {
      blockers.push({
        message:
          "The custom parser has no stringify function, which v4 needs to write definitions, and migration to write them. Add one first.",
        section: "custom-parsers-must-support-writing",
      });
    }
  }

  const directory = (key: string, name: string) =>
    typeof config[key] === "string"
      ? (config[key] as string).replace(ROOT_DIR_PLACEHOLDER, rootDirectoryPath)
      : path.join(rootDirectoryPath, name);

  // the configured directories, or each Set's own
  const roots: {
    set?: string;
    directory: (key: string, name: string) => string;
    groups: string;
  }[] = [];
  if (config.sets === true) {
    const setsDirectory = directory("setsDirectoryPath", SETS_DIRECTORY_NAME);
    const sets = fs.existsSync(setsDirectory)
      ? fs
          .readdirSync(setsDirectory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
      : [];
    for (const set of sets) {
      roots.push({
        set,
        directory: (_, name) => path.join(setsDirectory, set, name),
        groups: path.join(setsDirectory, set, "groups"),
      });
    }
  } else {
    roots.push({ directory, groups: path.join(rootDirectoryPath, "groups") });
  }

  const groups = roots
    .flatMap((root) => filesIn(root.groups, parser.extension))
    .map((group) => path.relative(rootDirectoryPath, group));
  if (typeof config.groupsDirectoryPath === "string") {
    groups.push(`groupsDirectoryPath in ${CONFIG_MODULE_NAME}`);
  }
  if (groups.length > 0) {
    blockers.push({
      message: `Groups were removed in v4, and this project still has them: ${groups.join(", ")}. Convert them with the v3 CLI and publish their datafiles first.`,
      section: "groups-removed",
    });
  }

  const files: DefinitionFile[] = [];
  const nestedAttributes: string[] = [];
  for (const root of roots) {
    for (const [kind, key, name] of KINDS) {
      const base = root.directory(key, name);
      for (const filePath of filesIn(base, parser.extension)) {
        files.push({ kind, ...(root.set ? { set: root.set } : {}), filePath });
        const relative = path.relative(base, filePath);
        if (
          kind === "attribute" &&
          (relative.includes(path.sep) ||
            path.basename(relative, `.${parser.extension}`).includes("."))
        ) {
          nestedAttributes.push(filePath);
        }
      }
    }
  }

  return {
    rootDirectoryPath,
    parser,
    files,
    config: { filePath: configPath, source, ...migrateConfigSource(source) },
    blockers,
    nestedAttributes,
  };
}
