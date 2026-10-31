import * as fs from "node:fs";

import type { EntityType } from "@featurevisor/types";

import type { PluginHandlerOptions } from "../cli";
import { parseRegexOption } from "../cli/validation";
import { FeaturevisorCLIError, formatFeaturevisorCLIError } from "../error";
import { formatProject, type FormatProjectOptions } from "./formatProject";
import { printFormatResult, printStdinResult } from "./printFormatResult";

/**
 * The command, as Prettier exits: 0 when formatted, 1 when --check finds files that need
 * formatting, and 2 when fmt could not format, for errors to stand apart from work to do in CI
 */
export async function runFormat({
  rootDirectoryPath,
  projectConfig,
  datasource,
  parsed,
}: PluginHandlerOptions): Promise<number> {
  const json = parsed.json === true;
  try {
    const options: FormatProjectOptions = {
      check: parsed.check === true,
      diff: parsed.diff === true,
      entityType: parsed.entityType as EntityType | undefined,
      keyPattern:
        parsed.keyPattern !== undefined
          ? parseRegexOption("--key-pattern", parsed.keyPattern)
          : undefined,
      paths: (parsed.paths as string[] | undefined) || [],
      since: parsed.since as string | undefined,
      set: parsed.set as string | undefined,
    };
    if (parsed.stdinFilepath !== undefined) {
      if (options.paths!.length > 0 || options.since !== undefined) {
        throw new FeaturevisorCLIError(
          "--stdin-filepath formats one file. Leave out the other paths and --since.",
          { code: "invalid_cli_arguments" },
        );
      }
      options.stdin = {
        filePath: String(parsed.stdinFilepath),
        source: fs.readFileSync(0, "utf8"),
      };
    }

    // one run across every Set, so a project is formatted, checked and reported as a whole
    const result = await formatProject({ rootDirectoryPath, projectConfig, datasource }, options);

    if (json) {
      const payload = {
        files: result.files.map(({ diff, ...file }) => (options.diff ? { ...file, diff } : file)),
        skipped: result.skipped,
        changed: result.changed,
        declined: result.declined,
        ignored: result.ignored,
        errors: result.errors,
        ...(result.unsupported ? { unsupported: true } : {}),
      };
      console.log(parsed.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload));
    } else if (options.stdin) {
      printStdinResult(result, options);
    } else {
      printFormatResult(result, options);
    }

    // --diff alone shows the changes, and --check fails on them, with or without --diff
    if (result.errors > 0) return 2;
    if (options.check && result.changed > 0) return 1;
    return 0;
  } catch (error) {
    console.error(formatFeaturevisorCLIError(error, { json, pretty: parsed.pretty === true }));
    return 2;
  }
}
