import { Plugin } from "../cli";
import { exportSite } from "./exportSite";
import { serveSite } from "./serveSite";

export const sitePlugin: Plugin = {
  command: "site [subcommand]",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    const deps = {
      rootDirectoryPath,
      projectConfig,
      datasource,
      options: parsed,
    };

    const allowedSubcommands = ["export", "serve"];

    if (!allowedSubcommands.includes(parsed.subcommand)) {
      console.log("Please specify a subcommand: `export` or `serve`");
      return;
    }

    // export
    if (parsed.subcommand === "export") {
      const hasError = await exportSite(deps);

      if (hasError) {
        return false;
      }
    }

    // serve
    if (parsed.subcommand === "serve") {
      serveSite(deps);
    }
  },
  examples: [
    {
      command: "site export",
      description: "generate static site with project data",
    },
    {
      command: "site serve",
      description: "serve already exported site locally",
    },
  ],
};
