import * as React from "react";
import { Link } from "react-router-dom";

import { entityLabels, getEntityRoute } from "../../entityTypes";
import type {
  CatalogEntityType,
  CatalogIndex,
  DirectDependency,
  EntityDetail,
  EntityReference,
  IndirectDependency,
} from "../../types";
import { Badge, EmptyState, EntityKey } from "../../components/ui";
import { RelatedEntities } from "../../components/relatedEntities";
import {
  DependencyCheckText,
  ViaChain,
  describeDependencyCheck,
  typeName,
  useEntityDependencies,
  useSummaryLookup,
} from "../../components/dependencies";
import { getNearestOwners, type EntityDependencies } from "../../dependencyIndex";
import { useCatalogIndex } from "../../useCatalogIndex";
import { slugifyFragment, useEntityDetail } from "./shared";

/** Link a usage location such as "rules › production › germany" to its tab and anchor. */
function getUsageLocationRoute(
  owner: { type: CatalogEntityType; key: string },
  location: string,
  environments: string[],
  setKey?: string,
) {
  const ownerRoute = getEntityRoute(owner.type, owner.key, setKey);
  if (location.startsWith("compose ") || location.startsWith("alias of ")) return ownerRoute;
  const parts = location.split(" (inside ")[0].split(" › ");
  const tab = parts[0];

  // Root conditions and bucketing live on the overview.
  if (["bucketBy", "conditions"].includes(tab)) {
    return ownerRoute;
  }

  // "variation treatment › variable overrides › variable baz › #1" links to that
  // override on the Variations tab, which expands the section from the anchor.
  if (tab.startsWith("variation ")) {
    const variationSlug = slugifyFragment(tab.slice("variation ".length));
    const variablePart = parts.find(
      (part) => part.startsWith("variable ") && part !== "variable overrides",
    );
    const section = parts.includes("variable overrides") ? "overrides" : "variables";

    return variablePart
      ? `${ownerRoute}/variations#${variationSlug}-${section}-${slugifyFragment(variablePart.slice("variable ".length))}`
      : `${ownerRoute}/variations`;
  }

  if (!["rules", "force", "overrides"].includes(tab)) {
    return undefined;
  }

  const anchorParts: string[] = [];
  for (const part of parts) {
    // Root conditions were handled above. Elsewhere this can be an authored key.
    if (part === "variable overrides") break;
    if (part.startsWith("variable ")) break;
    anchorParts.push(part);
  }

  const environment = environments.includes(anchorParts[1]) ? anchorParts[1] : undefined;
  const path = environment ? `${tab}/${environment}` : tab;

  return `${ownerRoute}/${path}#${slugifyFragment(anchorParts.join("-"))}`;
}

/**
 * A location as readers say it: positions get a noun, "variable overrides" is implied by the
 * variable that follows it, and an alias needs no repeat of the page's own key.
 */
export function formatUsageLocation(path: string) {
  if (path.startsWith("alias of ")) return "alias";
  if (path.startsWith("compose ")) return `property ${path.slice("compose ".length)}`;
  const parts = path.split(" › ");
  const noun =
    parts.includes("variable overrides") || parts[0] === "overrides"
      ? "override"
      : parts[0] === "force"
        ? "entry"
        : parts[0] === "rules"
          ? "rule"
          : undefined;
  return parts
    .filter((part) => part !== "variable overrides")
    .map((part) => (noun && /^#\d+$/.test(part) ? `${noun} ${part.slice(1)}` : part))
    .join(" › ");
}

/** Lists longer than this start collapsed and gain a filter, like related entities. */
const INITIAL_LIMIT = 12;

function ListHeading(props: { title: string; count: number; children?: React.ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {props.title}
        <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold tabular-nums tracking-normal text-slate-600">
          {props.count}
        </span>
      </h3>
      {props.children}
    </div>
  );
}

/** A bordered list that collapses and gains a filter once it is long. */
function FilterableList<T>(props: {
  title: string;
  noun: string;
  items: T[];
  itemKey: (item: T) => string;
  itemText: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
}) {
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const long = props.items.length > INITIAL_LIMIT;
  const normalized = query.trim().toLowerCase();
  const matches = normalized
    ? props.items.filter((item) => props.itemText(item).toLowerCase().includes(normalized))
    : props.items;
  const visible = expanded || normalized ? matches : matches.slice(0, INITIAL_LIMIT);

  return (
    <section>
      <ListHeading title={props.title} count={props.items.length}>
        {long && (
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Filter ${props.noun}...`}
            aria-label={`Filter ${props.title.toLowerCase()}`}
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text outline-none placeholder:text-faint focus:border-slate-400 sm:w-52"
          />
        )}
      </ListHeading>
      <div className="overflow-hidden rounded-lg border border-border">
        {visible.length > 0 ? (
          <ul className="divide-y divide-border">
            {visible.map((item) => (
              <li key={props.itemKey(item)} className="px-4 py-3">
                {props.renderItem(item)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">
            No {props.noun} match “{query}”.
          </p>
        )}
        {long && !normalized && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="w-full border-t border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-elevated hover:text-text"
          >
            {expanded ? "Show fewer" : `Show all ${props.items.length} ${props.noun}`}
          </button>
        )}
      </div>
    </section>
  );
}

function ReferenceHeading(props: {
  reference: EntityReference;
  showType?: boolean;
  setKey?: string;
}) {
  const summaryOf = useSummaryLookup(props.setKey);
  const summary = summaryOf(props.reference);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {props.showType && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
          {typeName(props.reference)}
        </span>
      )}
      <Link
        to={getEntityRoute(props.reference.type, props.reference.key, props.setKey)}
        className="text-sm font-semibold text-primary hover:underline [overflow-wrap:anywhere]"
      >
        <EntityKey value={props.reference.key} className="font-semibold" />
      </Link>
      {summary?.deprecated && <Badge tone="warning">deprecated</Badge>}
      {summary?.archived && <Badge tone="danger">archived</Badge>}
      {summary?.description && (
        <span className="min-w-0 truncate text-xs text-muted">{summary.description}</span>
      )}
    </div>
  );
}

/**
 * Where a direct reference is authored, linked to that place, with what it checks there.
 * `owner` is the entity holding the authored text.
 */
function DirectLocations(props: {
  entry: DirectDependency;
  owner: EntityReference;
  environments: string[];
  setKey?: string;
}) {
  const { entry, owner } = props;

  return (
    <ul className="mt-1.5 space-y-1">
      {entry.locations.map((location) => {
        const route = getUsageLocationRoute(owner, location, props.environments, props.setKey);
        const [rawPath, inside] = location.split(" (inside ");
        // Everything in a segment is its conditions, so only the grouping is worth saying.
        const path =
          owner.type === "segment" && rawPath === "conditions"
            ? undefined
            : formatUsageLocation(rawPath);
        const checks = (entry.checks || []).filter((check) => check.location === location);

        return (
          <li key={location} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {path &&
              (route ? (
                <Link
                  to={route}
                  className="font-mono text-muted hover:text-primary hover:underline"
                >
                  {path}
                </Link>
              ) : (
                <span className="font-mono text-muted">{path}</span>
              ))}
            {inside && <Badge>{`inside ${inside.replace(/\)$/, "")}`}</Badge>}
            {checks.map((check, index) => (
              <span key={index} className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <DependencyCheckText check={check} />
              </span>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

function directText(entry: DirectDependency) {
  return [
    entry.key,
    ...entry.locations.map((location) => formatUsageLocation(location)),
    ...(entry.checks || []).map(describeDependencyCheck),
  ].join(" ");
}

function indirectText(entry: IndirectDependency) {
  return [entry.key, typeName(entry), ...entry.via.map((step) => step.key)].join(" ");
}

const GROUP_TYPES: CatalogEntityType[] = ["feature", "variable", "segment", "attribute"];

function groupByType<T extends EntityReference>(entries: T[]) {
  return GROUP_TYPES.map(
    (type) => [type, entries.filter((entry) => entry.type === type)] as const,
  ).filter(([, group]) => group.length > 0);
}

function IndirectList(props: { entries: IndirectDependency[]; setKey?: string }) {
  return (
    <FilterableList
      title="Through other entities"
      noun="entities"
      items={props.entries}
      itemKey={(entry) => `${entry.type}:${entry.key}`}
      itemText={indirectText}
      renderItem={(entry) => (
        <>
          <ReferenceHeading reference={entry} showType setKey={props.setKey} />
          <div className="mt-1">
            <ViaChain via={entry.via} setKey={props.setKey} />
          </div>
        </>
      )}
    />
  );
}

function UsageBlock(props: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-text">{props.title}</h2>
        <p className="mt-0.5 text-sm text-muted">{props.description}</p>
      </div>
      {props.children}
    </section>
  );
}

/** Who refers to this entity, directly and through others. */
function UsedByBlock(props: {
  detail: EntityDetail;
  dependencies: EntityDependencies;
  setKey?: string;
}) {
  const { detail, setKey } = props;
  const usedBy = detail.usedBy || [];
  const indirect = props.dependencies.usedIndirectlyBy;
  if (!usedBy.length && !indirect.length) return null;
  const label = entityLabels[detail.type].singular.toLowerCase();

  return (
    <UsageBlock
      title="Used by"
      description={`What refers to this ${label}, and what reaches it through them. A change here can change their results.`}
    >
      {groupByType(usedBy).map(([type, entries]) => (
        <FilterableList
          key={type}
          title={entityLabels[type].plural}
          noun={entityLabels[type].plural.toLowerCase()}
          items={entries}
          itemKey={(entry) => `${entry.type}:${entry.key}`}
          itemText={directText}
          renderItem={(entry) => (
            <>
              <ReferenceHeading reference={entry} setKey={setKey} />
              <DirectLocations
                entry={entry}
                owner={entry}
                environments={detail.environments || []}
                setKey={setKey}
              />
            </>
          )}
        />
      ))}
      {indirect.length > 0 && <IndirectList entries={indirect} setKey={setKey} />}
    </UsageBlock>
  );
}

/** What this entity refers to, directly and through others. */
function DependsOnBlock(props: {
  detail: EntityDetail;
  dependencies: EntityDependencies;
  setKey?: string;
}) {
  const { detail, setKey } = props;
  const uses = props.dependencies.uses;
  const indirect = props.dependencies.usesIndirectly;
  if (!uses.length && !indirect.length) return null;
  const label = entityLabels[detail.type].singular.toLowerCase();

  return (
    <UsageBlock
      title="Depends on"
      description={`What this ${label} refers to, and what those refer to in turn. A change to any of them can change its result.`}
    >
      {groupByType(uses).map(([type, entries]) => (
        <FilterableList
          key={type}
          title={entityLabels[type].plural}
          noun={entityLabels[type].plural.toLowerCase()}
          items={entries}
          itemKey={(entry) => `${entry.type}:${entry.key}`}
          itemText={directText}
          renderItem={(entry) => (
            <>
              <ReferenceHeading reference={entry} setKey={setKey} />
              <DirectLocations
                entry={entry}
                owner={{ type: detail.type, key: detail.key }}
                environments={detail.environments || []}
                setKey={setKey}
              />
            </>
          )}
        />
      ))}
      {indirect.length > 0 && <IndirectList entries={indirect} setKey={setKey} />}
    </UsageBlock>
  );
}

const TARGET_NOTE_NAMES = 3;

/** Why each entity sits in a Target's datafile when the Target did not select it. */
function getTargetNotes(
  detail: EntityDetail,
  type: CatalogEntityType,
  values: string[] | undefined,
  index: CatalogIndex | null,
) {
  const relationships = detail.relationships || {};
  const members = new Set([
    ...(relationships.features || []).map((key) => `feature:${key}`),
    ...(relationships.variables || []).map((key) => `variable:${key}`),
  ]);
  const notes: Record<string, string> = {};
  const badges: Record<string, string> = {};
  const name = (owner: EntityReference) =>
    owner.type === "feature" ? owner.key : `${typeName(owner)} ${owner.key}`;

  for (const key of values || []) {
    const id = `${type}:${key}`;
    const chain = detail.contentPulledIn?.[id];
    // The export names owners of features and variables. Segments have many, so the index does.
    const owners =
      type === "segment"
        ? index
          ? getNearestOwners(index, { type, key }).filter((owner) =>
              members.has(`${owner.type}:${owner.key}`),
            )
          : undefined
        : detail.contentRequiredBy?.[id];
    if (chain?.length) {
      badges[key] = "dependency";
      const [selected, ...through] = chain;
      notes[key] = `Pulled in by ${name(selected)}${
        through.length ? ` through ${through.map(name).join(" › ")}` : ""
      }`;
    } else if (owners?.length) {
      // A widely used segment can have hundreds of owners, so name only the first few.
      const shown = owners.slice(0, TARGET_NOTE_NAMES).map(name).join(", ");
      const more = owners.length - TARGET_NOTE_NAMES;
      notes[key] = `${type === "segment" ? "Used" : "Required"} by ${shown}${
        more > 0 ? ` and ${more} more` : ""
      }`;
    }
  }

  return { notes, badges };
}

/** The related entity lists for Targets and schemas, and the Targets an entity is in. */
function getRelatedSections(detail: EntityDetail, index: CatalogIndex | null = null) {
  const relationships = detail.relationships || {};
  const sections: Array<{
    title: string;
    type: CatalogEntityType;
    values?: string[];
    notes?: Record<string, string>;
    badges?: Record<string, string>;
  }> = [];

  if (detail.type === "target") {
    sections.push(
      {
        title: "Features in this target",
        type: "feature",
        values: relationships.features,
        ...getTargetNotes(detail, "feature", relationships.features, index),
      },
      {
        title: "Variables in this target",
        type: "variable",
        values: relationships.variables,
        ...getTargetNotes(detail, "variable", relationships.variables, index),
      },
      {
        title: "Segments in this target",
        type: "segment",
        values: relationships.segments,
        ...getTargetNotes(detail, "segment", relationships.segments, index),
      },
    );
  } else if (detail.type === "schema") {
    sections.push(
      { title: "Used by features", type: "feature", values: relationships.features },
      { title: "Used by variables", type: "variable", values: relationships.variables },
    );
  } else {
    sections.push({ title: "Included in targets", type: "target", values: relationships.targets });
  }

  return sections.filter((section) => section.values?.length);
}

export function countUsage(detail: EntityDetail, dependencies: EntityDependencies) {
  return (
    (detail.usedBy?.length || 0) +
    dependencies.usedIndirectlyBy.length +
    dependencies.uses.length +
    dependencies.usesIndirectly.length +
    getRelatedSections(detail).reduce((total, section) => total + (section.values?.length || 0), 0)
  );
}

export function UsageTab() {
  const { detail, setKey } = useEntityDetail();
  const { index } = useCatalogIndex(setKey);
  const dependencies = useEntityDependencies(detail, setKey);
  const sections = getRelatedSections(detail, index);

  if (countUsage(detail, dependencies) === 0) {
    return <EmptyState title="No usage found" />;
  }

  return (
    <div className="space-y-10">
      <UsedByBlock detail={detail} dependencies={dependencies} setKey={setKey} />
      <DependsOnBlock detail={detail} dependencies={dependencies} setKey={setKey} />
      {sections.length > 0 && (
        <div className="space-y-8">
          {sections.map((section) => (
            <RelatedEntities key={section.title} {...section} setKey={setKey} />
          ))}
        </div>
      )}
    </div>
  );
}
