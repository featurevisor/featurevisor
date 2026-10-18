import type { AttributeCondition, Conditions, Context, DatafileContent } from "@featurevisor/types";
import {
  allConditionsAreMatched,
  createFeaturevisor,
  getRequiredVariableValueAtPath,
} from "@featurevisor/sdk";
import { getConditionReferences, parseConditions } from "../datasource/conditions";
import { prepareSegmentEvaluations } from "../tester/segments";
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

export interface ConditionProbeNode {
  kind: "and" | "or" | "not" | "leaf";
  leafKind?: "attribute" | "segment" | "feature" | "variable" | "wildcard";
  passed: boolean;
  reliable: boolean;
  children?: ConditionProbeNode[];
  attribute?: string;
  segment?: string;
  feature?: string;
  variable?: string;
  path?: (string | number)[];
  operandPresent?: boolean;
  operand?: unknown;
  operator?: string;
  expectedPresent?: boolean;
  expected?: unknown;
  regexFlags?: string;
  error?: string;
}

export interface ConditionsProbe {
  scope: "root" | "rule" | "force";
  key?: string;
  index?: number;
  passed: boolean;
  expression: ConditionProbeNode;
  reliable: boolean;
}

/** Supplementary checks of every leaf, not an SDK execution trace. */
export function probeConditions(
  datafile: DatafileContent,
  context: Context,
  conditions: Conditions,
): ConditionsProbe {
  const errors: string[] = [];
  const segmentKeys = getConditionReferences(conditions).segments;
  const pending = Array.from(segmentKeys);
  for (let index = 0; index < pending.length; index++) {
    const segment = datafile.segments[pending[index]];
    if (!segment) continue;
    for (const key of getConditionReferences(segment.conditions).segments) {
      if (!segmentKeys.has(key)) {
        segmentKeys.add(key);
        pending.push(key);
      }
    }
  }
  const prepared = prepareSegmentEvaluations(
    datafile,
    Object.fromEntries(
      pending
        .filter((key) => Object.prototype.hasOwnProperty.call(datafile.segments, key))
        .map((key) => [key, datafile.segments[key]]),
    ),
  );
  const sdk = createFeaturevisor({
    datafile: prepared.datafile,
    onDiagnostic: (entry) => {
      if (entry.level === "error") errors.push(entry.message);
    },
  });
  const active = new Set<string>();
  const compare = (condition: AttributeCondition, operand: unknown) =>
    allConditionsAreMatched(
      { ...condition, attribute: "operand" },
      { operand } as Context,
      undefined,
      (entry) => errors.push(entry.message),
    );
  const visit = (raw: Conditions): ConditionProbeNode => {
    const item = parseConditions(raw);
    if (
      Array.isArray(item) ||
      (typeof item === "object" && ("and" in item || "or" in item || "not" in item))
    ) {
      const kind = Array.isArray(item) || "and" in item ? "and" : "or" in item ? "or" : "not";
      const group = Array.isArray(item)
        ? item
        : "and" in item
          ? item.and
          : "or" in item
            ? item.or
            : item.not;
      const children = group.map(visit);
      return {
        kind,
        children,
        passed:
          children.length > 0 &&
          (kind === "and"
            ? children.every((child) => child.passed)
            : kind === "or"
              ? children.some((child) => child.passed)
              : !children.every((child) => child.passed)),
        reliable: children.every((child) => child.reliable),
      };
    }
    const before = errors.length;
    let details: Partial<ConditionProbeNode> = {};
    let passed = false;
    try {
      if (typeof item === "string") {
        if (item === "*") {
          details = { leafKind: "wildcard" };
          passed = true;
        } else {
          details = { leafKind: "segment", segment: item };
          const key = prepared.featureKeys.get(item);
          passed = key ? sdk.isEnabled(key, context) : false;
          const definition = datafile.segments[item];
          if (active.has(item)) errors.push("Circular segment dependency");
          else if (definition) {
            active.add(item);
            try {
              details.children = [visit(definition.conditions)];
            } finally {
              active.delete(item);
            }
          }
        }
      } else if ("variable" in item) {
        let operand: unknown = item.feature
          ? sdk.getVariable(item.feature, item.variable, context)
          : sdk.getVariable(item.variable, context);
        if (item.path !== undefined) operand = getRequiredVariableValueAtPath(operand, item.path);
        passed = compare({ ...item, attribute: "operand" }, operand);
        details = {
          leafKind: "variable",
          variable: item.variable,
          ...(item.feature !== undefined && { feature: item.feature }),
          ...(Array.isArray(item.path) && { path: item.path }),
          operandPresent: operand !== undefined,
          ...(operand !== undefined && { operand }),
          operator: item.operator,
          expectedPresent: own(item, "value"),
          ...(own(item, "value") && { expected: item.value }),
          ...(item.regexFlags !== undefined && { regexFlags: item.regexFlags }),
        };
      } else if ("attribute" in item) {
        let operand: unknown = context;
        for (const part of item.attribute.split(".")) {
          operand =
            operand !== null && typeof operand === "object" && own(operand, part)
              ? operand[part]
              : undefined;
        }
        passed = allConditionsAreMatched(item, context, undefined, (entry) =>
          errors.push(entry.message),
        );
        details = {
          leafKind: "attribute",
          attribute: item.attribute,
          operator: item.operator,
          operandPresent: operand !== undefined,
          ...(operand !== undefined && { operand }),
          expectedPresent: own(item, "value"),
          ...(own(item, "value") && { expected: item.value }),
        };
      } else if ("feature" in item) {
        const enabled = sdk.isEnabled(item.feature, context);
        const variation =
          item.variation !== undefined ? sdk.getVariation(item.feature, context) : undefined;
        passed =
          enabled === (item.enabled ?? true) &&
          (item.variation === undefined || variation === item.variation);
        details = {
          leafKind: "feature",
          feature: item.feature,
          operandPresent: true,
          operand: { enabled, ...(variation !== undefined && { variation }) },
          expectedPresent: true,
          expected: {
            enabled: item.enabled ?? true,
            ...(item.variation !== undefined && { variation: item.variation }),
          },
        };
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    return {
      kind: "leaf",
      passed,
      reliable: errors.length === before,
      ...details,
      ...(errors.length > before && { error: errors.slice(before).join("; ") }),
    };
  };
  try {
    const expression = visit(conditions);
    return { scope: "root", passed: expression.passed, expression, reliable: expression.reliable };
  } finally {
    sdk.close();
  }
}
