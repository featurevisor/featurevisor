import * as fs from "fs";
import * as path from "path";

import * as mkdirp from "mkdirp";

import { ProjectConfig } from "../config";
import { generateTypeScriptCodeForProject } from "./typescript";

export const ALLOWED_LANGUAGES_FOR_CODE_GENERATION = ["typescript"];

export interface GenerateCodeCLIOptions {
  language: string;
  outputPath: string;
}

export function generateCodeForProject(
  rootDirectoryPath,
  projectConfig: ProjectConfig,
  cliOptions: GenerateCodeCLIOptions,
) {
  if (!cliOptions.language) {
    throw new Error("Option `--language` is required");
  }

  if (!cliOptions.outputPath) {
    throw new Error("Option `--outputPath` is required");
  }

  const absolutePath = path.resolve(rootDirectoryPath, cliOptions.outputPath);

  if (!fs.existsSync(absolutePath)) {
    console.log(`Creating output directory: ${absolutePath}`);
    mkdirp.sync(absolutePath);
  } else {
    console.log(`Output directory already exists at: ${absolutePath}`);
  }

  if (!ALLOWED_LANGUAGES_FOR_CODE_GENERATION.includes(cliOptions.language)) {
    console.log(
      `Only these languages are supported: ${ALLOWED_LANGUAGES_FOR_CODE_GENERATION.join(", ")}`,
    );

    throw new Error(`Language ${cliOptions.language} is not supported for code generation`);
  }

  if (cliOptions.language === "typescript") {
    return generateTypeScriptCodeForProject(rootDirectoryPath, projectConfig, absolutePath);
  }

  throw new Error(`Language ${cliOptions.language} is not supported`);
}
