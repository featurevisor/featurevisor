import type { EntityType } from "@featurevisor/types";

import type { Plugin } from "../cli";
import { parseRegexOption } from "../cli/validation";
import { formatProject } from "./formatProject";
import { printFormatResult } from "./printFormatResult";

export {
  canFormat,
  formatDefinition,
  FormatGuardError,
  FormatParseError,
} from "./formatDefinition";
export type { FormatResult } from "./formatDefinition";
export { formatProject } from "./formatProject";
export type { FormatFileResult, FormatProjectOptions, FormatProjectResult } from "./formatProject";
export { FORMAT_ENTITY_TYPES, getFormatLayout } from "./layout";
export { HOUSE_STYLE } from "./style";

export const fmtPlugin: Plugin = {
  command: "fmt [paths...]",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    const options = {
      check: parsed.check === true,
      diff: parsed.diff === true,
      entityType: parsed.entityType as EntityType | undefined,
      keyPattern:
        parsed.keyPattern !== undefined
          ? parseRegexOption("--key-pattern", parsed.keyPattern)
          : undefined,
      paths: (parsed.paths as string[] | undefined) || [],
      set: parsed.set as string | undefined,
    };
    const json = parsed.json === true;

    // one run across every Set, so a project is formatted, checked and reported as a whole
    const result = await formatProject({ rootDirectoryPath, projectConfig, datasource }, options);

    if (json) {
      const payload = {
        files: result.files.map(({ diff, ...file }) => (options.diff ? { ...file, diff } : file)),
        skipped: result.skipped,
        changed: result.changed,
        declined: result.declined,
        errors: result.errors,
        ...(result.unsupported ? { unsupported: true } : {}),
      };
      console.log(parsed.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload));
    } else {
      printFormatResult(result, options);
    }

    // --diff alone shows the changes, and --check fails on them, with or without --diff
    if (result.errors > 0 || (options.check && result.changed > 0)) return false;
  },
  examples: [
    {
      command: "fmt",
      description: "Format every definition file in place",
    },
    {
      command: "fmt --check",
      description: "List files that need formatting and exit with 1 if any do, for CI",
    },
    {
      command: "fmt --diff",
      description: "Show what formatting would change, without writing",
    },
    {
      command: "fmt --check --diff",
      description: "Show what formatting would change and exit with 1 if anything would, for CI",
    },
    {
      command: "fmt features/checkout.yml segments",
      description: "Format only the given files, and the files in the given directories",
    },
    {
      command: "fmt --entity-type=feature --key-pattern=checkout",
      description: "Format only matching features",
    },
  ],
};
