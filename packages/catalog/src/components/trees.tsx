import type { Condition, GroupSegment } from "@featurevisor/types";

import { CodeBlock, Badge } from "./ui";

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
        <code>{JSON.stringify(value.value)}</code>
      </div>
    );
  }

  return <CodeBlock value={value} />;
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
