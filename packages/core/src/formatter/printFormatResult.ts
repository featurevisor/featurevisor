import {
  CLI_FORMAT_DIM,
  CLI_FORMAT_GREEN,
  CLI_FORMAT_RED,
  CLI_FORMAT_YELLOW,
} from "../tester/cliFormat";
import type { FormatFileResult, FormatProjectOptions, FormatProjectResult } from "./formatProject";

function printError(file: FormatFileResult, log: (...lines: string[]) => void) {
  const { line, column, message } = file.error!;
  const where = line ? `:${line}${column ? `:${column}` : ""}` : "";
  log(CLI_FORMAT_RED, `${file.filePath}${where}`);
  log(CLI_FORMAT_RED, `  => Error: ${message}`);
}

/**
 * Prints the result of formatting source given on stdin. The formatted source goes to stdout
 * for an editor, or what --check and --diff report, and an error goes to stderr. Source for a
 * path that holds no definition comes back as it is.
 */
export function printStdinResult(result: FormatProjectResult, options: FormatProjectOptions) {
  const file = result.files[0];
  if (file?.status === "error") {
    printError(file, console.error);
  } else if (options.diff) {
    if (file?.diff) process.stdout.write(file.diff);
  } else if (options.check) {
    if (file?.status === "changed") console.log(file.filePath);
  } else {
    process.stdout.write(file?.output ?? options.stdin!.source);
  }
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
      printError(file, console.log);
    }
  }

  for (const skipped of result.skipped) {
    console.log(CLI_FORMAT_DIM, `Skipped ${skipped}, no definitions of this project there`);
  }

  const total = result.files.length;
  const files = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;

  console.log("");
  if (total === 0) {
    console.log(
      CLI_FORMAT_YELLOW,
      options.since === undefined
        ? "No definition files matched"
        : `No definition files changed since ${options.since}`,
    );
    return;
  }
  if (result.errors > 0) {
    console.log(CLI_FORMAT_RED, `${files(result.errors)} could not be formatted`);
  }
  if (result.declined > 0) {
    console.log(CLI_FORMAT_YELLOW, `${files(result.declined)} left unformatted by the parser`);
  }
  if (result.ignored > 0) {
    console.log(CLI_FORMAT_DIM, `${files(result.ignored)} left as written by featurevisor-ignore`);
  }

  if (result.changed > 0) {
    if (write) {
      console.log(CLI_FORMAT_GREEN, `✔ Formatted ${files(result.changed)} of ${total}`);
    } else {
      const verb = result.changed === 1 ? "needs" : "need";
      const since = options.since === undefined ? "" : ` --since=${options.since}`;
      const simplify = options.simplify ? " --simplify" : "";
      console.log(
        CLI_FORMAT_YELLOW,
        `${files(result.changed)} of ${total} ${verb} formatting. Run: npx featurevisor fmt${simplify}${since}`,
      );
    }
  } else if (result.errors === 0) {
    const left = result.declined + result.ignored;
    const formatted = total - left;
    if (formatted === 1) {
      console.log(CLI_FORMAT_GREEN, `✔ ${left > 0 ? "The other file" : "The file"} is formatted`);
    } else if (formatted > 1) {
      console.log(
        CLI_FORMAT_GREEN,
        `✔ ${left > 0 ? "The other" : "All"} ${files(formatted)} are formatted`,
      );
    }
  }
}
