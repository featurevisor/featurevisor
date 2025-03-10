import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";
import { ParsedFeature } from "@featurevisor/types";

export async function listProject(deps: Dependencies) {
  const { rootDirectoryPath, projectConfig, datasource, options } = deps;

  if (options.features) {
    const allFeatureKeys = await datasource.listFeatures();

    if (allFeatureKeys.length === 0) {
      console.log("No features found.");
      return;
    }

    const result: ParsedFeature[] = [];
    for (const featureKey of allFeatureKeys) {
      const feature = await datasource.readFeature(featureKey);

      // @TODO: filter

      result.push({
        ...feature,
        key: featureKey,
      });
    }

    if (result.length === 0) {
      console.log("No features found.");
      return;
    }

    if (options.print) {
      console.log(JSON.stringify(result));
      return;
    }

    console.log("\nFeatures:\n");

    for (const feature of result) {
      console.log(`- ${feature.key}`);
    }

    console.log(`\n\nFound ${result.length} features.`);

    return;
  }

  console.log("Nothing to list. Please pass `--features`, `--segments`, or `--attributes`.");
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
