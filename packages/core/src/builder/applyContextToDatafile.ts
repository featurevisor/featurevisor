import type { Conditions, DatafileContent, Context } from "@featurevisor/types";
import { createFeaturevisor } from "@featurevisor/sdk";
import { applyContextToConditions } from "./applyContextToConditions";
import { getConditionReferences } from "../datasource/conditions";
import { refreshDatafileHashes } from "./hashes";

export function applyContextToDatafile(
  original: DatafileContent,
  context: Context,
): DatafileContent {
  const featurevisor = createFeaturevisor({ datafile: original, logLevel: "fatal" });
  const result: DatafileContent = JSON.parse(JSON.stringify(original));
  const referenced = new Set<string>();
  const specialize = (holder: { conditions?: Conditions; segments?: Conditions }) => {
    for (const field of ["conditions", "segments"] as const) {
      if (holder[field] === undefined) continue;
      holder[field] = applyContextToConditions(featurevisor, holder[field]!, context);
      getConditionReferences(holder[field]).segments.forEach((key) => referenced.add(key));
    }
  };
  // Segment references can survive inside a dynamic segment. Keep the complete
  // specialised graph, then remove true segments only when no expression uses them.
  for (const segment of Object.values(result.segments)) specialize(segment);
  const overrides = (
    entries: Record<string, import("@featurevisor/types").VariableOverride[]> | undefined,
  ) => {
    for (const group of Object.values(entries || {}))
      for (const override of group) specialize(override);
  };
  for (const feature of Object.values(result.features)) {
    specialize(feature);
    for (const entry of feature.force || []) specialize(entry);
    for (const entry of feature.traffic || []) {
      specialize(entry);
      overrides(entry.variableOverrides);
    }
    for (const variation of feature.variations || []) overrides(variation.variableOverrides);
    // Only consecutive catch all selectors are redundant. Allocation stays intact.
    feature.traffic = feature.traffic.filter(
      (entry, index, entries) =>
        index === 0 ||
        !(
          (entry.conditions ?? entry.segments) === "*" &&
          (entries[index - 1].conditions ?? entries[index - 1].segments) === "*"
        ),
    );
  }
  for (const variable of Object.values(result.variables || {})) {
    specialize(variable);
    for (const override of variable.overrideProgram || variable.overrides || [])
      specialize(override);
  }
  for (const [key, segment] of Object.entries(result.segments)) {
    if (segment.conditions === "*" && !referenced.has(key)) delete result.segments[key];
  }
  return refreshDatafileHashes(result);
}
