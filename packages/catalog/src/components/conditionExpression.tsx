import * as React from "react";

import { fetchEntityDetail } from "../api";
import { getDependencyNodes } from "../dependencyIndex";
import { getEntityRoute } from "../entityTypes";
import type { CatalogIndex, EntitySummary } from "../types";
import { useCatalogIndex } from "../useCatalogIndex";
import { Badge, OverviewChipLink } from "./ui";
import { formatComparisonOperator, formatOperand, formatPath } from "./valueFormat";
import { slugifyFragment } from "./variables";

type Operator = "and" | "or" | "not";

/** An operator, its operand and regex flags, kept apart so each can be styled on its own. */
export type Comparison = { operator?: string; operand?: string; flags?: string };

/** A condition tree reduced to the parts its presentation needs. */
export type ConditionNode =
  | { kind: "group"; operator: Operator; children: ConditionNode[] }
  | { kind: "segment"; segment: string }
  | { kind: "everyone" }
  | { kind: "attribute"; attribute: string; comparison: Comparison }
  | { kind: "feature"; feature: string; variation?: string; enabled?: boolean }
  | { kind: "variable"; feature?: string; variable: string; path?: string; comparison: Comparison };

type LeafNode = Exclude<ConditionNode, { kind: "group" }>;
type GroupNode = Extract<ConditionNode, { kind: "group" }>;

/** A pattern as a regex literal, escaping slashes as JavaScript source does. */
function formatPattern(pattern: string, flags = "") {
  let source = pattern;
  try {
    source = new RegExp(pattern).source;
  } catch {
    // Lint rejects invalid patterns. Show the authored text if one gets through.
  }
  return `/${source}/${flags}`;
}

function toComparison(leaf: Record<string, unknown>, hasValue: boolean): Comparison {
  const flags =
    typeof leaf.regexFlags === "string" && leaf.regexFlags ? leaf.regexFlags : undefined;
  // JSON quoting would double every backslash, so a pattern reads as the regex its author wrote.
  const pattern =
    (leaf.operator === "matches" || leaf.operator === "notMatches") &&
    typeof leaf.value === "string";

  return {
    operator:
      typeof leaf.operator === "string" ? formatComparisonOperator(leaf.operator) : undefined,
    operand: hasValue
      ? pattern
        ? formatPattern(leaf.value as string, flags)
        : formatOperand(leaf.value)
      : undefined,
    flags: pattern ? undefined : flags,
  };
}

/** Operator and operand, as in `equals ""` or `matches /^a/i`. */
function describeComparison(comparison: Comparison) {
  return [
    comparison.operator,
    comparison.operand,
    comparison.flags ? `(flags ${comparison.flags})` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function toLeaf(value: unknown): LeafNode | undefined {
  if (typeof value === "string") {
    return value === "*" ? { kind: "everyone" } : { kind: "segment", segment: value };
  }
  if (!value || typeof value !== "object") return undefined;

  const leaf = value as Record<string, unknown>;
  if (typeof leaf.attribute === "string") {
    return {
      kind: "attribute",
      attribute: leaf.attribute,
      comparison: toComparison(leaf, "value" in leaf),
    };
  }

  if (!("variable" in leaf) && "feature" in leaf) {
    if (typeof leaf.feature !== "string") return undefined;
    return {
      kind: "feature",
      feature: leaf.feature,
      variation: typeof leaf.variation === "string" ? leaf.variation : undefined,
      enabled: typeof leaf.enabled === "boolean" ? leaf.enabled : undefined,
    };
  }

  if (typeof leaf.variable !== "string") return undefined;
  const path = formatPath(leaf.path);

  return {
    kind: "variable",
    feature: typeof leaf.feature === "string" ? leaf.feature : undefined,
    variable: leaf.variable,
    path: path || undefined,
    comparison: toComparison(leaf, "value" in leaf && leaf.value !== undefined),
  };
}

/** A plain array means AND, and a bare string always names a segment. */
export function parseConditions(value: unknown): ConditionNode | undefined {
  if (value === undefined || value === null) return undefined;

  if (Array.isArray(value)) {
    const children = value
      .map((item) => parseConditions(item))
      .filter((item): item is ConditionNode => Boolean(item));
    return children.length === 1 ? children[0] : { kind: "group", operator: "and", children };
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const operator = (["and", "or", "not"] as const).find((key) => key in record);
    if (operator) {
      const items = Array.isArray(record[operator]) ? (record[operator] as unknown[]) : [];
      const children = items
        .map((item) => parseConditions(item))
        .filter((item): item is ConditionNode => Boolean(item));
      return { kind: "group", operator, children };
    }
  }

  return toLeaf(value);
}

/** Read the root gate without treating segment strings as features. */
export function parseEntityConditions(entity: Record<string, unknown>) {
  return parseConditions(entity.conditions);
}

/** `enabled` defaults to true, so a variation alone means enabled with that variation. */
function describeFeatureState(node: Extract<ConditionNode, { kind: "feature" }>) {
  if (node.variation !== undefined) {
    return node.enabled === false ? "is disabled with variation" : "has variation";
  }
  return node.enabled === false ? "is disabled" : "is enabled";
}

function variableName(node: Extract<ConditionNode, { kind: "variable" }>) {
  return node.feature ? `${node.feature} › ${node.variable}` : node.variable;
}

/** `not: [a, b]` negates every child together, so it reads as not (a and b). */
function negatedNode(node: GroupNode): ConditionNode {
  return node.children.length === 1
    ? node.children[0]
    : { kind: "group", operator: "and", children: node.children };
}

/** Plain text form, used for accessible labels, environment comparison and tests. */
export function describeConditions(node: ConditionNode, nested = false): string {
  if (node.kind === "everyone") return "Everyone";
  if (node.kind === "segment") return node.segment;
  if (node.kind === "attribute") {
    return `${node.attribute} ${describeComparison(node.comparison)}`.trim();
  }
  if (node.kind === "feature") {
    const state = describeFeatureState(node);
    return node.variation !== undefined
      ? `${node.feature} ${state} ${formatOperand(node.variation)}`
      : `${node.feature} ${state}`;
  }
  if (node.kind === "variable") {
    const comparison = describeComparison(node.comparison);
    const name = `${variableName(node)}${node.path || ""}`;
    return comparison ? `${name} ${comparison}` : name;
  }

  if (node.children.length === 0) return "No match (empty group)";
  if (node.operator === "not") return `not ${describeConditions(negatedNode(node), true)}`;

  const text = node.children
    .map((child) => describeConditions(child, true))
    .join(` ${node.operator} `);
  return nested && node.children.length > 1 ? `(${text})` : text;
}

/** and, or and not read as structure, set apart from the operands they join. */
function Connector(props: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase leading-5 tracking-wider text-faint">
      {props.children}
    </span>
  );
}

function ComparisonText(props: { comparison: Comparison }) {
  const { operator, operand, flags } = props.comparison;

  return (
    <>
      {operator && <span className="text-xs text-muted">{operator}</span>}
      {operand !== undefined && (
        <code className="font-mono text-xs text-text [overflow-wrap:anywhere]">{operand}</code>
      )}
      {flags && <span className="text-xs text-faint">flags {flags}</span>}
    </>
  );
}

/**
 * What a condition leaf checks on the entity it names, without naming that entity again. Usage
 * lists already show the entity, so they read "has variation treatment" beside it.
 */
export function ConditionCheck(props: { condition: unknown }) {
  const node = toLeaf(props.condition);

  if (node?.kind === "feature") {
    return (
      <>
        <span className="text-xs text-muted">{describeFeatureState(node)}</span>
        {node.variation !== undefined && (
          <code className="font-mono text-xs text-text [overflow-wrap:anywhere]">
            {node.variation}
          </code>
        )}
      </>
    );
  }

  if (node?.kind === "variable") {
    return (
      <>
        {node.feature && (
          <>
            <span className="text-xs text-muted">variable</span>
            <code className="font-mono text-xs text-text [overflow-wrap:anywhere]">
              {node.variable}
            </code>
          </>
        )}
        {node.path && (
          <code className="font-mono text-xs text-text [overflow-wrap:anywhere]">{node.path}</code>
        )}
        <ComparisonText comparison={node.comparison} />
      </>
    );
  }

  return null;
}

/** Plain text of a condition check, for filtering and accessible labels. */
export function describeConditionCheck(condition: unknown) {
  const node = toLeaf(condition);
  if (node?.kind === "feature") {
    return node.variation !== undefined
      ? `${describeFeatureState(node)} ${node.variation}`
      : describeFeatureState(node);
  }
  if (node?.kind === "variable") {
    return [
      node.feature ? `variable ${node.variable}` : "",
      node.path || "",
      describeComparison(node.comparison),
    ]
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

type ReferenceType = "segment" | "attribute" | "feature" | "variable";

const IndexContext = React.createContext<CatalogIndex | null>(null);
/** Segments opened in place above this point, so a chain shows its depth and never loops. */
const SegmentPathContext = React.createContext<string[]>([]);
const MAX_SEGMENT_DEPTH = 6;
const summaryMaps = new WeakMap<
  CatalogIndex,
  Partial<Record<ReferenceType, Map<string, EntitySummary>>>
>();

/** Index summaries are immutable, so each index builds its key lookups once. */
function findSummary(index: CatalogIndex | null, type: ReferenceType, key: string) {
  if (!index) return undefined;
  let maps = summaryMaps.get(index);
  if (!maps) summaryMaps.set(index, (maps = {}));
  let map = maps[type];
  if (!map)
    map = maps[type] = new Map((index.entities[type] || []).map((entity) => [entity.key, entity]));
  return map.get(key);
}

/** A linked reference. Its description shows on hover, and a deprecated reference says so. */
function LeafChip(props: {
  to: string;
  type: ReferenceType;
  /** Omitted for feature variables, whose index summary would describe the feature instead. */
  entityKey?: string;
  children: React.ReactNode;
}) {
  const index = React.useContext(IndexContext);
  const summary = props.entityKey ? findSummary(index, props.type, props.entityKey) : undefined;

  return (
    <>
      <OverviewChipLink to={props.to} title={summary?.description || undefined}>
        <span className="mr-1 whitespace-nowrap font-normal text-faint">{props.type}</span>
        {props.children}
      </OverviewChipLink>
      {summary?.deprecated && <Badge tone="warning">deprecated</Badge>}
    </>
  );
}

/** "reads features" when a segment's membership also depends on features or variables. */
export function describeSegmentReads(index: CatalogIndex | null, segment: string) {
  const dependencies = index ? getDependencyNodes(index, { type: "segment", key: segment }) : [];
  const features = dependencies.some((node) => node.startsWith("feature:"));
  const variables = dependencies.some((node) => node.startsWith("variable:"));
  if (features && variables) return "reads features and variables";
  if (features) return "reads features";
  if (variables) return "reads variables";
  return undefined;
}

/**
 * A segment reference that can open in place to show the segment's own conditions, so a chain
 * of segments reads as one expression. A segment that reads features or variables says so,
 * because its membership changes whenever they do.
 */
function SegmentLeaf(props: { segment: string; setKey?: string }) {
  const index = React.useContext(IndexContext);
  const path = React.useContext(SegmentPathContext);
  const summary = findSummary(index, "segment", props.segment);
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState<{ conditions?: unknown; error?: string }>();
  const reads = React.useMemo(
    () => describeSegmentReads(index, props.segment),
    [index, props.segment],
  );
  const expandable =
    summary !== undefined && !path.includes(props.segment) && path.length < MAX_SEGMENT_DEPTH;

  React.useEffect(() => {
    if (!open || loaded) return;
    let active = true;
    fetchEntityDetail("segment", props.segment, props.setKey)
      .then((detail) => {
        if (active)
          setLoaded({ conditions: (detail.entity as Record<string, unknown>).conditions });
      })
      .catch((error: Error) => active && setLoaded({ error: error.message }));
    return () => {
      active = false;
    };
  }, [open, loaded, props.segment, props.setKey]);

  const node = loaded && !loaded.error ? parseConditions(loaded.conditions) : undefined;

  return (
    <>
      <LeafChip
        type="segment"
        entityKey={props.segment}
        to={getEntityRoute("segment", props.segment, props.setKey)}
      >
        {props.segment}
      </LeafChip>
      {reads && (
        <Badge
          tone="info"
          title="Membership also depends on features or global variables, so it changes when they do."
        >
          {reads}
        </Badge>
      )}
      {expandable && (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} conditions of segment ${props.segment}`}
          title={open ? "Hide its conditions" : "Show its conditions here"}
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-faint transition-colors hover:bg-elevated hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path
              d="M8 6l4 4-4 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {open && (
        <div className="basis-full">
          <div className="mt-1 rounded-md border border-dashed border-border px-2.5 py-2">
            {!loaded ? (
              <span className="text-xs text-muted">Loading conditions…</span>
            ) : loaded.error ? (
              <span className="text-xs text-muted">Could not load this segment.</span>
            ) : node ? (
              <SegmentPathContext.Provider value={[...path, props.segment]}>
                <OutlineBody node={node} setKey={props.setKey} />
              </SegmentPathContext.Provider>
            ) : (
              <span className="text-xs text-muted">No conditions.</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Leaf(props: { node: LeafNode; setKey?: string }) {
  const { node, setKey } = props;

  if (node.kind === "everyone") return <span className="text-sm text-text">Everyone</span>;

  let content: React.ReactNode;
  if (node.kind === "segment") {
    content = <SegmentLeaf segment={node.segment} setKey={setKey} />;
  } else if (node.kind === "attribute") {
    // A dotted path reads a property of its top level attribute, which is what we link to.
    const attribute = node.attribute.split(".")[0];
    content = (
      <>
        <LeafChip
          type="attribute"
          entityKey={attribute}
          to={getEntityRoute("attribute", attribute, setKey)}
        >
          {node.attribute}
        </LeafChip>
        <ComparisonText comparison={node.comparison} />
      </>
    );
  } else if (node.kind === "feature") {
    content = (
      <>
        <LeafChip
          type="feature"
          entityKey={node.feature}
          to={getEntityRoute("feature", node.feature, setKey)}
        >
          {node.feature}
        </LeafChip>
        <span className="text-xs text-muted">{describeFeatureState(node)}</span>
        {node.variation !== undefined && (
          <code className="font-mono text-xs text-text [overflow-wrap:anywhere]">
            {node.variation}
          </code>
        )}
      </>
    );
  } else {
    const to = node.feature
      ? `${getEntityRoute("feature", node.feature, setKey)}/variables#${slugifyFragment(node.variable)}`
      : getEntityRoute("variable", node.variable, setKey);
    // Variable keys may contain dots, so the path sits outside the chip and never reads as part of the key.
    content = (
      <>
        <LeafChip type="variable" entityKey={node.feature ? undefined : node.variable} to={to}>
          {variableName(node)}
        </LeafChip>
        {node.path && (
          <code
            title="Path inside the variable value"
            className="font-mono text-xs text-text [overflow-wrap:anywhere]"
          >
            {node.path}
          </code>
        )}
        <ComparisonText comparison={node.comparison} />
      </>
    );
  }

  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1">
      {content}
    </span>
  );
}

function EmptyGroup() {
  return <span className="text-xs text-muted">No match (empty group)</span>;
}

/** A nested group is indented behind a rule, so its rows never read as siblings of the parent's. */
function Nested(props: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1 border-l-2 border-border pl-2 sm:pl-3">{props.children}</div>
  );
}

/** One row per child, each joined to the row above by the group's operator. */
function GroupRows(props: { node: GroupNode; setKey?: string }) {
  return (
    <ol className="min-w-0 space-y-1.5">
      {props.node.children.map((child, index) => (
        <li key={index} className="flex min-w-0 items-start gap-1.5 sm:gap-2">
          <span className="w-7 shrink-0" aria-hidden={index === 0 || undefined}>
            {index > 0 && <Connector>{props.node.operator}</Connector>}
          </span>
          <div className="min-w-0 flex-1">
            <OutlineItem node={child} setKey={props.setKey} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** An and or or group with more than one child, which needs a row per child. */
function hasRows(node: ConditionNode): node is GroupNode {
  return node.kind === "group" && node.operator !== "not" && node.children.length > 1;
}

function OutlineItem(props: { node: ConditionNode; setKey?: string }) {
  const { node, setKey } = props;

  if (node.kind !== "group") return <Leaf node={node} setKey={setKey} />;
  if (node.children.length === 0) return <EmptyGroup />;

  if (node.operator === "not") {
    const inner = negatedNode(node);
    return (
      <div className="flex min-w-0 items-start gap-2">
        <Connector>not</Connector>
        {hasRows(inner) ? (
          <Nested>
            <GroupRows node={inner} setKey={setKey} />
          </Nested>
        ) : (
          <div className="min-w-0 flex-1">
            <OutlineItem node={inner} setKey={setKey} />
          </div>
        )}
      </div>
    );
  }

  if (node.children.length === 1) return <OutlineItem node={node.children[0]} setKey={setKey} />;

  return (
    <Nested>
      <GroupRows node={node} setKey={setKey} />
    </Nested>
  );
}

/**
 * Conditions as an outline: one row per operand, with and, or and not kept visible.
 * A single leaf stays on one line, and only nested groups are indented.
 */
export function ConditionOutline(props: { node: ConditionNode; setKey?: string }) {
  const { node, setKey } = props;
  const { index } = useCatalogIndex(setKey);

  return (
    <IndexContext.Provider value={index}>
      <OutlineBody node={node} setKey={setKey} />
    </IndexContext.Provider>
  );
}

function OutlineBody(props: { node: ConditionNode; setKey?: string }) {
  const { node, setKey } = props;

  return (
    <div className="min-w-0 text-sm [&_a]:max-w-full [&_a]:[overflow-wrap:anywhere]">
      {hasRows(node) ? (
        <GroupRows node={node} setKey={setKey} />
      ) : (
        <OutlineItem node={node} setKey={setKey} />
      )}
    </div>
  );
}
