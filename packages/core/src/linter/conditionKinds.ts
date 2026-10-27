import type { Conditions } from "@featurevisor/types";

import type { AllowedConditions, ConditionKind, ConditionLocation } from "../config";
import { visitConditionLocations } from "../datasource/conditionLocations";
import { walkConditionLeaves } from "../datasource/conditions";

type Path = (string | number)[];

export interface ConditionKindIssue {
  path: Path;
  message: string;
}

const KIND_LABELS: Record<ConditionKind, string> = {
  attribute: "Attribute conditions",
  segment: "Segment references",
  feature: "Feature conditions",
  variable: "Global variable conditions",
};

const LOCATION_LABELS: Record<ConditionLocation, string> = {
  segments: "segments",
  features: "feature root conditions",
  rules: "rules",
  force: "force entries",
  featureVariableOverrides: "feature variable overrides",
  variables: "global variable root conditions",
  variableOverrides: "global variable overrides",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A string is a segment key. `{ feature, variable }` reads a feature, so it is a feature. */
function getConditionKind(leaf: unknown): ConditionKind | undefined {
  if (typeof leaf === "string") return "segment";
  if (!isObject(leaf)) return undefined;
  if (typeof leaf.attribute === "string") return "attribute";
  if (typeof leaf.feature === "string") return "feature";
  if (typeof leaf.variable === "string") return "variable";
  return undefined;
}

/**
 * Leaves a location does not accept under `allowedConditions`. Only each location's own
 * leaves are checked: a rule naming a segment is not checked against that segment's leaves.
 */
export function getConditionKindIssues(
  entityType: "segment" | "feature" | "variable",
  definition: unknown,
  allowedConditions: AllowedConditions | undefined,
): ConditionKindIssue[] {
  if (!allowedConditions || !isObject(definition) || definition.archived === true) return [];

  const allows = (location: ConditionLocation, kind: ConditionKind) =>
    allowedConditions[location] === undefined || allowedConditions[location]!.includes(kind);
  const hint = (location: ConditionLocation, kind: ConditionKind) => {
    if (
      kind === "attribute" &&
      location !== "segments" &&
      allows(location, "segment") &&
      allows("segments", "attribute")
    )
      return "Move this condition into a segment and reference the segment";
    if (kind === "segment") return "Use the segment's own conditions here instead";
    if (
      (kind === "feature" || kind === "variable") &&
      (location === "rules" || location === "force") &&
      allows("features", kind)
    )
      return "Move it to the feature's root conditions if it should gate the whole feature";
    return "Remove this condition";
  };

  const issues: ConditionKindIssue[] = [];
  const visit = (location: ConditionLocation, conditions: unknown, path: Path) => {
    if (conditions === undefined || allowedConditions[location] === undefined) return;
    walkConditionLeaves(conditions as Conditions, (leaf, leafPath) => {
      const kind = getConditionKind(leaf);
      if (!kind || allows(location, kind)) return;
      issues.push({
        path: [...path, ...leafPath],
        message: `${KIND_LABELS[kind]} are not allowed in ${LOCATION_LABELS[location]}. ${hint(
          location,
          kind,
        )}, or allow "${kind}" in allowedConditions.${location}.`,
      });
    });
  };

  visitConditionLocations(entityType, definition, visit);

  return issues;
}
