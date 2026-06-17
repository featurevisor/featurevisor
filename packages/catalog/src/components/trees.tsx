import type { Condition, GroupSegment } from "@featurevisor/types";

import { Badge } from "./ui";

function InlineValue(props: { value: unknown }) {
  const value = props.value;

  if (value === undefined || value === null || value === "") {
    return <span className="text-muted">n/a</span>;
  }

  if (Array.isArray(value)) {
    return (
      <span className="inline-flex flex-wrap gap-1">
        {value.map((item, index) => (
          <span key={index} className="rounded bg-pill px-1.5 py-0.5">
            <InlineValue value={item} />
          </span>
        ))}
      </span>
    );
  }

  if (typeof value === "object") {
    return (
      <span className="inline-grid gap-1 align-top">
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
          <span key={key} className="rounded bg-pill px-1.5 py-0.5">
            <span className="font-mono text-muted">{key}</span>: <InlineValue value={item} />
          </span>
        ))}
      </span>
    );
  }

  if (typeof value === "boolean") {
    return <>{value ? "true" : "false"}</>;
  }

  return <>{String(value)}</>;
}

export function ConditionTree(props: { conditions?: Condition | Condition[] | "*" }) {
  const value = props.conditions;

  if (!value) {
    return <span className="text-muted">none</span>;
  }

  if (value === "*") {
    return <Badge tone="success">everyone</Badge>;
  }

  if (Array.isArray(value)) {
    return (
      <ul className="space-y-2">
        {value.map((item, index) => (
          <li key={index}>
            <ConditionTree conditions={item} />
          </li>
        ))}
      </ul>
    );
  }

  if ("attribute" in value) {
    return (
      <div className="rounded border border-border bg-elevated p-3 text-sm">
        <span className="font-semibold">{value.attribute}</span>{" "}
        <span className="text-muted">{value.operator}</span>{" "}
        <code>
          <InlineValue value={value.value} />
        </code>
      </div>
    );
  }

  if ("and" in value) {
    return (
      <div className="rounded border border-border bg-elevated p-3">
        <Badge>and</Badge>
        <div className="mt-3">
          <ConditionTree conditions={value.and} />
        </div>
      </div>
    );
  }

  if ("or" in value) {
    return (
      <div className="rounded border border-border bg-elevated p-3">
        <Badge>or</Badge>
        <div className="mt-3">
          <ConditionTree conditions={value.or} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-border bg-elevated p-3">
      <Badge>not</Badge>
      <div className="mt-3">
        <ConditionTree conditions={value.not} />
      </div>
    </div>
  );
}

export function GroupSegmentTree(props: { segments?: GroupSegment | GroupSegment[] | "*" }) {
  const value = props.segments;

  if (!value) {
    return <span className="text-muted">none</span>;
  }

  if (value === "*") {
    return <Badge tone="success">everyone</Badge>;
  }

  if (typeof value === "string") {
    return <Badge>{value}</Badge>;
  }

  if (Array.isArray(value)) {
    return (
      <ul className="space-y-2">
        {value.map((item, index) => (
          <li key={index}>
            <GroupSegmentTree segments={item} />
          </li>
        ))}
      </ul>
    );
  }

  if ("and" in value) {
    return <BooleanGroup label="and" value={value.and} />;
  }

  if ("or" in value) {
    return <BooleanGroup label="or" value={value.or} />;
  }

  return <BooleanGroup label="not" value={value.not} />;
}

function BooleanGroup(props: { label: string; value: GroupSegment[] }) {
  return (
    <div className="rounded border border-border bg-elevated p-3">
      <Badge>{props.label}</Badge>
      <div className="mt-3">
        <GroupSegmentTree segments={props.value} />
      </div>
    </div>
  );
}
