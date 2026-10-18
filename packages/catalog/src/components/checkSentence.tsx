import * as React from "react";
import { Link } from "react-router-dom";
import type { TestCheck, TestVariableReference } from "@featurevisor/types";

import { getEntityRoute } from "../entityTypes";
import { Operator, ValueTokens } from "./trees";
import { EntityKey } from "./ui";
import {
  formatComparison,
  formatComparisonOperator,
  formatOperand,
  formatPath,
} from "./valueFormat";

export type CheckLogic = "and" | "or" | "not";

export function getCheckLogic(
  check: TestCheck,
): { operator: CheckLogic; checks: TestCheck[] } | undefined {
  for (const operator of ["and", "or", "not"] as const) {
    if (operator in check) return { operator, checks: check[operator] };
  }
  return undefined;
}

/** How a group reads. "not" fails only when every child holds, matching the CLI. */
export function describeCheckLogic(operator: CheckLogic, count: number) {
  if (operator === "and") return "All of these hold";
  if (operator === "or") return "At least one of these holds";
  return count === 1 ? "This does not hold" : "These do not all hold";
}

function referenceName(reference: TestVariableReference, ownerVariable?: string) {
  const variable = reference.variable || ownerVariable || "value";
  const name = reference.feature ? `${reference.feature} › ${variable}` : variable;
  return `${name}${formatPath(reference.path)}`;
}

/** Plain text form of one check, used for tests and accessible labels. */
export function describeCheck(check: TestCheck, ownerVariable?: string): string {
  const logic = getCheckLogic(check);
  if (logic) return describeCheckLogic(logic.operator, logic.checks.length);

  if ("segment" in check && check.segment) {
    return `context ${check.matches ? "matches" : "does not match"} segment ${check.segment}`;
  }

  if ("enabled" in check || "variation" in check) {
    const feature = (check as { feature: string }).feature;
    const enabled = (check as { enabled?: boolean }).enabled;
    const hasVariation = "variation" in check;
    const variation = (check as { variation?: string | null }).variation;
    const parts = [feature];
    if (enabled !== undefined) parts.push(enabled ? "is enabled" : "is disabled");
    if (hasVariation) {
      const phrase = variation === null ? "no variation" : `variation ${formatOperand(variation)}`;
      parts.push(enabled === undefined ? `has ${phrase}` : `with ${phrase}`);
    }
    return parts.join(" ");
  }

  const comparison = check as TestVariableReference & {
    operator?: string;
    value?: unknown;
    compareTo?: TestVariableReference;
    regexFlags?: string;
  };
  const name = referenceName(comparison, ownerVariable);
  if (comparison.compareTo) {
    return [
      name,
      comparison.operator ? formatComparisonOperator(comparison.operator) : undefined,
      referenceName(comparison.compareTo, ownerVariable),
      comparison.regexFlags ? `(flags ${comparison.regexFlags})` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    name,
    formatComparison({
      operator: comparison.operator,
      value: comparison.value,
      hasValue: "value" in comparison && comparison.value !== undefined,
      regexFlags: comparison.regexFlags,
    }),
  ]
    .filter(Boolean)
    .join(" ");
}

function Muted(props: { children: React.ReactNode }) {
  return <span className="text-muted">{props.children}</span>;
}

function EntityLink(props: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={props.to}
      className="font-mono text-xs font-semibold text-primary hover:underline [overflow-wrap:anywhere]"
    >
      {props.children}
    </Link>
  );
}

function Reference(props: {
  reference: TestVariableReference;
  ownerVariable?: string;
  setKey?: string;
}) {
  const { reference, setKey } = props;
  const variable = reference.variable || props.ownerVariable;
  const path = formatPath(reference.path);

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center">
      {reference.feature ? (
        <EntityLink to={getEntityRoute("feature", reference.feature, setKey)}>
          <EntityKey value={reference.feature} /> › {variable || "value"}
        </EntityLink>
      ) : variable ? (
        <EntityLink to={getEntityRoute("variable", variable, setKey)}>
          <EntityKey value={variable} />
        </EntityLink>
      ) : (
        <Muted>value</Muted>
      )}
      {path && <code className="font-mono text-xs text-text">{path}</code>}
    </span>
  );
}

/** One check written as a short sentence with its entities linked. */
export function CheckSentence(props: {
  check: TestCheck;
  ownerVariable?: string;
  setKey?: string;
}) {
  const { check, setKey } = props;
  const logic = getCheckLogic(check);

  if (logic) {
    return <Muted>{describeCheckLogic(logic.operator, logic.checks.length)}</Muted>;
  }

  if ("segment" in check && check.segment) {
    return (
      <>
        <Muted>Context {check.matches ? "matches" : "does not match"} segment</Muted>
        <EntityLink to={getEntityRoute("segment", check.segment, setKey)}>
          <EntityKey value={check.segment} />
        </EntityLink>
      </>
    );
  }

  if ("enabled" in check || "variation" in check) {
    const feature = (check as { feature: string }).feature;
    const enabled = (check as { enabled?: boolean }).enabled;
    const hasVariation = "variation" in check;
    const variation = (check as { variation?: string | null }).variation;

    return (
      <>
        <EntityLink to={getEntityRoute("feature", feature, setKey)}>
          <EntityKey value={feature} />
        </EntityLink>
        {enabled !== undefined && <Muted>{enabled ? "is enabled" : "is disabled"}</Muted>}
        {hasVariation &&
          (variation === null ? (
            <Muted>{enabled === undefined ? "has no variation" : "with no variation"}</Muted>
          ) : (
            <>
              <Muted>{enabled === undefined ? "has variation" : "with variation"}</Muted>
              <ValueTokens value={variation} />
            </>
          ))}
      </>
    );
  }

  const comparison = check as TestVariableReference & {
    operator?: string;
    value?: unknown;
    compareTo?: TestVariableReference;
    regexFlags?: string;
  };

  return (
    <>
      <Reference reference={comparison} ownerVariable={props.ownerVariable} setKey={setKey} />
      {comparison.operator && <Operator>{comparison.operator}</Operator>}
      {comparison.compareTo ? (
        <Reference
          reference={comparison.compareTo}
          ownerVariable={props.ownerVariable}
          setKey={setKey}
        />
      ) : (
        "value" in comparison &&
        comparison.value !== undefined && <ValueTokens value={comparison.value} />
      )}
      {comparison.regexFlags && <Muted>(flags {comparison.regexFlags})</Muted>}
    </>
  );
}
