import * as fs from "fs";
import * as path from "path";

import { generateTypeScriptCodeForProject } from "./typescript";
import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";

export const ALLOWED_LANGUAGES_FOR_CODE_GENERATION = ["typescript"];

export interface GenerateCodeCLIOptions {
  language: string;
  outDir: string;
  tag?: string | string[];
  react?: boolean;
  individualFeatures?: boolean;
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
    fs.mkdirSync(absolutePath, { recursive: true });
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
    return await generateTypeScriptCodeForProject(deps, absolutePath, {
      tag: cliOptions.tag,
      react: cliOptions.react,
      individualFeatures: cliOptions.individualFeatures,
    });
  }

  throw new Error(`Language ${cliOptions.language} is not supported`);
}

export const generateCodePlugin: Plugin = {
  command: "generate-code",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    await generateCodeForProject(
      {
        rootDirectoryPath,
        projectConfig,
        datasource,
        options: parsed,
      },
      {
        language: parsed.language,
        outDir: parsed.outDir,
        tag: parsed.tag,
        react: parsed.react,
        individualFeatures:
          parsed.individualFeatures !== undefined
            ? Boolean(parsed.individualFeatures)
            : parsed["individual-features"] !== undefined
              ? Boolean(parsed["individual-features"])
              : true,
      },
    );
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
  ],
};
