import * as fs from "fs";
import * as path from "path";

import {
  Datasource,
  FeaturevisorCLIError,
  formatFeaturevisorCLIError,
  getProjectConfig,
  runCLI,
} from "@featurevisor/core";

import {
  findProjectRootDirectoryPath,
  getCLICommand,
  getRootDirectoryPathArgument,
} from "./project";

function hasBooleanArgument(args: string[], name: string) {
  return args.some((argument) => argument === `--${name}` || argument === `--${name}=true`);
}

function printVersions() {
  const cliPackage = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  const corePackage = JSON.parse(
    fs.readFileSync(require.resolve("@featurevisor/core/package.json"), "utf8"),
  );

  console.log("\nPackage versions:\n");
  console.log(`  - @featurevisor/cli:  ${cliPackage.version}`);
  console.log(`  - @featurevisor/core: ${corePackage.version}`);
}

async function main() {
  let args = process.argv.slice(2);

  if (
    getCLICommand(args) === "version" ||
    args.some((argument) => argument === "--version" || argument === "-v")
  ) {
    printVersions();
    return;
  }

  const helpCommandIndex = args.indexOf("help");
  if (helpCommandIndex !== -1) {
    args = [...args.slice(0, helpCommandIndex), ...args.slice(helpCommandIndex + 1), "--help"];
    process.argv = [...process.argv.slice(0, 2), ...args];
  }

  const rootDirectoryPathOption = getRootDirectoryPathArgument(args);
  const requestedDirectoryPath = rootDirectoryPathOption
    ? path.resolve(process.cwd(), rootDirectoryPathOption)
    : process.cwd();
  const command = getCLICommand(args);
  const wantsHelp = args.some((argument) => argument === "--help" || argument === "-h");
  const json = hasBooleanArgument(args, "json");
  const pretty = hasBooleanArgument(args, "pretty");
  const projectRootDirectoryPath =
    command === "init" ? undefined : findProjectRootDirectoryPath(requestedDirectoryPath);

  if (!projectRootDirectoryPath) {
    if (command && command !== "init" && !wantsHelp) {
      const error = new FeaturevisorCLIError(
        `No Featurevisor project found from ${requestedDirectoryPath}. Run this command inside a project or pass --rootDirectoryPath=<path>.`,
        {
          code: "project_not_found",
          details: { directoryPath: requestedDirectoryPath },
        },
      );
      console.error(formatFeaturevisorCLIError(error, { json, pretty }));
      process.exitCode = 1;
      return;
    }

    await runCLI({
      rootDirectoryPath: requestedDirectoryPath,
      includeProjectCommands: command !== "init",
    });
    return;
  }

  try {
    const projectConfig = getProjectConfig(projectRootDirectoryPath);
    const datasource = new Datasource(projectConfig, projectRootDirectoryPath);

    await runCLI({
      rootDirectoryPath: projectRootDirectoryPath,
      projectConfig,
      datasource,
    });
  } catch (error) {
    if (wantsHelp) {
      await runCLI({
        rootDirectoryPath: projectRootDirectoryPath,
        includeProjectCommands: true,
      });
      return;
    }

    const configError = new FeaturevisorCLIError(
      `Could not load Featurevisor project configuration: ${error instanceof Error ? error.message : String(error)}`,
      { code: "invalid_project_configuration" },
    );
    console.error(formatFeaturevisorCLIError(configError, { json, pretty }));
    process.exitCode = 1;
  }
}

void main();
