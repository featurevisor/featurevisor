import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";
import { ParsedFeature } from "@featurevisor/types";

async function listFeatures(deps: Dependencies) {
  const { datasource, options } = deps;

  const result: ParsedFeature[] = [];
  const allFeatureKeys = await datasource.listFeatures();

  if (allFeatureKeys.length === 0) {
    return result;
  }

  for (const featureKey of allFeatureKeys) {
    const feature = await datasource.readFeature(featureKey);

    // @TODO: filter

    result.push({
      ...feature,
      key: featureKey,
    });
  }

  return result;
}

function ucfirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function printResult({ result, entityType, options }) {
  if (options.json) {
    console.log(JSON.stringify(result));
    return;
  }

  if (result.length === 0) {
    console.log(`No ${entityType}s found.`);
    return;
  }

  console.log(`\n${ucfirst(entityType)}s:\n`);

  for (const item of result) {
    console.log(`- ${item.key}`);
  }

  console.log(`\n\nFound ${result.length} ${entityType}s.`);
}

export async function listProject(deps: Dependencies) {
  const { rootDirectoryPath, projectConfig, datasource, options } = deps;

  // features
  if (options.features) {
    const result = await listFeatures(deps);

    return printResult({
      result,
      entityType: "feature",
      options,
    });
  }

  // @TODO: segments
  // @TODO: attributes

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
