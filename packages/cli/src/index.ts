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

        buildProject(rootDirectoryPath, projectConfig);
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
      command: "site export",
      handler: function (options) {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        const hasError = exportSite(rootDirectoryPath, projectConfig);

        if (hasError) {
          process.exit(1);
        }
      },
    })
    .example("$0 site export", "generate static site with project data")

    .command({
      command: "site serve",
      handler: function (options) {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        serveSite(rootDirectoryPath, projectConfig, options);
      },
    })
    .example("$0 site export", "generate static site with project data")

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
