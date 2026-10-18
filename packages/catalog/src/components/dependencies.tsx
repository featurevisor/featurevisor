import * as React from "react";
import { Link } from "react-router-dom";

import { entityLabels, getEntityRoute } from "../entityTypes";
import type {
  CatalogIndex,
  DependencyCheck,
  EntityDetail,
  EntityReference,
  EntitySummary,
} from "../types";
import { useCatalogIndex } from "../useCatalogIndex";
import { getEntityDependencies } from "../dependencyIndex";
import { ConditionCheck, describeConditionCheck } from "./conditionExpression";
import { Badge, EntityChip, OverviewChipLink } from "./ui";

/** One entity's direct and indirect dependencies, in both directions. */
export function useEntityDependencies(detail: EntityDetail | null | undefined, setKey?: string) {
  const { index } = useCatalogIndex(setKey);
  return React.useMemo(() => getEntityDependencies(detail, index), [detail, index]);
}

export function typeName(reference: EntityReference) {
  return entityLabels[reference.type].singular.toLowerCase();
}

const summaryLookups = new WeakMap<CatalogIndex, Map<string, EntitySummary>>();

/** Index summaries by "type:key". Indexes are immutable, so each builds its lookup once. */
export function useSummaryLookup(setKey?: string) {
  const { index } = useCatalogIndex(setKey);

  return React.useMemo(() => {
    let summaries = index ? summaryLookups.get(index) : undefined;
    if (index && !summaries) {
      summaries = new Map();
      for (const [type, rows] of Object.entries(index.entities)) {
        for (const row of rows) summaries.set(`${type}:${row.key}`, row);
      }
      summaryLookups.set(index, summaries);
    }
    return (reference: EntityReference) => summaries?.get(`${reference.type}:${reference.key}`);
  }, [index]);
}

/** A linked reference that names its type, so a segment never reads as a feature. */
export function ReferenceChip(props: {
  reference: EntityReference;
  summary?: EntitySummary;
  setKey?: string;
}) {
  const { reference, summary } = props;

  return (
    <>
      <OverviewChipLink
        to={getEntityRoute(reference.type, reference.key, props.setKey)}
        title={summary?.description || undefined}
      >
        <span className="mr-1 whitespace-nowrap font-normal text-faint">{typeName(reference)}</span>
        {reference.key}
      </OverviewChipLink>
      {summary?.deprecated && <Badge tone="warning">deprecated</Badge>}
    </>
  );
}

/** The entities between two others, read from the one that depends towards the one it needs. */
export function ViaChain(props: { via: EntityReference[]; setKey?: string; label?: string }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted">
      <span>{props.label ?? "through"}</span>
      {props.via.map((step, index) => (
        <React.Fragment key={`${step.type}:${step.key}`}>
          {index > 0 && (
            <span aria-hidden="true" className="text-faint">
              ›
            </span>
          )}
          <Link
            to={getEntityRoute(step.type, step.key, props.setKey)}
            className="hover:text-primary hover:underline [overflow-wrap:anywhere]"
          >
            <span className="text-faint">{typeName(step)}</span>{" "}
            <span className="font-mono">{step.key}</span>
          </Link>
        </React.Fragment>
      ))}
    </span>
  );
}

function describeCompose(compose: NonNullable<DependencyCheck["compose"]>) {
  if (compose.variable !== undefined) return ["composes variable", compose.variable];
  if (compose.variation) return ["composes its variation"];
  return ["composes its value"];
}

/** What one reference reads, such as "has variation treatment" or "composes variable label". */
export function DependencyCheckText(props: { check: DependencyCheck }) {
  const { check } = props;

  if (check.condition) return <ConditionCheck condition={check.condition} />;
  if (check.compose) {
    const [text, code] = describeCompose(check.compose);
    return (
      <>
        <span className="text-xs text-muted">{text}</span>
        {code !== undefined && (
          <code className="font-mono text-xs text-text [overflow-wrap:anywhere]">{code}</code>
        )}
      </>
    );
  }
  return null;
}

export function describeDependencyCheck(check: DependencyCheck) {
  if (check.condition) return describeConditionCheck(check.condition);
  if (check.compose) return describeCompose(check.compose).join(" ");
  return "";
}

/**
 * Who checks each variation and who reads each variable of a feature, from the checks
 * recorded on its direct users.
 */
export function getFeatureReaders(detail: EntityDetail) {
  const variations = new Map<string, EntityReference[]>();
  const variables = new Map<string, EntityReference[]>();
  const add = (map: Map<string, EntityReference[]>, name: string, owner: EntityReference) => {
    const owners = map.get(name) || [];
    if (!owners.some((entry) => entry.type === owner.type && entry.key === owner.key)) {
      owners.push({ type: owner.type, key: owner.key });
    }
    map.set(name, owners);
  };

  for (const owner of detail.usedBy || []) {
    for (const check of owner.checks || []) {
      const condition = check.condition;
      if (condition && typeof condition.variable === "string") {
        add(variables, condition.variable, owner);
      } else if (condition && typeof condition.variation === "string") {
        add(variations, condition.variation, owner);
      }
      if (check.compose?.variable !== undefined) add(variables, check.compose.variable, owner);
    }
  }

  return { variations, variables };
}

/**
 * Linked references with their types, for "Checked by" and "Read by" rows inside cards. These
 * sit beside "Set by", so they use the same rectangular entity chips rather than pills.
 */
export function ReferenceChips(props: { references: EntityReference[]; setKey?: string }) {
  const summaryOf = useSummaryLookup(props.setKey);

  return (
    <>
      {props.references.map((reference) => {
        const summary = summaryOf(reference);
        return (
          <React.Fragment key={`${reference.type}:${reference.key}`}>
            <EntityChip
              to={getEntityRoute(reference.type, reference.key, props.setKey)}
              label={typeName(reference)}
              title={summary?.description || undefined}
              mono
            >
              {reference.key}
            </EntityChip>
            {summary?.deprecated && <Badge tone="warning">deprecated</Badge>}
          </React.Fragment>
        );
      })}
    </>
  );
}
