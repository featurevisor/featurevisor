import { findDuplicateSegments, DuplicateSegmentsOptions } from "./findDuplicateSegments";
import { Dependencies } from "../dependencies";
import { Plugin } from "../cli";
import { getProjectSetExecutions, printSetHeader } from "../sets";
import {
  CLI_COLOR_CYAN,
  CLI_FORMAT_BOLD,
  CLI_FORMAT_GREEN,
  CLI_FORMAT_YELLOW,
  colorize,
} from "../tester/cliFormat";

export async function findDuplicateSegmentsInProject(
  deps: Dependencies,
  options: DuplicateSegmentsOptions = {},
) {
  const duplicates = await findDuplicateSegments(deps, options);

  console.log("");
  console.log(CLI_FORMAT_BOLD, "Finding duplicate Featurevisor segments");

  if (duplicates.length === 0) {
    console.log(CLI_FORMAT_GREEN, "No duplicate segments found");
    return;
  }

  console.log(CLI_FORMAT_YELLOW, `Found ${duplicates.length} duplicate(s):`);
  console.log("");

  duplicates.forEach((entry) => {
    if (options.authors) {
      console.log(`  ${colorize("•", CLI_COLOR_CYAN)} Segments: ${entry.segments.join(", ")}`);
      console.log(
        `    ${colorize("Authors", CLI_COLOR_CYAN)}:  ${entry.authors && entry.authors.join(", ")}`,
      );
      console.log("");
    } else {
      console.log(`  ${colorize("•", CLI_COLOR_CYAN)} ${entry.segments.join(", ")}`);
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
