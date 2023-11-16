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
  TestProjectOptions,
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

async function getDependencies(options): Promise<Dependencies> {
  const rootDirectoryPath = process.cwd();
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
        const deps = await getDependencies(options);
        const hasError = await initProject(deps.rootDirectoryPath, options.example);

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

        const hasError = await lintProject(deps);

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
     * History
     */
    .command({
      command: "history",
      handler: async function (options) {
        const deps = await getDependencies(options);

        try {
          const { datasource } = deps;

          const historyEntries = await datasource.listHistoryEntries(options.type, options.key);

          if (historyEntries.length === 0) {
            console.log("No history found.");
            return;
          }

          for (const entry of historyEntries) {
            console.log(`\n\nCommit: ${entry.commit} by ${entry.author} at ${entry.timestamp}`);

            for (const entity of entry.entities) {
              console.log(`  - ${entity.type}: ${entity.key}`);
            }
          }
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })
    .example("$0 history", "list all changes")
    .example("$0 history --type=attribute", "list all attribute changes")
    .example("$0 history --type=segment", "list all segment changes")
    .example("$0 history --type=feature", "list all feature changes")
    .example("$0 history --type=group", "list all group changes")
    .example("$0 history --type=feature --key=someKey", "list specific feature changes")

    .command({
      command: "show-commit",
      handler: async function (options) {
        const deps = await getDependencies(options);

        try {
          const { datasource } = deps;

          const commit = await datasource.readCommit(options.hash, options.type, options.key);

          console.log(commit);

          console.log("\n\n\n======\n\n\n");

          console.log(JSON.stringify(commit, null, 2));
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })
    .example("$0 show-commit --hash=...", "show diff of a commit")

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
