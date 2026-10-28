import * as fs from "node:fs";
import * as path from "node:path";

import type { EntityType } from "@featurevisor/types";
import type { CustomParser } from "@featurevisor/parsers";

import type { ProjectConfig } from "../config";
import type { Datasource } from "../datasource";
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
import type { FormatEntityType } from "./keyOrder";
import { unifiedDiff } from "./unifiedDiff";

export const FORMAT_ENTITY_TYPES: FormatEntityType[] = [
  "attribute",
  "schema",
  "segment",
  "feature",
  "variable",
  "target",
  "test",
  "scenario",
];

export interface FormatProjectOptions {
  /** Report files that need formatting without writing them */
  check?: boolean;
  /** Print what would change as a unified diff, without writing */
  diff?: boolean;
  entityType?: FormatEntityType;
  keyPattern?: RegExp;
  /** Only these files, absolute or relative to the working directory */
  paths?: string[];
  json?: boolean;
}

export interface FormatFileResult {
  entityType: FormatEntityType;
  key: string;
  /** Relative to the working directory */
  filePath: string;
  status: "unchanged" | "changed" | "error";
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
  /** Paths given that are not definitions of this project */
  skipped: string[];
  changed: number;
  errors: number;
  /** The project's parser has no `format`, so its files were left as they are */
  unsupported?: boolean;
}

interface Dependencies {
  rootDirectoryPath: string;
  projectConfig: ProjectConfig;
  datasource: Datasource;
}

function listKeys(datasource: Datasource, entityType: FormatEntityType): Promise<string[]> {
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

/**
 * Formats every definition file of one project, or one Set: attributes, schemas, segments,
 * features, variables, targets, tests and scenarios. Writes only files that change, unless
 * checking or diffing.
 */
export async function formatProject(
  deps: Dependencies,
  options: FormatProjectOptions = {},
): Promise<FormatProjectResult> {
  const { projectConfig, datasource } = deps;
  const write = !options.check && !options.diff;
  const wanted = options.paths?.length
    ? new Set(options.paths.map((filePath) => path.resolve(filePath)))
    : undefined;
  const seen = new Set<string>();

  const result: FormatProjectResult = { files: [], skipped: [], changed: 0, errors: 0 };
  const parser = projectConfig.parser as CustomParser;
  if (!canFormat(parser)) return { ...result, unsupported: true };
  const entityTypes = options.entityType ? [options.entityType] : FORMAT_ENTITY_TYPES;

  for (const entityType of entityTypes) {
    const keys = await listKeys(datasource, entityType);

    for (const key of keys) {
      if (options.keyPattern && !options.keyPattern.test(key)) continue;

      const filePath = datasource.getEntitySourcePath(entityType as EntityType, key);
      if (!filePath) {
        throw new Error(
          "fmt needs definitions stored as files. This project's datasource adapter does not expose file paths.",
        );
      }
      if (wanted && !wanted.has(path.resolve(filePath))) continue;
      seen.add(path.resolve(filePath));

      const file: FormatFileResult = {
        entityType,
        key,
        filePath: relative(filePath),
        status: "unchanged",
      };

      if (!fs.existsSync(filePath)) {
        file.status = "error";
        file.error = { code: "missing_file", message: "File not found" };
        result.files.push(file);
        result.errors++;
        continue;
      }

      const source = fs.readFileSync(filePath, "utf8");
      try {
        const { output, changed } = formatDefinition(entityType, source, parser, filePath);
        if (changed) {
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

      result.files.push(file);
    }
  }

  if (wanted) {
    for (const filePath of wanted) {
      if (!seen.has(filePath)) result.skipped.push(relative(filePath));
    }
  }

  return result;
}

export function printFormatResult(result: FormatProjectResult, options: FormatProjectOptions) {
  const write = !options.check && !options.diff;

  for (const file of result.files) {
    if (file.status === "changed") {
      if (options.diff && file.diff) {
        process.stdout.write(file.diff);
      } else {
        console.log(write ? `Formatted ${file.filePath}` : file.filePath);
      }
    } else if (file.status === "error" && file.error) {
      const { line, column } = file.error;
      const where = line ? `:${line}${column ? `:${column}` : ""}` : "";
      console.log(CLI_FORMAT_RED, `${file.filePath}${where}`);
      console.log(CLI_FORMAT_RED, `  => Error: ${file.error.message}`);
    }
  }

  if (result.unsupported) {
    console.log(
      CLI_FORMAT_YELLOW,
      "This project's parser has no format function, so fmt leaves its files as they are.",
    );
    return;
  }

  for (const skipped of result.skipped) {
    console.log(CLI_FORMAT_DIM, `Skipped ${skipped}, not a definition of this project`);
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
    console.log(CLI_FORMAT_GREEN, `✔ All ${files(total)} are formatted`);
  }
}
