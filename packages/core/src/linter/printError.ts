import { ZodError } from "zod";

import { CLI_FORMAT_RED } from "../tester/cliFormat";

export function printZodError(e: ZodError) {
  const { issues } = e;

  issues.forEach((issue) => {
    if (issue.code === "invalid_union" && issue.path.length === 0 && issue.unionErrors.length > 0) {
      // invalid_union
      const lastUnionError = issue.unionErrors[issue.unionErrors.length - 1];
      console.error(CLI_FORMAT_RED, `  => Error: ${lastUnionError.issues[0].message}`);
      console.error("     Path:", lastUnionError.issues[0].path.join("."));
    } else {
      // others
      console.error(CLI_FORMAT_RED, `  => Error: ${issue.message}`);
      console.error("     Path:", issue.path.join("."));

      const receivedValue = (issue as any).received;
      if (typeof receivedValue !== "undefined" && receivedValue !== "undefined") {
        console.error("     Value:", receivedValue);
      }
    }

    if (issues.length > 1) {
      console.error("");
    }
  });
}
