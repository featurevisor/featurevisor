import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";
import { ParsedFeature, Segment, Attribute } from "@featurevisor/types";

async function listEntities<T>(deps: Dependencies, entityType): Promise<T[]> {
  const { datasource, options } = deps;

  const result: T[] = [];
  let entityKeys: string[] = [];

  if (entityType === "feature") {
    entityKeys = await datasource.listFeatures();
  } else if (entityType === "segment") {
    entityKeys = await datasource.listSegments();
  } else if (entityType === "attribute") {
    entityKeys = await datasource.listAttributes();
  }

  if (entityKeys.length === 0) {
    return result;
  }

  for (const key of entityKeys) {
    let entity = {} as T;

    if (entityType === "feature") {
      entity = (await datasource.readFeature(key)) as T;
    } else if (entityType === "segment") {
      entity = (await datasource.readSegment(key)) as T;
    } else if (entityType === "attribute") {
      entity = (await datasource.readAttribute(key)) as T;
    }

    // @TODO: filter

    result.push({
      ...entity,
      key,
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
    const result = await listEntities<ParsedFeature>(deps, "feature");

    return printResult({
      result,
      entityType: "feature",
      options,
    });
  }

  // segments
  if (options.segments) {
    const result = await listEntities<Segment>(deps, "segment");

    return printResult({
      result,
      entityType: "segment",
      options,
    });
  }

  // attributes
  if (options.attributes) {
    const result = await listEntities<Attribute>(deps, "attribute");

    return printResult({
      result,
      entityType: "attribute",
      options,
    });
  }

  console.log("\nNothing to list. \n\nPlease pass `--features`, `--segments`, or `--attributes`.");
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
