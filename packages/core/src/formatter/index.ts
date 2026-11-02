import type { Plugin } from "../cli";

/**
 * `featurevisor fmt` lays out definitions in one house style. The command loads its code only
 * when it runs, so other commands start without it.
 */
export const fmtPlugin: Plugin = {
  command: "fmt [paths...]",
  handler: async function (options) {
    const { runFormat } = require("./run") as typeof import("./run");
    return runFormat(options);
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
      command: "fmt --check --since=origin/main",
      description: "Check only the files changed since the branch left main",
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
      command: "fmt --simplify",
      description:
        "Also write each condition in its simplest form, which can change datafiles but not evaluation",
    },
    {
      command: "fmt --entity-type=feature --key-pattern=checkout",
      description: "Format only matching features",
    },
    {
      command: "fmt --stdin-filepath=features/checkout.yml < checkout.yml",
      description: "Format text from stdin as the given file and print it, for editors",
    },
  ],
};
