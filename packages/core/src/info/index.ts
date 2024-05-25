import { Dependencies } from "../dependencies";
import { getMatrixCombinations } from "../tester/matrix";

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

  console.log("  - Total attributes: ", attributes.length);
  console.log("  - Total segments:   ", segments.length);
  console.log("  - Total features:   ", features.length);
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
