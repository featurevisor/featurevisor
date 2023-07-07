import * as fs from "fs";
import * as path from "path";

import * as yargs from "yargs";

import {
  CONFIG_MODULE_NAME,
  getProjectConfig,
  lintProject,
  testProject,
  buildProject,
  initProject,
  exportSite,
  serveSite,
  generateCodeForProject,
  BuildCLIOptions,
  GenerateCodeCLIOptions,
} from "@featurevisor/core";

process.on("unhandledRejection", (reason, p) => {
  console.error(reason);
  process.exit(1);
});

function requireConfigFile(configModulePath) {
  if (!fs.existsSync(configModulePath)) {
    console.error("No config file found. Please create `featurevisor.config.js` file first.");

    process.exit(1);
  }
}

function requireAndGetProjectConfig(rootDirectoryPath) {
  const configModulePath = path.join(rootDirectoryPath, CONFIG_MODULE_NAME);

  requireConfigFile(configModulePath);

  return getProjectConfig(rootDirectoryPath);
}

async function main() {
  const rootDirectoryPath = process.cwd();

  yargs(process.argv.slice(2))
    .usage("Usage: <command> [options]")

    /**
     * Commands
     */
    .command({
      command: "init",
      handler: async function (options) {
        const hasError = await initProject(rootDirectoryPath, options.example);

        if (hasError) {
          process.exit(1);
        }
      },
    })
    .example("$0 init", "scaffold a new project")
    .example("$0 init --example=exampleName", "scaffold a new project from known example")

    .command({
      command: "lint",
      handler: async function (options) {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        const hasError = await lintProject(projectConfig);

        if (hasError) {
          process.exit(1);
        }
      },
    })
    .example("$0 lint", "lint all YAML file content")

    .command({
      command: "build",
      handler: function (options) {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        try {
          buildProject(rootDirectoryPath, projectConfig, options as BuildCLIOptions);
        } catch (e) {
          console.error(e);
          process.exit(1);
        }
      },
    })
    .example("$0 build", "build datafiles")

    .command({
      command: "test",
      handler: function (options) {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        const hasError = testProject(rootDirectoryPath, projectConfig);

        if (hasError) {
          process.exit(1);
        }
      },
    })
    .example("$0 test", "test features")

    /**
     * Site
     */
    .command({
      command: "site [subcommand]",
      handler: function (options) {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        const allowedSubcommands = ["export", "serve"];

        if (!allowedSubcommands.includes(options.subcommand)) {
          console.log("Please specify a subcommand: `export` or `serve`");
          return;
        }

        // export
        if (options.subcommand === "export") {
          const hasError = exportSite(rootDirectoryPath, projectConfig);

          if (hasError) {
            process.exit(1);
          }
        }

        // serve
        if (options.subcommand === "serve") {
          serveSite(rootDirectoryPath, projectConfig);
        }
      },
    })
    .example("$0 site export", "generate static site with project data")
    .example("$0 site serve", "serve already exported site locally")
    .example("$0 site serve -p 3000", "serve in a specific port")

    /**
     * Generate code
     */
    .command({
      command: "generate-code",
      handler: function (options) {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        try {
          generateCodeForProject(
            rootDirectoryPath,
            projectConfig,
            options as unknown as GenerateCodeCLIOptions,
          );
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })
    .example("$0 site export", "generate static site with project data")
    .example("$0 site serve", "serve already exported site locally")

    /**
     * Options
     */

    // @TODO: add --config option

    /**
     * Help
     */

    .command({
      command: "*",
      handler() {
        yargs.showHelp();
      },
    }).argv;

  return;
}

main();
