import type { Plugin } from "../cli";

/**
 * `featurevisor migrate` rewrites a v3 project's definitions for v4. A project runs it once,
 * so the command loads its code only when it runs, and nothing else imports from here.
 */
export const migratePlugin: Plugin = {
  command: "migrate",
  description: "Rewrite a v3 project's definitions for v4",
  handler: async function ({ rootDirectoryPath, parsed }) {
    const { runMigration } = require("./run") as typeof import("./run");
    return runMigration(rootDirectoryPath, parsed);
  },
  examples: [
    {
      command: "migrate",
      description: "Rewrite a v3 project's definitions for v4",
    },
    {
      command: "migrate --check",
      description: "List what migration would change, and exit with 1 if anything would",
    },
    {
      command: "migrate --diff",
      description: "Show what migration would change, without writing",
    },
  ],
};
