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
  findUsageInProject,
  BuildCLIOptions,
  GenerateCodeCLIOptions,
  TestProjectOptions,
  LintProjectOptions,
  restoreProject,
  Dependencies,
  Datasource,
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

const rootDirectoryPath = process.cwd();

async function getDependencies(options): Promise<Dependencies> {
  const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);
  const datasource = new Datasource(projectConfig, rootDirectoryPath);

  return {
    rootDirectoryPath,
    projectConfig,
    datasource,
    options,
  };
}

async function main() {
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
      handler: async function (options) {
        const deps = await getDependencies(options);
        const lintOptions: LintProjectOptions = {
          keyPattern: options.keyPattern,
          entityType: options.entityType,
        };

        const hasError = await lintProject(deps, lintOptions);

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
        const deps = await getDependencies(options);

        try {
          await buildProject(deps, options as BuildCLIOptions);
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
      handler: async function (options) {
        const deps = await getDependencies(options);

        try {
          await restoreProject(deps);
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
      handler: async function (options) {
        const deps = await getDependencies(options);

        const testOptions: TestProjectOptions = {
          keyPattern: options.keyPattern,
          assertionPattern: options.assertionPattern,
          verbose: options.verbose || false,
          showDatafile: options.showDatafile || false,
          fast: options.fast || false,
          onlyFailures: options.onlyFailures || false,
        };

        const hasError = await testProject(deps, testOptions);

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
        const deps = await getDependencies(options);

        const allowedSubcommands = ["export", "serve"];

        if (!allowedSubcommands.includes(options.subcommand)) {
          console.log("Please specify a subcommand: `export` or `serve`");
          return;
        }

        // export
        if (options.subcommand === "export") {
          const hasError = await exportSite(deps);

          if (hasError) {
            process.exit(1);
          }
        }

        // serve
        if (options.subcommand === "serve") {
          serveSite(deps);
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
        const deps = await getDependencies(options);

        try {
          await generateCodeForProject(deps, options as unknown as GenerateCodeCLIOptions);
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
      handler: async function (options) {
        const deps = await getDependencies(options);

        try {
          await findDuplicateSegmentsInProject(deps);
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })
    .example("$0 find-duplicate-segments", "list segments with same conditions")

    /**
     * Find usage
     */
    .command({
      command: "find-usage",
      handler: async function (options) {
        const deps = await getDependencies(options);

        try {
          await findUsageInProject(deps, {
            segment: options.segment,
            attribute: options.attribute,
          });
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })
    .example("$0 find-usage", "find usage of segments and attributes")
    .example("$0 find-usage --segment=my_segment", "find usage of segment")
    .example("$0 find-usage --attribute=my_attribute", "find usage of attribute")

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
