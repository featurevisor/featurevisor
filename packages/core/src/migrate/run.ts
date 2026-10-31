import type { ParsedOptions } from "../cli";
import { formatFeaturevisorCLIError } from "../error";
import {
  CLI_FORMAT_DIM,
  CLI_FORMAT_GREEN,
  CLI_FORMAT_RED,
  CLI_FORMAT_YELLOW,
} from "../tester/cliFormat";
import { migrateProject, type MigrateOptions, type MigrationResult } from "./migrateProject";

function printResult(result: MigrationResult, options: MigrateOptions) {
  const write = !options.check && !options.diff;
  if (result.blockers.length > 0) {
    for (const blocker of result.blockers) {
      console.log(CLI_FORMAT_RED, blocker.message);
      console.log(CLI_FORMAT_DIM, `  ${blocker.link}`);
    }
    console.log("");
    console.log(CLI_FORMAT_RED, "Nothing was migrated");
    return;
  }

  for (const file of result.files) {
    if (file.error) {
      console.log(CLI_FORMAT_RED, file.filePath);
      console.log(CLI_FORMAT_RED, `  => Error: ${file.error}`);
    } else if (file.changes.length > 0) {
      if (options.diff && file.diff) process.stdout.write(file.diff);
      else console.log(`${write ? "Migrated " : ""}${file.filePath}: ${file.changes.join(", ")}`);
    }
  }

  const notes = result.files.filter((file) => file.notes.length > 0);
  if (notes.length > 0) {
    console.log("");
    console.log(CLI_FORMAT_YELLOW, "Needs you:");
    for (const file of notes) {
      for (const note of file.notes) {
        console.log(`  ${file.filePath}${note.path ? ` (${note.path})` : ""}`);
        console.log(`    ${note.message}`);
        console.log(CLI_FORMAT_DIM, `    ${note.link}`);
      }
    }
  }

  const files = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;
  console.log("");
  if (result.errors > 0)
    console.log(CLI_FORMAT_RED, `${files(result.errors)} could not be migrated`);
  if (result.migrated === 0) {
    console.log(CLI_FORMAT_GREEN, "✔ Nothing left to migrate");
  } else if (write) {
    console.log(CLI_FORMAT_GREEN, `✔ Migrated ${files(result.migrated)}`);
    console.log("Next: run lint, test and build, and review the changes before you commit them.");
  } else {
    const verb = result.migrated === 1 ? "needs" : "need";
    console.log(
      CLI_FORMAT_YELLOW,
      `${files(result.migrated)} ${verb} migrating. Run: npx featurevisor migrate`,
    );
  }
}

/** The command: 0 when done, 1 when --check finds files to migrate, and 2 on errors */
export async function runMigration(
  rootDirectoryPath: string,
  parsed: ParsedOptions,
): Promise<number> {
  const options: MigrateOptions = { check: parsed.check === true, diff: parsed.diff === true };
  const json = parsed.json === true;
  try {
    const result = migrateProject(rootDirectoryPath, options);
    if (json) {
      console.log(parsed.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result));
    } else {
      printResult(result, options);
    }
    if (result.blockers.length > 0 || result.errors > 0) return 2;
    if (options.check && result.migrated > 0) return 1;
    return 0;
  } catch (error) {
    console.error(formatFeaturevisorCLIError(error, { json, pretty: parsed.pretty === true }));
    return 2;
  }
}
