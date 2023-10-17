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
  findDuplicateSegmentsInProject,
  BuildCLIOptions,
  GenerateCodeCLIOptions,
  restoreProject,
} from "@featurevisor/core";

process.on("unhandledRejection", (reason) => {
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
     * Init
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

    /**
     * Lint
     */
    .command({
      command: "lint",
      handler: async function () {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        const hasError = await lintProject(projectConfig);

        if (hasError) {
          process.exit(1);
        }
      },
    })
    .example("$0 lint", "lint all YAML file content")

    /**
     * Build
     */
    .command({
      command: "build",
      handler: async function (options) {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        try {
          await buildProject(rootDirectoryPath, projectConfig, options as BuildCLIOptions);
        } catch (e) {
          console.error(e);
          process.exit(1);
        }
      },
    })
    .example("$0 build", "build datafiles")

    /**
     * Restore
     */
    .command({
      command: "restore",
      handler: async function () {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        try {
          await restoreProject(rootDirectoryPath, projectConfig);
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })
    .example("$0 restore", "restore state files")

    /**
     * Test
     */
    .command({
      command: "test",
      handler: async function () {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        const hasError = await testProject(rootDirectoryPath, projectConfig);

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
      handler: async function (options) {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        const allowedSubcommands = ["export", "serve"];

        if (!allowedSubcommands.includes(options.subcommand)) {
          console.log("Please specify a subcommand: `export` or `serve`");
          return;
        }

        // export
        if (options.subcommand === "export") {
          const hasError = await exportSite(rootDirectoryPath, projectConfig);

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
      handler: async function (options) {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        try {
          await generateCodeForProject(
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
    .example("$0 generate-code", "generate code from YAMLs")
    .example("$0 generate-code --language typescript --out-dir ./src", "")

    /**
     * Find duplicate segments
     */
    .command({
      command: "find-duplicate-segments",
      handler: async function () {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        try {
          await findDuplicateSegmentsInProject(rootDirectoryPath, projectConfig);
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })
    .example("$0 generate-code", "generate code from YAMLs")

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
