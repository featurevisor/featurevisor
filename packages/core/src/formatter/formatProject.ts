import * as fs from "node:fs";
import * as path from "node:path";

import type { EntityType } from "@featurevisor/types";
import type { ExpressionOptions } from "@featurevisor/expressions";
import type { CustomParser } from "@featurevisor/parsers";

import type { ProjectConfig } from "../config";
import type { Datasource } from "../datasource";
import { FeaturevisorCLIError } from "../error";
import { getProjectSetExecutions } from "../sets";
import {
  canFormat,
  FormatGuardError,
  FormatParseError,
  formatDefinition,
} from "./formatDefinition";
import { getFormatExpressionOptions } from "./expressions";
import { FORMAT_ENTITY_TYPES } from "./layout";
import { getChangedFiles } from "./since";
import { unifiedDiff } from "../rewrite/diff";

export interface FormatProjectOptions {
  /** Report files that need formatting without writing them */
  check?: boolean;
  /** Print what would change as a unified diff, without writing */
  diff?: boolean;
  entityType?: EntityType;
  keyPattern?: RegExp;
  /** Only these files, or the files in these directories, absolute or relative to the working directory */
  paths?: string[];
  /** Only files changed since HEAD left this Git reference, uncommitted and untracked ones too */
  since?: string;
  /** Only this Set, in a project with Sets. Without it, every Set is formatted in one run. */
  set?: string;
  /** Format this source as the file at `filePath`, reading and writing no files, for editors */
  stdin?: { filePath: string; source: string };
}

export interface FormatFileResult {
  /** The Set the file belongs to, in a project with Sets */
  set?: string;
  entityType: EntityType;
  key: string;
  /** Relative to the working directory */
  filePath: string;
  /**
   * `declined` when the parser's format left the file as it is, and `ignored` when the file
   * asks to be left as it is
   */
  status: "unchanged" | "changed" | "declined" | "ignored" | "error";
  error?: {
    code: "parse_error" | "format_guard" | "missing_file";
    message: string;
    line?: number;
    column?: number;
  };
  diff?: string;
  /** The formatted source, when formatting the source given on stdin */
  output?: string;
}

export interface FormatProjectResult {
  files: FormatFileResult[];
  /** Paths given that hold no definition of this project */
  skipped: string[];
  changed: number;
  declined: number;
  ignored: number;
  errors: number;
  /** The project's parser has no `format`, so its files were left as they are */
  unsupported?: boolean;
}

interface Dependencies {
  rootDirectoryPath: string;
  projectConfig: ProjectConfig;
  datasource: Datasource;
}

interface WantedPath {
  absolute: string;
  directory: boolean;
  matched: boolean;
}

const LIST_KEYS: Record<EntityType, (datasource: Datasource) => Promise<string[]>> = {
  attribute: (datasource) => datasource.listAttributes(),
  schema: (datasource) => datasource.listSchemas(),
  segment: (datasource) => datasource.listSegments(),
  feature: (datasource) => datasource.listFeatures(),
  variable: (datasource) => datasource.listVariables(),
  target: (datasource) => datasource.listTargets(),
  test: (datasource) => datasource.listTests(),
  scenario: (datasource) => datasource.listScenarios(),
};

function relative(filePath: string) {
  return path.relative(process.cwd(), filePath) || filePath;
}

function toWantedPath(given: string): WantedPath {
  const absolute = path.resolve(given);
  const directory = fs.existsSync(absolute) && fs.statSync(absolute).isDirectory();
  return { absolute, directory, matched: false };
}

function isWanted(wanted: WantedPath, filePath: string) {
  return wanted.directory
    ? filePath.startsWith(
        wanted.absolute.endsWith(path.sep) ? wanted.absolute : wanted.absolute + path.sep,
      )
    : filePath === wanted.absolute;
}

function toFileError(error: unknown): FormatFileResult["error"] {
  if (error instanceof FormatParseError) {
    return { code: "parse_error", message: error.message, line: error.line, column: error.column };
  }
  // a guard caught a fault in the parser's format, which is never the author's
  const message =
    error instanceof FormatGuardError
      ? `${error.message} The file was left as it is. Please report this.`
      : (error as Error).message;
  return { code: "format_guard", message };
}

/** Formats one file, writing it only when it changes and fmt is neither checking nor diffing */
function formatFile(
  file: FormatFileResult,
  parser: CustomParser,
  options: FormatProjectOptions,
  expressions: ExpressionOptions | undefined,
): FormatFileResult["status"] {
  const filePath = path.resolve(file.filePath);
  if (!options.stdin && !fs.existsSync(filePath)) {
    file.error = { code: "missing_file", message: "File not found" };
    return "error";
  }

  const source = options.stdin ? options.stdin.source : fs.readFileSync(filePath, "utf8");
  try {
    const { output, changed, declined, ignored } = formatDefinition(
      file.entityType,
      source,
      parser,
      filePath,
      { expressions },
    );
    if (options.stdin) file.output = output;
    if (ignored) return "ignored";
    if (declined) return "declined";
    if (!changed) return "unchanged";
    if (options.diff) file.diff = unifiedDiff(file.filePath, file.filePath, source, output);
    if (!options.stdin && !options.check && !options.diff) fs.writeFileSync(filePath, output);
    return "changed";
  } catch (error) {
    file.error = toFileError(error);
    return "error";
  }
}

/** Every definition file of the project, once each, across every Set unless one is picked */
async function* listDefinitionFiles(
  deps: Dependencies,
  options: FormatProjectOptions,
): AsyncGenerator<FormatFileResult & { absolute: string }> {
  const { projectConfig, datasource } = deps;
  const entityTypes = options.entityType ? [options.entityType] : FORMAT_ENTITY_TYPES;
  const executions = await getProjectSetExecutions(projectConfig, datasource, options.set);
  const seen = new Set<string>();

  for (const execution of executions) {
    for (const entityType of entityTypes) {
      const keys = await LIST_KEYS[entityType](execution.datasource);

      for (const key of keys) {
        if (options.keyPattern && !options.keyPattern.test(key)) continue;

        const filePath = execution.datasource.getEntitySourcePath(entityType, key);
        if (!filePath) {
          throw new FeaturevisorCLIError(
            "fmt needs definitions stored as files. This project's datasource adapter does not expose file paths.",
            { code: "unsupported_adapter" },
          );
        }

        const absolute = path.resolve(filePath);
        if (seen.has(absolute)) continue;
        seen.add(absolute);

        yield {
          ...(projectConfig.sets ? { set: execution.set } : {}),
          entityType,
          key,
          filePath: relative(filePath),
          status: "unchanged",
          absolute,
        };
      }
    }
  }
}

/**
 * Formats every definition file of a project in one run: attributes, schemas, segments,
 * features, variables, targets, tests and scenarios, across every Set unless one is picked.
 * Writes only files that change, unless checking or diffing. Given source on stdin, formats it
 * as the file at its path instead, and writes nothing.
 */
export async function formatProject(
  deps: Dependencies,
  options: FormatProjectOptions = {},
): Promise<FormatProjectResult> {
  const result: FormatProjectResult = {
    files: [],
    skipped: [],
    changed: 0,
    declined: 0,
    ignored: 0,
    errors: 0,
  };

  const parser = deps.projectConfig.parser as CustomParser;
  if (!canFormat(parser)) return { ...result, unsupported: true };
  const expressions = getFormatExpressionOptions(deps.projectConfig);

  const paths = options.stdin ? [options.stdin.filePath] : options.paths || [];
  const wanted = paths.map(toWantedPath);
  const changedFiles =
    options.since === undefined
      ? undefined
      : getChangedFiles(deps.rootDirectoryPath, options.since);

  for await (const { absolute, ...file } of listDefinitionFiles(deps, options)) {
    if (wanted.length > 0) {
      const matches = wanted.filter((item) => isWanted(item, absolute));
      if (matches.length === 0) continue;
      matches.forEach((item) => (item.matched = true));
    }
    // Git gives real paths, which a project reached through a symbolic link, or a Windows
    // short name such as RUNNER~1, differs from
    if (changedFiles && !changedFiles.has(fs.realpathSync.native(absolute))) continue;

    file.status = formatFile(file, parser, options, expressions);
    result.files.push(file);
  }

  const count = (status: FormatFileResult["status"]) =>
    result.files.filter((file) => file.status === status).length;
  result.changed = count("changed");
  result.declined = count("declined");
  result.ignored = count("ignored");
  result.errors = count("error");
  result.skipped = wanted.filter((item) => !item.matched).map((item) => relative(item.absolute));
  return result;
}
