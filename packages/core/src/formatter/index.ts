import type { Plugin } from "../cli";
import { parseRegexOption } from "../cli/validation";
import { assertProjectSetJsonSelection, getProjectSetExecutions, printSetHeader } from "../sets";
import { formatProject, printFormatResult, type FormatProjectResult } from "./formatProject";
import type { FormatEntityType } from "./keyOrder";

export * from "./formatDefinition";
export * from "./formatProject";
export * from "./keyOrder";
export { unifiedDiff } from "./unifiedDiff";

export const fmtPlugin: Plugin = {
  command: "fmt [paths...]",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    assertProjectSetJsonSelection(projectConfig, parsed.set, parsed.json);

    const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);
    const options = {
      check: parsed.check === true,
      diff: parsed.diff === true,
      entityType: parsed.entityType as FormatEntityType | undefined,
      keyPattern:
        parsed.keyPattern !== undefined
          ? parseRegexOption("--key-pattern", parsed.keyPattern)
          : undefined,
      paths: (parsed.paths as string[] | undefined) || [],
      json: parsed.json === true,
    };

    let failed = false;
    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set, options.json);

      const result: FormatProjectResult = await formatProject(
        {
          rootDirectoryPath,
          projectConfig: execution.projectConfig,
          datasource: execution.datasource,
        },
        options,
      );

      if (options.json) {
        const payload = {
          files: result.files.map(({ diff, ...file }) => (options.diff ? { ...file, diff } : file)),
          skipped: result.skipped,
          changed: result.changed,
          errors: result.errors,
          ...(result.unsupported ? { unsupported: true } : {}),
        };
        console.log(parsed.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload));
      } else {
        printFormatResult(result, options);
      }

      if (result.errors > 0) failed = true;
      if ((options.check || options.diff) && result.changed > 0) failed = true;
    }

    if (failed) return false;
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
      command: "fmt features/checkout.yml",
      description: "Format only the given files",
    },
    {
      command: "fmt --entity-type=feature --key-pattern=checkout",
      description: "Format only matching features",
    },
  ],
};
