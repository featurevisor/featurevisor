import * as fs from "fs";
import * as path from "path";

import * as mkdirp from "mkdirp";

import { generateTypeScriptCodeForProject } from "./typescript";
import { Dependencies } from "../dependencies";

export const ALLOWED_LANGUAGES_FOR_CODE_GENERATION = ["typescript"];

export interface GenerateCodeCLIOptions {
  language: string;
  outDir: string;
}

export async function generateCodeForProject(
  deps: Dependencies,
  cliOptions: GenerateCodeCLIOptions,
) {
  const { rootDirectoryPath } = deps;

  if (!cliOptions.language) {
    throw new Error("Option `--language` is required");
  }

  if (!cliOptions.outDir) {
    throw new Error("Option `--out-dir` is required");
  }

  const absolutePath = path.resolve(rootDirectoryPath, cliOptions.outDir);

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
    return await generateTypeScriptCodeForProject(deps, absolutePath);
  }

  throw new Error(`Language ${cliOptions.language} is not supported`);
}
