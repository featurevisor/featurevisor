import * as crypto from "crypto";

import type {
  FeatureKey,
  Feature,
  SegmentKey,
  Segment,
  DatafileContent,
  DatafileVariable,
  VariableKey,
} from "@featurevisor/types";

import { walkConditionLeaves } from "../datasource/conditions";
import type { Conditions } from "@featurevisor/types";

const base62chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

interface HashResult {
  hash: string;
  acyclic: boolean;
}

interface HashComputation {
  memo: Map<string, string>;
}

function generateHashFromString(str: string, length = 10): string {
  const hashBuffer = crypto.createHash("sha256").update(str).digest();

  // Convert buffer to base62 (alphanumeric)
  let num = BigInt("0x" + hashBuffer.toString("hex"));
  let base62 = "";
  while (num > 0) {
    // Convert the remainder to a number for indexing
    const remainder = Number(num % 62n);
    base62 = base62chars[remainder] + base62;
    num = num / 62n;
  }

  // Return first 10 chars for a short hash (adjust length as needed)
  return base62.slice(0, length);
}

type HashNode = ["feature" | "variable" | "segment", string];

function createHashComputer(
  features: Record<FeatureKey, Feature>,
  variables: Record<VariableKey, DatafileVariable>,
  segments: Record<SegmentKey, Segment>,
  segmentHashes: Record<SegmentKey, string> = {},
) {
  const computation: HashComputation = { memo: new Map() };
  const compute = (node: HashNode, visiting: Set<string>): HashResult => {
    const [kind, key] = node;
    const id = JSON.stringify(node);
    const value =
      kind === "feature" ? features[key] : kind === "variable" ? variables[key] : segments[key];
    if (!value) return { hash: kind === "segment" ? segmentHashes[key] || "" : "", acyclic: true };
    const local: Record<string, unknown> = { ...value };
    delete local.hash;
    const content = JSON.stringify({ kind, key, value: local });
    if (visiting.has(id)) return { hash: generateHashFromString(content), acyclic: false };
    const cached = computation.memo.get(id);
    if (cached) return { hash: cached, acyclic: true };
    const nextVisiting = new Set(visiting);
    nextVisiting.add(id);
    const references = new Map<string, HashNode>();
    const add = (reference: HashNode) => references.set(JSON.stringify(reference), reference);
    const conditions = (expression: Conditions | undefined) =>
      walkConditionLeaves(expression, (leaf) => {
        if (typeof leaf === "string") add(["segment", leaf]);
        else if ("variable" in leaf)
          add(leaf.feature === undefined ? ["variable", leaf.variable] : ["feature", leaf.feature]);
        else if ("feature" in leaf) add(["feature", leaf.feature]);
      });
    conditions(value.conditions);
    if (kind === "feature") {
      const feature = value as Feature;
      for (const entry of feature.force || []) conditions(entry.conditions);
      const overrides = (
        entries: Record<string, import("@featurevisor/types").VariableOverride[]> | undefined,
      ) => {
        for (const group of Object.values(entries || {}))
          for (const override of group) conditions(override.conditions);
      };
      for (const entry of feature.traffic || []) {
        conditions(entry.conditions);
        overrides(entry.variableOverrides);
      }
      for (const variation of feature.variations || []) overrides(variation.variableOverrides);
    } else if (kind === "variable") {
      const variable = value as DatafileVariable;
      for (const override of variable.overrideProgram || variable.overrides || [])
        conditions(override.conditions);
      if (typeof variable.compose === "string") add(["variable", variable.compose]);
      else
        for (const entry of variable.compose || [])
          add(
            entry.feature === undefined
              ? ["variable", entry.variable!]
              : ["feature", entry.feature],
          );
    }
    const results = [...references.values()].map((reference) => compute(reference, nextVisiting));
    const hash = generateHashFromString(
      JSON.stringify({ content, dependencies: results.map((result) => result.hash) }),
    );
    const acyclic = results.every((result) => result.acyclic);
    if (acyclic) computation.memo.set(id, hash);
    return { hash, acyclic };
  };
  return compute;
}

export function getSegmentHashes(
  segments: Record<SegmentKey, Segment>,
  features: Record<FeatureKey, Feature> = {},
  variables: Record<VariableKey, DatafileVariable> = {},
): Record<SegmentKey, string> {
  const compute = createHashComputer(features, variables, segments);
  return Object.fromEntries(
    Object.keys(segments).map((key) => [key, compute(["segment", key], new Set()).hash]),
  );
}

export function generateHashForFeature(
  featureKey: FeatureKey,
  features: Record<FeatureKey, Feature>,
  segmentHashes: Record<SegmentKey, string>,
  visiting: Set<string> = new Set(),
  variables: Record<VariableKey, DatafileVariable> = {},
): string {
  return createHashComputer(
    features,
    variables,
    {},
    segmentHashes,
  )(["feature", featureKey], visiting).hash;
}

export function generateHashForVariable(
  variableKey: VariableKey,
  variables: Record<VariableKey, DatafileVariable>,
  features: Record<FeatureKey, Feature>,
  segmentHashes: Record<SegmentKey, string>,
  visiting: Set<string> = new Set(),
): string {
  return createHashComputer(
    features,
    variables,
    {},
    segmentHashes,
  )(["variable", variableKey], visiting).hash;
}

export function generateHashForDatafile(datafileContent: DatafileContent): string {
  const featureHashes = Object.fromEntries(
    Object.entries(datafileContent.features).map(([key, feature]) => [key, feature.hash || ""]),
  );
  return generateHashFromString(
    JSON.stringify({
      schemaVersion: datafileContent.schemaVersion,
      featureHashes,
      variables: datafileContent.variables,
    }),
  );
}

/** Refresh against the completed mixed graph with one memo per synchronous pass. */
export function refreshDatafileHashes(datafileContent: DatafileContent): DatafileContent {
  const compute = createHashComputer(
    datafileContent.features,
    datafileContent.variables || {},
    datafileContent.segments,
  );
  for (const [key, feature] of Object.entries(datafileContent.features))
    feature.hash = compute(["feature", key], new Set()).hash;
  for (const [key, variable] of Object.entries(datafileContent.variables || {}))
    variable.hash = compute(["variable", key], new Set()).hash;
  return datafileContent;
}
