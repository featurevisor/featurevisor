import * as fs from "fs";
import * as path from "path";

const CONFIG_FILE_NAME = "featurevisor.config.js";

export function getRootDirectoryPathArgument(args: string[]) {
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];

    if (argument.startsWith("--rootDirectoryPath=")) {
      return argument.slice("--rootDirectoryPath=".length);
    }

    if (argument.startsWith("--root-directory-path=")) {
      return argument.slice("--root-directory-path=".length);
    }

    if (argument === "--rootDirectoryPath" || argument === "--root-directory-path") {
      return args[index + 1];
    }
  }

  return undefined;
}

export function getCLICommand(args: string[]) {
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];

    if (argument === "--rootDirectoryPath" || argument === "--root-directory-path") {
      index++;
      continue;
    }

    if (argument.startsWith("-")) {
      continue;
    }

    return argument;
  }

  return undefined;
}

export function findProjectRootDirectoryPath(startDirectoryPath: string) {
  let currentDirectoryPath = path.resolve(startDirectoryPath);

  while (true) {
    if (fs.existsSync(path.join(currentDirectoryPath, CONFIG_FILE_NAME))) {
      return currentDirectoryPath;
    }

    const parentDirectoryPath = path.dirname(currentDirectoryPath);
    if (parentDirectoryPath === currentDirectoryPath) {
      return undefined;
    }

    currentDirectoryPath = parentDirectoryPath;
  }
}
