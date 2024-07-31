import axios from "axios";
import * as tar from "tar";

import { Plugin } from "../cli";

export const DEFAULT_EXAMPLE = "example-yml";

export const EXAMPLES_ORG_NAME = "fahad19";
export const EXAMPLES_REPO_NAME = "featurevisor";
export const EXAMPLES_BRANCH_NAME = "main";

export const EXAMPLES_TAR_URL = `https://codeload.github.com/${EXAMPLES_ORG_NAME}/${EXAMPLES_REPO_NAME}/tar.gz/${EXAMPLES_BRANCH_NAME}`;

function getExamplePath(exampleName: string) {
  return `${EXAMPLES_REPO_NAME}-${EXAMPLES_BRANCH_NAME}/examples/${exampleName}/`;
}

export function initProject(
  directoryPath: string,
  exampleName: string = DEFAULT_EXAMPLE,
): Promise<boolean> {
  return new Promise(function (resolve) {
    axios.get(EXAMPLES_TAR_URL, { responseType: "stream" }).then((response) => {
      response.data
        .pipe(
          tar.x({
            C: directoryPath,
            filter: (path) => path.indexOf(getExamplePath(exampleName)) === 0,
            strip: 3,
          }),
        )
        .on("error", (e) => {
          console.error(e);

          resolve(false);
        })
        .on("finish", () => {
          console.log(`Project scaffolded in ${directoryPath}`);
          console.log(``);
          console.log(`Please run "npm install" in the directory above.`);

          resolve(true);
        });
    });
  });
}

export const initPlugin: Plugin = {
  command: "init",
  handler: async function (options) {
    const { rootDirectoryPath, parsed } = options;

    return initProject(rootDirectoryPath, parsed.example);
  },
  examples: [
    {
      command: "init",
      description: "scaffold a new project in current directory",
    },
    {
      command: "init --example=exampleName",
      description: "scaffold a new project in current directory from known example",
    },
  ],
};
