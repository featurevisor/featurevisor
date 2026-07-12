import { Link } from "react-router-dom";
import type { Condition, GroupSegment } from "@featurevisor/types";

import { getEntityRoute } from "../entityTypes";
import { Badge, EntityKey } from "./ui";

function formatValue(value: unknown): string {
  if (typeof value === "undefined") return "";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);

  return String(value);
}

function getParentAttributeKey(attributePath: string) {
  return attributePath.split(".")[0];
}

function SegmentLeaf(props: { segmentKey: string; setKey?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="primary">segment</Badge>
        <Link
          to={getEntityRoute("segment", props.segmentKey, props.setKey)}
          className="font-semibold text-primary hover:underline"
        >
          <EntityKey value={props.segmentKey} className="font-semibold" />
        </Link>
      </div>
    </div>
  );
}

function GroupSegmentNode(props: { segment: GroupSegment; setKey?: string }) {
  if (typeof props.segment === "string") {
    return <SegmentLeaf segmentKey={props.segment} setKey={props.setKey} />;
  }

  const operator = "and" in props.segment ? "and" : "or" in props.segment ? "or" : "not";
  const rawChildren = props.segment[operator];
  const children = Array.isArray(rawChildren) ? rawChildren : [rawChildren];

  return (
    <div className="rounded-lg border border-border bg-elevated p-4">
      <div className="mb-3 flex items-center gap-2">
        <Badge tone="neutral">{operator.toUpperCase()}</Badge>
        <span className="text-sm text-muted">
          {children.length} branch{children.length === 1 ? "" : "es"}
        </span>
      </div>
      <div className="ml-3 space-y-3 border-l border-border pl-4">
        {children.map((child, index) => (
          <GroupSegmentNode key={`${operator}-${index}`} segment={child} setKey={props.setKey} />
        ))}
      </div>
    </div>
  );
}

export function GroupSegmentTree(props: {
  segments?: GroupSegment | GroupSegment[] | "*";
  setKey?: string;
}) {
  if (!props.segments) {
    return <p className="text-sm text-muted">No segments found.</p>;
  }

  if (props.segments === "*") {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-sm">
        Everyone
      </div>
    );
  }

  const segments = Array.isArray(props.segments) ? props.segments : [props.segments];

  return (
    <div className="space-y-3">
      {segments.map((segment, index) => (
        <GroupSegmentNode key={index} segment={segment} setKey={props.setKey} />
      ))}
    </div>
  );
}

function ConditionLeaf(props: { condition: Record<string, any>; setKey?: string }) {
  if ("attribute" in props.condition) {
    const attributePath = String(props.condition.attribute);

    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="primary">attribute</Badge>
          <Link
            to={getEntityRoute("attribute", getParentAttributeKey(attributePath), props.setKey)}
            className="font-semibold text-primary hover:underline"
          >
            {attributePath}
          </Link>
          <span className="font-medium text-text">{props.condition.operator}</span>
          {"value" in props.condition && (
            <span className="text-muted">{formatValue(props.condition.value)}</span>
          )}
        </div>
      </div>
    );
  }

  if ("feature" in props.condition) {
    const featureKey = String(props.condition.feature);

    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="success">feature</Badge>
          <Link
            to={getEntityRoute("feature", featureKey, props.setKey)}
            className="font-semibold text-primary hover:underline"
          >
            <EntityKey value={featureKey} className="font-semibold" />
          </Link>
          <span className="font-medium text-text">{props.condition.operator}</span>
          {"value" in props.condition && (
            <span className="text-muted">{formatValue(props.condition.value)}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted shadow-sm">
      Unsupported condition
    </div>
  );
}

function ConditionNode(props: { condition: Condition; setKey?: string }) {
  const condition = props.condition as any;

  if (typeof condition === "string") {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-sm">
        {condition === "*" ? "Everyone" : condition}
      </div>
    );
  }

  if ("and" in condition || "or" in condition || "not" in condition) {
    const operator = "and" in condition ? "and" : "or" in condition ? "or" : "not";
    const rawChildren = condition[operator];
    const children = Array.isArray(rawChildren) ? rawChildren : [rawChildren];

    return (
      <div className="rounded-lg border border-border bg-elevated p-4">
        <div className="mb-3 flex items-center gap-2">
          <Badge tone="neutral">{operator.toUpperCase()}</Badge>
          <span className="text-sm text-muted">
            {children.length} branch{children.length === 1 ? "" : "es"}
          </span>
        </div>
        <div className="ml-3 space-y-3 border-l border-border pl-4">
          {children.map((child, index) => (
            <ConditionNode key={`${operator}-${index}`} condition={child} setKey={props.setKey} />
          ))}
        </div>
      </div>
    );
  }

  return <ConditionLeaf condition={condition} setKey={props.setKey} />;
}

export function ConditionTree(props: {
  conditions?: Condition | Condition[] | "*";
  setKey?: string;
}) {
  if (!props.conditions) {
    return <p className="text-sm text-muted">No conditions found.</p>;
  }

  if (props.conditions === "*") {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-sm">
        Everyone
      </div>
    );
  }

  const conditions = Array.isArray(props.conditions) ? props.conditions : [props.conditions];

  return (
    <div className="space-y-3">
      {conditions.map((condition, index) => (
        <ConditionNode key={index} condition={condition} setKey={props.setKey} />
      ))}
    </div>
  );
}
