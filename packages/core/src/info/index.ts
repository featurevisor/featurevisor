import { Dependencies } from "../dependencies";
import { getMatrixCombinations } from "../list/matrix";
import { Plugin } from "../cli";
import { getProjectSetExecutions, printSetHeader } from "../sets";
import { CLI_COLOR_CYAN, CLI_FORMAT_BOLD, colorize } from "../tester/cliFormat";

export async function showProjectInfo(deps: Dependencies) {
  const { datasource } = deps;

  console.log("");
  console.log(CLI_FORMAT_BOLD, "Project info");
  console.log("");

  const revision = await datasource.readRevision();
  console.log(`  ${colorize("Revision", CLI_COLOR_CYAN)}:         ${revision}`);

  console.log("");

  const attributes = await datasource.listAttributes();
  const segments = await datasource.listSegments();
  const features = await datasource.listFeatures();
  const groups = await datasource.listGroups();

  let variablesCount = 0;
  for (const featureKey of features) {
    const feature = await datasource.readFeature(featureKey);

    if (feature.variablesSchema) {
      variablesCount += Object.keys(feature.variablesSchema).length;
    }
  }

  console.log(`  ${colorize("Total attributes", CLI_COLOR_CYAN)}: ${attributes.length}`);
  console.log(`  ${colorize("Total segments", CLI_COLOR_CYAN)}:   ${segments.length}`);
  console.log(`  ${colorize("Total features", CLI_COLOR_CYAN)}:   ${features.length}`);
  console.log(`  ${colorize("Total variables", CLI_COLOR_CYAN)}:  ${variablesCount}`);
  console.log(`  ${colorize("Total groups", CLI_COLOR_CYAN)}:     ${groups.length}`);

  console.log("");

  const tests = await datasource.listTests();
  console.log(`  ${colorize("Total test specs", CLI_COLOR_CYAN)}: ${tests.length}`);

  let assertionsCount = 0;
  for (const test of tests) {
    const testSpec = await datasource.readTest(test);

    for (const assertion of testSpec.assertions) {
      if (assertion.matrix) {
        const combinations = getMatrixCombinations(assertion.matrix);
        assertionsCount += combinations.length;
      } else {
        assertionsCount += 1;
      }
    }
  }

  console.log(`  ${colorize("Total assertions", CLI_COLOR_CYAN)}: ${assertionsCount}`);
}

export const infoPlugin: Plugin = {
  command: "info",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);

    for (const execution of executions) {
      printSetHeader(projectConfig, execution.set);

      await showProjectInfo({
        rootDirectoryPath,
        projectConfig: execution.projectConfig,
        datasource: execution.datasource,
        options: parsed,
      });
    }
  },
  examples: [
    {
      command: "info",
      description: "show various stats for the project",
    },
  ],
};
