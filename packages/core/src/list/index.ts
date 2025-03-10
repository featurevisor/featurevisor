import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";

export async function listProject(deps: Dependencies) {
  const { rootDirectoryPath, projectConfig } = deps;

  console.log("Listing project...");
}

export const listPlugin: Plugin = {
  command: "list",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    await listProject({
      rootDirectoryPath,
      projectConfig,
      datasource,
      options: parsed,
    });
  },
  examples: [
    {
      command: "list",
      description: "list entities",
    },
  ],
};
