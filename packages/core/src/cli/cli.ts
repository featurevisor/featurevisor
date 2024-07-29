import yargs from "yargs/yargs";

import { ProjectConfig } from "../config";
import { Datasource } from "../datasource";

import { corePlugins } from "./corePlugins";

export interface RunnerOptions {
  rootDirectoryPath: string;

  // optional because Featurevisor CLI can be used without a project
  projectConfig?: ProjectConfig;
  datasource?: Datasource;
}

export type CLIOptions = Record<string, unknown>; // CLI args @TODO: map to yargs?

export interface PluginHandlerOptions {
  rootDirectoryPath: string;
  projectConfig: ProjectConfig;
  datasource: Datasource;
  options: CLIOptions;
}

export interface Plugin {
  command: string; // single word
  handler: (options: PluginHandlerOptions) => Promise<void | boolean>;
  examples: {
    command: string; // full command usage
    description: string;
  }[];
}

export async function runCLI(runnerOptions: RunnerOptions) {
  let y = yargs(process.argv.slice(2));
  const { rootDirectoryPath, projectConfig, datasource } = runnerOptions;

  // handle plugins without needing a project
  // @TODO: handle init
  // @TODO: handle --version and/or version

  if (!projectConfig || !datasource) {
    console.log("No existing project found.");

    return;
  }

  // handle plugins that need a project
  const registeredCommands: string[] = [];
  const allPlugins = [...corePlugins, ...(projectConfig.plugins || [])];
  for (const plugin of allPlugins) {
    if (registeredCommands.includes(plugin.command)) {
      console.warn(`Plugin "${plugin.command}" already registered. Skipping.`);
      continue;
    }

    y = y.command({
      command: plugin.command,
      handler: async function (options) {
        const result = await plugin.handler({
          rootDirectoryPath,
          projectConfig,
          datasource,
          options,
        });

        if (result === false) {
          process.exit(1);
        }
      },
    });

    for (const example of plugin.examples) {
      y = y.example(`$0 ${example.command}`, example.description);
    }

    registeredCommands.push(plugin.command);
  }
}
