import * as React from "react";
import type { Conditions } from "@featurevisor/types";

import { parseConditions, ConditionOutline, type ConditionNode } from "./conditionExpression";
import { formatComparisonOperator } from "./valueFormat";

function formatValue(value: unknown): string {
  if (typeof value === "undefined") return "";
  if (value === "") return '""';
  if (value === null) return "null";
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);

  return String(value);
}

/** The comparison operator in a condition, set lighter than the operands around it. */
export function Operator(props: { children: React.ReactNode }) {
  return (
    <span className="text-slate-500">
      {typeof props.children === "string"
        ? formatComparisonOperator(props.children)
        : props.children}
    </span>
  );
}

/** Condition operands read as literal values: monospace on a pale tint. */
export function ValueTokens(props: { value: unknown }) {
  const values = Array.isArray(props.value) ? props.value : [props.value];

  if (values.length === 0) {
    return <code className="font-mono text-xs text-slate-800">[]</code>;
  }

  return (
    <>
      {values.map((value, index) => (
        <code
          key={index}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 [overflow-wrap:anywhere]"
        >
          {formatValue(value)}
        </code>
      ))}
    </>
  );
}

/** All selectors and gates share the same expression renderer. */
export function ConditionTree(props: { conditions?: Conditions; setKey?: string }) {
  const node = parseConditions(props.conditions);
  return node ? (
    <div className="rounded-lg border border-border bg-surface px-3 py-3 text-sm sm:px-4">
      <ConditionOutline node={node} setKey={props.setKey} />
    </div>
  ) : (
    <p className="text-sm text-muted">No conditions found.</p>
  );
}

/** The root gate above Rules and Overrides: what it guards, then its conditions. */
export function RootConditionsBox(props: {
  node: ConditionNode;
  children: React.ReactNode;
  setKey?: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-elevated p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
        Root conditions
      </h3>
      <p className="mt-1 text-sm text-muted">{props.children}</p>
      <div className="mt-3 rounded-lg border border-border bg-surface px-3 py-3 sm:px-4">
        <ConditionOutline node={props.node} setKey={props.setKey} />
      </div>
    </section>
  );
}
