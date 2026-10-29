import * as fs from "node:fs";
import * as path from "node:path";

import type { EntityType } from "@featurevisor/types";
import type { CustomParser } from "@featurevisor/parsers";

import type { ProjectConfig } from "../config";
import type { Datasource } from "../datasource";
import { FeaturevisorCLIError } from "../error";
import { getProjectSetExecutions } from "../sets";
import {
  CLI_FORMAT_DIM,
  CLI_FORMAT_GREEN,
  CLI_FORMAT_RED,
  CLI_FORMAT_YELLOW,
} from "../tester/cliFormat";
import {
  canFormat,
  FormatGuardError,
  FormatParseError,
  formatDefinition,
} from "./formatDefinition";
import { FORMAT_ENTITY_TYPES } from "./layout";
import { unifiedDiff } from "./unifiedDiff";

export interface FormatProjectOptions {
  /** Report files that need formatting without writing them */
  check?: boolean;
  /** Print what would change as a unified diff, without writing */
  diff?: boolean;
  entityType?: EntityType;
  keyPattern?: RegExp;
  /** Only these files, or the files in these directories, absolute or relative to the working directory */
  paths?: string[];
  /** Only this Set, in a project with Sets. Without it, every Set is formatted in one run. */
  set?: string;
  json?: boolean;
}

export interface FormatFileResult {
  /** The Set the file belongs to, in a project with Sets */
  set?: string;
  entityType: EntityType;
  key: string;
  /** Relative to the working directory */
  filePath: string;
  /** `declined` when the parser's format left the file as it is */
  status: "unchanged" | "changed" | "declined" | "error";
  error?: {
    code: "parse_error" | "format_guard" | "missing_file";
    message: string;
    line?: number;
    column?: number;
  };
  diff?: string;
}

export interface FormatProjectResult {
  files: FormatFileResult[];
  /** Paths given that hold no definition of this project */
  skipped: string[];
  changed: number;
  declined: number;
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

function listKeys(datasource: Datasource, entityType: EntityType): Promise<string[]> {
  switch (entityType) {
    case "attribute":
      return datasource.listAttributes();
    case "schema":
      return datasource.listSchemas();
    case "segment":
      return datasource.listSegments();
    case "feature":
      return datasource.listFeatures();
    case "variable":
      return datasource.listVariables();
    case "target":
      return datasource.listTargets();
    case "test":
      return datasource.listTests();
    case "scenario":
      return datasource.listScenarios();
  }
}

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

/**
 * Formats every definition file of a project in one run: attributes, schemas, segments,
 * features, variables, targets, tests and scenarios, across every Set unless one is picked.
 * Writes only files that change, unless checking or diffing.
 */
export async function formatProject(
  deps: Dependencies,
  options: FormatProjectOptions = {},
): Promise<FormatProjectResult> {
  const { projectConfig, datasource } = deps;
  const result: FormatProjectResult = {
    files: [],
    skipped: [],
    changed: 0,
    declined: 0,
    errors: 0,
  };

  const parser = projectConfig.parser as CustomParser;
  if (!canFormat(parser)) return { ...result, unsupported: true };

  const write = !options.check && !options.diff;
  const wanted = (options.paths || []).map(toWantedPath);
  const entityTypes = options.entityType ? [options.entityType] : FORMAT_ENTITY_TYPES;
  const executions = await getProjectSetExecutions(projectConfig, datasource, options.set);
  const seen = new Set<string>();

  for (const execution of executions) {
    for (const entityType of entityTypes) {
      const keys = await listKeys(execution.datasource, entityType);

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
        if (wanted.length > 0) {
          const matches = wanted.filter((item) => isWanted(item, absolute));
          if (matches.length === 0) continue;
          matches.forEach((item) => (item.matched = true));
        }
        if (seen.has(absolute)) continue;
        seen.add(absolute);

        const file: FormatFileResult = {
          ...(projectConfig.sets ? { set: execution.set } : {}),
          entityType,
          key,
          filePath: relative(filePath),
          status: "unchanged",
        };
        result.files.push(file);

        if (!fs.existsSync(filePath)) {
          file.status = "error";
          file.error = { code: "missing_file", message: "File not found" };
          result.errors++;
          continue;
        }

        const source = fs.readFileSync(filePath, "utf8");
        try {
          const { output, changed, declined } = formatDefinition(
            entityType,
            source,
            parser,
            filePath,
          );
          if (declined) {
            file.status = "declined";
            result.declined++;
          } else if (changed) {
            file.status = "changed";
            result.changed++;
            if (options.diff) file.diff = unifiedDiff(file.filePath, file.filePath, source, output);
            if (write) fs.writeFileSync(filePath, output);
          }
        } catch (error) {
          file.status = "error";
          file.error =
            error instanceof FormatParseError
              ? {
                  code: "parse_error",
                  message: error.message,
                  line: error.line,
                  column: error.column,
                }
              : {
                  code: "format_guard",
                  message:
                    error instanceof FormatGuardError
                      ? `${error.message} The file was left as it is. Please report this.`
                      : (error as Error).message,
                };
          result.errors++;
        }
      }
    }
  }

  result.skipped = wanted.filter((item) => !item.matched).map((item) => relative(item.absolute));
  return result;
}

export function printFormatResult(result: FormatProjectResult, options: FormatProjectOptions) {
  const write = !options.check && !options.diff;

  if (result.unsupported) {
    console.log(
      CLI_FORMAT_YELLOW,
      "This project's parser has no format function, so fmt leaves its files as they are.",
    );
    return;
  }

  for (const file of result.files) {
    if (file.status === "changed") {
      if (options.diff && file.diff) {
        process.stdout.write(file.diff);
      } else {
        console.log(write ? `Formatted ${file.filePath}` : file.filePath);
      }
    } else if (file.status === "declined") {
      console.log(CLI_FORMAT_DIM, `Left ${file.filePath} as it is: the parser could not format it`);
    } else if (file.status === "error" && file.error) {
      const { line, column } = file.error;
      const where = line ? `:${line}${column ? `:${column}` : ""}` : "";
      console.log(CLI_FORMAT_RED, `${file.filePath}${where}`);
      console.log(CLI_FORMAT_RED, `  => Error: ${file.error.message}`);
    }
  }

  for (const skipped of result.skipped) {
    console.log(CLI_FORMAT_DIM, `Skipped ${skipped}, no definitions of this project there`);
  }

  const total = result.files.length;
  const files = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;

  console.log("");
  if (total === 0) {
    console.log(CLI_FORMAT_YELLOW, "No definition files matched");
    return;
  }
  if (result.errors > 0) {
    console.log(CLI_FORMAT_RED, `${files(result.errors)} could not be formatted`);
  }
  if (result.declined > 0) {
    const verb = result.declined === 1 ? "was" : "were";
    console.log(
      CLI_FORMAT_YELLOW,
      `${files(result.declined)} ${verb} left as the parser found them`,
    );
  }

  if (result.changed > 0) {
    if (write) {
      console.log(CLI_FORMAT_GREEN, `✔ Formatted ${files(result.changed)} of ${total}`);
    } else {
      const verb = result.changed === 1 ? "needs" : "need";
      console.log(
        CLI_FORMAT_YELLOW,
        `${files(result.changed)} of ${total} ${verb} formatting. Run: npx featurevisor fmt`,
      );
    }
  } else if (result.errors === 0) {
    const formatted = total - result.declined;
    if (formatted === 1) {
      console.log(
        CLI_FORMAT_GREEN,
        `✔ ${result.declined > 0 ? "The other file" : "The file"} is formatted`,
      );
    } else if (formatted > 1) {
      console.log(
        CLI_FORMAT_GREEN,
        `✔ ${result.declined > 0 ? "The other" : "All"} ${files(formatted)} are formatted`,
      );
    }
  }
}
