import { findDuplicateSegments, DuplicateSegmentsOptions } from "./findDuplicateSegments";
import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";
import { getProjectSetExecutions, printSetHeader } from "../sets";

export async function findDuplicateSegmentsInProject(
  deps: Dependencies,
  options: DuplicateSegmentsOptions = {},
) {
  const duplicates = await findDuplicateSegments(deps, options);

  console.log("");

  if (duplicates.length === 0) {
    console.log("No duplicate segments found");
    return;
  }

  console.log(`Found ${duplicates.length} duplicate(s):\n`);

  duplicates.forEach((entry) => {
    if (options.authors) {
      console.log(`  - Segments: ${entry.segments.join(", ")}`);
      console.log(`    Authors:  ${entry.authors && entry.authors.join(", ")}`);
      console.log("");
    } else {
      console.log(`  - ${entry.segments.join(", ")}`);
    }
  });
}

export const findDuplicateSegmentsPlugin: Plugin = {
  command: "find-duplicate-segments",
  handler: async ({ rootDirectoryPath, projectConfig, datasource, parsed }) => {
    const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);

    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set);

      await findDuplicateSegmentsInProject(
        {
          rootDirectoryPath,
          projectConfig: execution.projectConfig,
          datasource: execution.datasource,
          options: parsed,
        },
        {
          authors: parsed.authors,
        },
      );
    }
  },
  examples: [
    {
      command: "find-duplicate-segments",
      description: "Find duplicate segments in the project",
    },
    {
      command: "find-duplicate-segments --authors",
      description: "Find duplicate segments in the project and list authors",
    },
  ],
};
