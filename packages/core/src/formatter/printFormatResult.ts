import {
  CLI_FORMAT_DIM,
  CLI_FORMAT_GREEN,
  CLI_FORMAT_RED,
  CLI_FORMAT_YELLOW,
} from "../tester/cliFormat";
import type { FormatProjectOptions, FormatProjectResult } from "./formatProject";

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
    console.log(CLI_FORMAT_YELLOW, `${files(result.declined)} left unformatted by the parser`);
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
