import { Dependencies } from "../dependencies";
import { getMatrixCombinations } from "../tester/matrix";
import { Plugin } from "../cli";

export async function showProjectInfo(deps: Dependencies) {
  const { datasource } = deps;

  console.log("\nProject info:\n");

  const revision = await datasource.readRevision();
  console.log("  - Revision:         ", revision);

  console.log("");

  const attributes = await datasource.listAttributes();
  const segments = await datasource.listSegments();
  const features = await datasource.listFeatures();
  const groups = await datasource.listGroups();

  let variablesCount = 0;
  for (const featureKey of features) {
    const feature = await datasource.readFeature(featureKey);

    if (feature.variablesSchema) {
      variablesCount += feature.variablesSchema.length;
    }
  }

  console.log("  - Total attributes: ", attributes.length);
  console.log("  - Total segments:   ", segments.length);
  console.log("  - Total features:   ", features.length);
  console.log("  - Total variables:  ", variablesCount);
  console.log("  - Total groups:     ", groups.length);

  console.log("");

  const tests = await datasource.listTests();
  console.log("  - Total test specs: ", tests.length);

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

  console.log("  - Total assertions: ", assertionsCount);
}

export const infoPlugin: Plugin = {
  command: "info",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    await showProjectInfo({
      rootDirectoryPath,
      projectConfig,
      datasource,
      options: parsed,
    });
  },
  examples: [
    {
      command: "info",
      description: "show various stats for the project",
    },
  ],
};
