import * as fs from "fs";
import * as path from "path";

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
  openGui,
  benchmarkFeature,
  showProjectConfig,
  evaluateFeature,
  assessDistribution,
  showProjectInfo,
} from "@featurevisor/core";

const yargs = require("yargs"); // eslint-disable-line @typescript-eslint/no-var-requires

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
  const useRootDirectoryPath = options.rootDirectoryPath || rootDirectoryPath;

  const projectConfig = requireAndGetProjectConfig(useRootDirectoryPath);
  const datasource = new Datasource(projectConfig, useRootDirectoryPath);

  return {
    rootDirectoryPath: useRootDirectoryPath,
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
          await findDuplicateSegmentsInProject(deps, {
            authors: options.authors,
          });
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })
    .example("$0 find-duplicate-segments", "list segments with same conditions")
    .example("$0 find-duplicate-segments --authors", "show the duplicates along with author names")

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

            unusedSegments: options.unusedSegments,
            unusedAttributes: options.unusedAttributes,

            authors: options.authors,
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
    .example("$0 find-usage --unusedSegments", "find unused segments")
    .example("$0 find-usage --unusedAttributes", "find unused attributes")

    /**
     * Benchmark features
     */
    .command({
      command: "benchmark",
      handler: async function (options) {
        if (!options.environment) {
          console.error("Please specify an environment with --environment flag.");
          process.exit(1);
        }

        if (!options.feature) {
          console.error("Please specify a feature with --feature flag.");
          process.exit(1);
        }

        const deps = await getDependencies(options);

        try {
          await benchmarkFeature(deps, {
            environment: options.environment,
            feature: options.feature,
            n: parseInt(options.n, 10) || 1,
            context: options.context ? JSON.parse(options.context) : {},
            variation: options.variation || undefined,
            variable: options.variable || undefined,
          });
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })
    .example("$0 benchmark", "benchmark feature evaluations")
    .example(
      "$0 benchmark --environment=production --feature=my_feature --context='{}' -n=100",
      "benchmark feature flag evaluation",
    )
    .example(
      "$0 benchmark --environment=production --feature=my_feature --context='{}' --variation -n=100",
      "benchmark feature variation evaluation",
    )
    .example(
      "$0 benchmark --environment=production --feature=my_feature --context='{}' --variable=my_variable_key -n=100",
      "benchmark feature variable evaluation",
    )

    /**
     * Show config
     */
    .command({
      command: "config",
      handler: async function (options) {
        const projectConfig = requireAndGetProjectConfig(rootDirectoryPath);

        showProjectConfig(projectConfig, {
          print: options.print,
          pretty: options.pretty,
        });
      },
    })
    .example("$0 config", "show project configuration")
    .example("$0 config --print", "print project configuration as JSON")
    .example("$0 config --print --pretty", "print project configuration as prettified JSON")

    /**
     * Evaluate
     */
    .command({
      command: "evaluate",
      handler: async function (options) {
        if (!options.environment) {
          console.error("Please specify an environment with --environment flag.");
          process.exit(1);
        }

        if (!options.feature) {
          console.error("Please specify a feature with --feature flag.");
          process.exit(1);
        }

        const deps = await getDependencies(options);

        try {
          await evaluateFeature(deps, {
            environment: options.environment,
            feature: options.feature,
            context: options.context ? JSON.parse(options.context) : {},
            print: options.print,
            pretty: options.pretty,
            verbose: options.verbose,
          });
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })
    .example("$0 evaluate", "evaluate a feature along with its variation and variables")
    .example(
      "$0 evaluate --environment=production --feature=my_feature --context='{}'",
      "evaluate a feature against provided context",
    )

    /**
     * Assess distribution
     */
    .command({
      command: "assess-distribution",
      handler: async function (options) {
        if (!options.environment) {
          console.error("Please specify an environment with --environment flag.");
          process.exit(1);
        }

        if (!options.feature) {
          console.error("Please specify a feature with --feature flag.");
          process.exit(1);
        }

        const deps = await getDependencies(options);

        try {
          await assessDistribution(deps, {
            environment: options.environment,
            feature: options.feature,
            context: options.context ? JSON.parse(options.context) : {},
            populateUuid: Array.isArray(options.populateUuid)
              ? options.populateUuid
              : [options.populateUuid as string].filter(Boolean),
            n: parseInt(options.n, 10) || 1,
            verbose: options.verbose,
          });
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })
    .example("$0 assess-distribution", "test traffic distribution of a feature")
    .example(
      "$0 assess-distribution --environment=production --feature=my_feature --context='{}' --populateUuid=userId --n=100",
      "test traffic distribution a feature against provided context",
    )

    /**
     * Info
     */
    .command({
      command: "info",
      handler: async function (options) {
        const deps = await getDependencies(options);

        try {
          await showProjectInfo(deps);
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })

    /**
     * GUI
     */
    .command({
      command: "gui",
      handler: async function (options) {
        const deps = await getDependencies(options);

        try {
          openGui(deps);
        } catch (e) {
          console.error(e.message);
          process.exit(1);
        }
      },
    })

    .example("$0 gui", "Open GUI")

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
