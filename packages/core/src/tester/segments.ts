import type { DatafileContent, Segment } from "@featurevisor/types";
import type { Evaluation } from "@featurevisor/sdk";
import { compileConditions, walkConditionLeaves } from "../datasource/conditions";
import type { Conditions } from "@featurevisor/types";

/** Match direct check preflight semantics without evaluating getters or stickies. */
export function assertSegmentReferencesInDatafile(
  segmentKey: string,
  datafile: DatafileContent,
  authoredSegments: Record<string, Segment>,
): void {
  type Reference = { segment?: string; feature?: string; variable?: string };
  const pending: Reference[] = [{ segment: segmentKey }];
  const seen = new Set<string>();
  const own = (value: object | undefined, key: string) =>
    !!value && Object.prototype.hasOwnProperty.call(value, key);
  const conditions = (value: Conditions | undefined, legacyFeatures = false) =>
    walkConditionLeaves(value, (leaf) => {
      if (typeof leaf === "string")
        pending.push(legacyFeatures ? { feature: leaf } : { segment: leaf });
      else if ("variable" in leaf) pending.push({ variable: leaf.variable, feature: leaf.feature });
      else if ("feature" in leaf) pending.push({ feature: leaf.feature });
    });
  const selectors = (value: {
    conditions?: Conditions;
    segments?: unknown;
    requiredFeatures?: unknown;
  }) => {
    conditions(value.conditions);
    conditions(value.segments as Conditions | undefined);
    conditions(value.requiredFeatures as Conditions | undefined, true);
  };
  for (let index = 0; index < pending.length; index++) {
    const reference = pending[index];
    const id = JSON.stringify([reference.segment, reference.feature, reference.variable]);
    if (seen.has(id)) continue;
    seen.add(id);
    if (reference.segment !== undefined) {
      const key = reference.segment;
      const segment = own(authoredSegments, key)
        ? authoredSegments[key]
        : own(datafile.segments, key)
          ? datafile.segments[key]
          : undefined;
      if (!segment)
        throw new Error(
          `Segment "${key}" is absent from the selected datafile and test definitions`,
        );
      conditions(segment.conditions);
    } else if (reference.feature !== undefined) {
      const feature = datafile.features[reference.feature];
      if (!own(datafile.features, reference.feature))
        throw new Error(`Feature "${reference.feature}" is absent from the selected datafile`);
      if (reference.variable !== undefined && !own(feature.variablesSchema, reference.variable))
        throw new Error(
          `Feature variable "${reference.feature}.${reference.variable}" is absent from the selected datafile`,
        );
      selectors(feature);
      for (const entry of [...(feature.force || []), ...(feature.traffic || [])]) selectors(entry);
      if (reference.variable !== undefined) {
        for (const entry of [...(feature.traffic || []), ...(feature.variations || [])])
          for (const override of entry.variableOverrides?.[reference.variable] || [])
            selectors(override);
      }
    } else if (reference.variable !== undefined) {
      const variable = datafile.variables?.[reference.variable];
      if (!own(datafile.variables, reference.variable))
        throw new Error(
          `Global variable "${reference.variable}" is absent from the selected datafile`,
        );
      selectors(variable!);
      for (const entry of [...(variable!.overrides || []), ...(variable!.overrideProgram || [])])
        selectors(entry);
      if (typeof variable!.compose === "string") pending.push({ variable: variable!.compose });
      else
        for (const source of variable!.compose || [])
          pending.push({ feature: source.feature, variable: source.variable });
    }
  }
}

/** Test segments through ordinary SDK gates, including dependency sessions. */
export function prepareSegmentEvaluations(
  datafile: DatafileContent,
  segments: Record<string, Segment> = {},
) {
  const featureKeys = new Map<string, string>();
  const keys = Object.keys(segments);
  if (!keys.length) return { datafile, featureKeys, isSynthetic: () => false };
  const features = { ...datafile.features };
  const compiledSegments = { ...datafile.segments };
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(compiledSegments, key))
      compiledSegments[key] = {
        ...segments[key],
        conditions: compileConditions(segments[key].conditions)!,
      };
    let featureKey = `__featurevisor_segment_test__${key}`;
    while (Object.prototype.hasOwnProperty.call(features, featureKey)) featureKey += "_";
    featureKeys.set(key, featureKey);
    features[featureKey] = {
      key: featureKey,
      bucketBy: "__segment_test__",
      conditions: key,
      traffic: [{ key: "segment", conditions: "*", percentage: 100000 }],
    };
  }
  const syntheticKeys = new Set(featureKeys.values());
  return {
    datafile: { ...datafile, features, segments: compiledSegments },
    featureKeys,
    isSynthetic: (evaluation: Evaluation) =>
      !!evaluation.featureKey && syntheticKeys.has(evaluation.featureKey),
  };
}
