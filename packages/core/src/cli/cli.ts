import { ProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { FeaturevisorCLIError, formatFeaturevisorCLIError } from "../error";

import {
  getBuiltinCLIOptions,
  getCompatibilityCLIOptions,
  type CLIOptionDefinitions,
} from "./options";
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
  command: string;
  description?: string;
  options?: CLIOptionDefinitions;
  handler: (options: PluginHandlerOptions) => Promise<void | boolean>;
  examples: {
    command: string;
    description: string;
  }[];
}

export interface RunnerOptions {
  rootDirectoryPath: string;
  projectConfig?: ProjectConfig;
  datasource?: Datasource;
  includeProjectCommands?: boolean;
}

function toDashedOptionName(name: string) {
  return name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function getBooleanArgument(args: string[], name: string) {
  const names = new Set([name, toDashedOptionName(name)]);
  let value = false;

  for (const argument of args) {
    for (const optionName of names) {
      if (argument === `--${optionName}` || argument === `--${optionName}=true`) {
        value = true;
      }
      if (argument === `--no-${optionName}` || argument === `--${optionName}=false`) {
        value = false;
      }
    }
  }

  return value;
}

function getCommandPositionals(command: string) {
  const positionals: string[] = [];
  const pattern = /[<[]([^>\]]+)[>\]]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(command))) {
    positionals.push(match[1].split("|")[0].replace(/\.{2,3}$/, ""));
  }

  return positionals;
}

export async function runCLI(runnerOptions: RunnerOptions) {
  const createYargs = require("yargs");
  const args = process.argv.slice(2);
  const json = getBooleanArgument(args, "json");
  const pretty = getBooleanArgument(args, "pretty");
  let commandFailed = false;
  let y = createYargs(args)
    .scriptName("featurevisor")
    .usage("Usage: $0 <command> [options]")
    .option("rootDirectoryPath", {
      type: "string",
      description: "Featurevisor project directory",
    })
    .exitProcess(false)
    .showHelpOnFail(false)
    .fail((message: string, error: unknown) => {
      if (error) {
        throw error;
      }

      throw new FeaturevisorCLIError(message || "Invalid command line arguments.", {
        code: "invalid_cli_arguments",
      });
    });
  const registeredSubcommands: string[] = [];
  const { rootDirectoryPath, projectConfig, datasource } = runnerOptions;

  function registerPlugin(plugin: Plugin) {
    const subcommand = plugin.command.split(" ")[0];

    if (registeredSubcommands.includes(subcommand)) {
      throw new FeaturevisorCLIError(`CLI command "${subcommand}" is already registered.`, {
        code: "duplicate_cli_command",
        details: { command: subcommand },
      });
    }

    const builtinOptions = getBuiltinCLIOptions(plugin.command);
    const declaredOptions = {
      ...(plugin.options && !builtinOptions ? getCompatibilityCLIOptions() : {}),
      ...(builtinOptions || {}),
      ...(plugin.options || {}),
    };

    y = y.command({
      command: plugin.command,
      describe: plugin.description || plugin.examples[0]?.description,
      builder(commandYargs: any) {
        let configuredYargs = commandYargs.options(declaredOptions);

        for (const [name, definition] of Object.entries(declaredOptions)) {
          if (definition.hidden) {
            configuredYargs = configuredYargs.hide(name);
          }
        }

        for (const positional of getCommandPositionals(plugin.command)) {
          configuredYargs = configuredYargs.positional(positional, { type: "string" });
        }

        // Existing custom plugins did not have to declare their options. Keep
        // those plugins permissive while built in and newly declared plugins
        // receive typo and positional argument protection.
        return builtinOptions || plugin.options ? configuredYargs.strict() : configuredYargs;
      },
      handler: async function (parsed: ParsedOptions) {
        const result = await plugin.handler({
          rootDirectoryPath,
          projectConfig,
          datasource,
          parsed,
        } as PluginHandlerOptions);

        if (result === false) {
          commandFailed = true;
        }
      },
    });

    for (const example of plugin.examples) {
      y = y.example(`$0 ${example.command}`, example.description);
    }

    registeredSubcommands.push(subcommand);
  }

  try {
    if (projectConfig && datasource) {
      for (const plugin of [...projectBasedPlugins, ...(projectConfig.plugins || [])]) {
        registerPlugin(plugin);
      }
    } else {
      for (const plugin of nonProjectPlugins) {
        registerPlugin(plugin);
      }

      if (runnerOptions.includeProjectCommands) {
        for (const plugin of projectBasedPlugins) {
          registerPlugin(plugin);
        }
      }
    }

    for (const plugin of commonPlugins) {
      registerPlugin(plugin);
    }

    y = y.command({
      command: "*",
      handler(parsed: ParsedOptions) {
        const unknownCommand = parsed._[0];

        if (unknownCommand) {
          throw new FeaturevisorCLIError(`Unknown command "${unknownCommand}".`, {
            code: "unknown_command",
            details: { command: unknownCommand },
          });
        }

        y.showHelp();
      },
    });

    await y.parseAsync();
  } catch (error) {
    console.error(formatFeaturevisorCLIError(error, { json, pretty }));
    commandFailed = true;
  }

  if (commandFailed) {
    process.exitCode = 1;
  }

  return !commandFailed;
}
