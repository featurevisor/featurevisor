import { findDuplicateSegments, DuplicateSegmentsOptions } from "./findDuplicateSegments";
import { Dependencies } from "../dependencies";

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
