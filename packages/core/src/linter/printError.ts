import { ZodError } from "zod";

import { CLI_FORMAT_RED } from "../tester/cliFormat";

export function printZodError(e: ZodError) {
  const { issues } = e;

  issues.forEach((issue) => {
    console.error(CLI_FORMAT_RED, `  => Error: ${issue.message}`);
    console.error("     Path:", issue.path.join("."));

    const receivedValue = (issue as any).received;
    if (typeof receivedValue !== "undefined" && receivedValue !== "undefined") {
      console.error("     Value:", receivedValue);
    }

    if (issues.length > 1) {
      console.error("");
    }
  });
}
