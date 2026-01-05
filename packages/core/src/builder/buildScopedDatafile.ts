import { DatafileContent, Context } from "@featurevisor/types";

import { DatafileReader, createLogger } from "@featurevisor/sdk";

export function buildScopedDatafile(
  originalDatafileContent: DatafileContent,
  context: Context,
): DatafileContent {
  const originalDatafileReader = new DatafileReader({
    datafile: originalDatafileContent,
    logger: createLogger({ level: "fatal" }),
  });

  const scopedDatafileContent: DatafileContent = JSON.parse(
    JSON.stringify(originalDatafileContent),
  );

  // @TODO: implement

  // Phase 1:
  //
  // - segment conditions
  // - feature force (group segments)
  // - feature force (conditions)
  // - feature traffic (group segments)
  // - feature variation => variable overrides (group segments)
  // - feature variation => variable overrides (conditions)
  // - feature traffic consecutive segments with `*` removal

  // Phase 2:
  //
  // - remove segments with "*" as conditions, and replace those segments usage with "*" in feature's group segments
  // - find unused segments and remove them

  return scopedDatafileContent;
}
