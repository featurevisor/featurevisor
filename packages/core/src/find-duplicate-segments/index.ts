import { findDuplicateSegments } from "./findDuplicateSegments";
import { Dependencies } from "../dependencies";

export async function findDuplicateSegmentsInProject(deps: Dependencies) {
  const { datasource } = deps;

  const duplicates = await findDuplicateSegments(datasource);

  if (duplicates.length === 0) {
    console.log("No duplicate segments found");
    return;
  }

  console.log(`Found ${duplicates.length} duplicates:\n`);

  duplicates.forEach((segmentKeys) => {
    console.log(`  - ${segmentKeys.join(", ")}`);
  });
}
