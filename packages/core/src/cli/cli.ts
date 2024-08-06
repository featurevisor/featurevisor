import { ProjectConfig } from "../config";
import { Datasource } from "../datasource";

import { commonPlugins, nonProjectPlugins, projectBasedPlugins } from "./plugins";

export interface ParsedOptions {
  _: string[];
  [key: string]: any;
}

export interface PluginHandlerOptions {
  rootDirectoryPath: string;
  projectConfig: ProjectConfig;
  datasource: Datasource;
  parsed: ParsedOptions;
}

export interface Plugin {
  command: string; // single word
  handler: (options: PluginHandlerOptions) => Promise<void | boolean>;
  examples: {
    command: string; // full command usage
    description: string;
  }[];
}

export interface RunnerOptions {
  rootDirectoryPath: string;

  // optional because Featurevisor CLI can be used without a project
  projectConfig?: ProjectConfig;
  datasource?: Datasource;
}

export async function runCLI(runnerOptions: RunnerOptions) {
  const yargs = require("yargs");

  let y = yargs(process.argv.slice(2)).usage("Usage: <command> [options]");
  const registeredSubcommands: string[] = [];

  const { rootDirectoryPath, projectConfig, datasource } = runnerOptions;

  function registerPlugin(plugin: Plugin) {
    const subcommand = plugin.command.split(" ")[0];

    if (registeredSubcommands.includes(subcommand)) {
      console.warn(`Plugin "${subcommand}" already registered. Skipping.`);
      return;
    }

    y = y.command({
      command: plugin.command,
      handler: async function (parsed: ParsedOptions) {
        try {
          const result = await plugin.handler({
            rootDirectoryPath,
            projectConfig,
            datasource,
            parsed,
          } as PluginHandlerOptions);

          if (result === false) {
            process.exit(1);
          }
        } catch (error) {
          console.error(error);
          process.exit(1);
        }
      },
    });

    for (const example of plugin.examples) {
      y = y.example(`$0 ${example.command}`, example.description);
    }

    registeredSubcommands.push(subcommand);
  }

  // non project-based plugins
  if (!projectConfig) {
    for (const plugin of nonProjectPlugins) {
      registerPlugin(plugin);
    }
  }

  // project-based plugins
  if (projectConfig) {
    for (const plugin of [...projectBasedPlugins, ...(projectConfig.plugins || [])]) {
      registerPlugin(plugin);
    }
  }

  // common plugins
  for (const plugin of commonPlugins) {
    registerPlugin(plugin);
  }

  // show help if no command is provided
  y.command({
    command: "*",
    handler() {
      y.showHelp();
    },
  }).argv;
}
