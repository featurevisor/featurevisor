import { ProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { REMOVED_GROUPS_MESSAGE } from "../config/removedGroups";
import { FeaturevisorCLIError, formatFeaturevisorCLIError } from "../error";

import {
  getBuiltinCLIOptions,
  getCompatibilityCLIOptions,
  type CLIOptionDefinitions,
} from "./options";
import { commonPlugins, nonProjectPlugins, projectBasedPlugins } from "./plugins";
import { suggestCLIName, suggestUnknownOptions, toDashedOptionName } from "./suggestions";

export interface ParsedOptions {
  _: string[];
  [key: string]: any;
}

export interface PluginHandlerOptions {
  rootDirectoryPath: string;
  cliVersion?: string;
  projectConfig: ProjectConfig;
  datasource: Datasource;
  parsed: ParsedOptions;
}

export interface Plugin {
  command: string;
  description?: string;
  options?: CLIOptionDefinitions;
  /** false fails the command with exit code 1, and a number exits with that code */
  handler: (options: PluginHandlerOptions) => Promise<void | boolean | number>;
  examples: {
    command: string;
    description: string;
  }[];
}

export interface RunnerOptions {
  rootDirectoryPath: string;
  cliVersion?: string;
  projectConfig?: ProjectConfig;
  datasource?: Datasource;
  includeProjectCommands?: boolean;
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
  const json = getBooleanArgument(args, "json") || getBooleanArgument(args, "executionProtocol");
  const pretty = getBooleanArgument(args, "pretty");
  let exitCode = 0;
  const globalOptions: CLIOptionDefinitions = {
    rootDirectoryPath: { type: "string", description: "Featurevisor project directory" },
    help: { type: "boolean" },
    version: { type: "boolean" },
  };
  let activeOptions = globalOptions;
  let y = createYargs(args)
    .scriptName("featurevisor")
    .usage("Usage: $0 <command> [options]")
    .wrap(Math.min(120, Number(process.env.COLUMNS) || process.stdout.columns || 120))
    .option("root-directory-path", {
      type: "string",
      description: "Featurevisor project directory",
    })
    .option("rootDirectoryPath", { type: "string", hidden: true })
    .exitProcess(false)
    .showHelpOnFail(false)
    .fail((message: string, error: unknown) => {
      if (args[0] === "list" && args.some((arg) => /^--groups(?:=|$)/.test(arg))) {
        throw new FeaturevisorCLIError(REMOVED_GROUPS_MESSAGE, { code: "removed_groups" });
      }
      if (error) {
        throw error;
      }

      throw new FeaturevisorCLIError(
        suggestUnknownOptions(message || "Invalid command line arguments.", activeOptions),
        {
          code: "invalid_cli_arguments",
        },
      );
    });
  const registeredSubcommands: string[] = [];
  const registeredPlugins = new Map<string, Plugin>();
  const { rootDirectoryPath, projectConfig, datasource, cliVersion } = runnerOptions;

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
        activeOptions = { ...globalOptions, ...declaredOptions };
        let configuredYargs = commandYargs.options(declaredOptions);

        for (const example of plugin.examples) {
          configuredYargs = configuredYargs.example(`$0 ${example.command}`, example.description);
        }

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
          cliVersion,
          projectConfig,
          datasource,
          parsed,
        } as PluginHandlerOptions);

        if (result === false) {
          exitCode = 1;
        } else if (typeof result === "number") {
          exitCode = result;
        }
      },
    });

    registeredSubcommands.push(subcommand);
    registeredPlugins.set(subcommand, plugin);
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

    for (const command of ["init", "lint", "test", "build", "evaluate", "list"]) {
      const example = registeredPlugins.get(command)?.examples[0];
      if (example) y = y.example(`$0 ${example.command}`, example.description);
    }
    y = y.epilogue("Run featurevisor <command> --help for options and examples.");

    y = y.command({
      command: "*",
      handler(parsed: ParsedOptions) {
        const unknownCommand = parsed._[0];

        if (unknownCommand) {
          const suggestion = suggestCLIName(unknownCommand, registeredSubcommands);
          throw new FeaturevisorCLIError(
            `Unknown command "${unknownCommand}".${suggestion ? ` Did you mean "${suggestion}"?` : ""}`,
            {
              code: "unknown_command",
              details: { command: unknownCommand },
            },
          );
        }

        y.showHelp();
      },
    });

    await y.parseAsync();
  } catch (error) {
    console.error(
      formatFeaturevisorCLIError(error, {
        json,
        pretty,
        verbose: getBooleanArgument(args, "verbose"),
      }),
    );
    exitCode = 1;
  }

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }

  return exitCode === 0;
}
