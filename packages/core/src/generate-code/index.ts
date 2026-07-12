import * as fs from "fs";
import * as path from "path";

import { generateTypeScriptCodeForProject } from "./typescript";
import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";
import { getProjectSetExecutions, printSetHeader } from "../sets";
import { CLI_COLOR_CYAN, CLI_FORMAT_BOLD, colorize } from "../tester/cliFormat";

export const ALLOWED_LANGUAGES_FOR_CODE_GENERATION = ["typescript"];

export interface GenerateCodeCLIOptions {
  language: string;
  outDir: string;
  tag?: string | string[];
  target?: string | string[];
  react?: boolean;
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
    console.log(`Creating output directory: ${colorize(absolutePath, CLI_COLOR_CYAN)}`);
    fs.mkdirSync(absolutePath, { recursive: true });
  } else {
    console.log(`Output directory already exists at: ${colorize(absolutePath, CLI_COLOR_CYAN)}`);
  }

  if (!ALLOWED_LANGUAGES_FOR_CODE_GENERATION.includes(cliOptions.language)) {
    console.log(CLI_FORMAT_BOLD, "Unsupported language");
    console.log(
      `Only these languages are supported: ${ALLOWED_LANGUAGES_FOR_CODE_GENERATION.join(", ")}`,
    );

    throw new Error(`Language ${cliOptions.language} is not supported for code generation`);
  }

  if (cliOptions.language === "typescript") {
    return await generateTypeScriptCodeForProject(deps, absolutePath, {
      tag: cliOptions.tag,
      target: cliOptions.target,
      react: cliOptions.react,
    });
  }

  throw new Error(`Language ${cliOptions.language} is not supported`);
}

export const generateCodePlugin: Plugin = {
  command: "generate-code",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    if (projectConfig.sets && !parsed.set) {
      throw new Error("Pass --set=<set> when generating code in a project with sets enabled.");
    }

    const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);

    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set);

      await generateCodeForProject(
        {
          rootDirectoryPath,
          projectConfig: execution.projectConfig,
          datasource: execution.datasource,
          options: parsed,
        },
        {
          language: parsed.language,
          outDir: parsed.outDir,
          tag: parsed.tag,
          target: parsed.target,
          react: parsed.react,
        },
      );
    }
  },
  examples: [
    {
      command: "generate-code --language typescript --out-dir src/generated",
      description: "Generate TypeScript code for the project",
    },
    {
      command: "generate-code --language typescript --out-dir src/generated --tag web --react",
      description: "Generate TypeScript and React helper code for tagged features",
    },
    {
      command: "generate-code --language typescript --out-dir src/generated --target web",
      description: "Generate TypeScript code for features selected by a target",
    },
  ],
};
