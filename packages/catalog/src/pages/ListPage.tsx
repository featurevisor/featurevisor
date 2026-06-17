import * as React from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

import { fetchIndex } from "../api";
import { entityLabels, entityPathToType, getEntityRoute } from "../entityTypes";
import type { CatalogIndex, EntityPath, EntitySummary } from "../types";
import { Badge, Button, EmptyState, EntityKey, PageHeader } from "../components/ui";

const LIST_INITIAL_LIMIT = 1000;

function isEntityPath(value: string | undefined): value is EntityPath {
  return (
    value === "features" ||
    value === "segments" ||
    value === "attributes" ||
    value === "targets" ||
    value === "groups" ||
    value === "schemas" ||
    value === "tests"
  );
}

function getSortDirection(sortValue: string | null) {
  if (!sortValue || sortValue === "name" || sortValue === "name:asc" || sortValue === "asc") {
    return "asc";
  }

  if (sortValue === "-name" || sortValue === "name:desc" || sortValue === "desc") {
    return "desc";
  }

  return "asc";
}

function setSearchParam(searchParams: URLSearchParams, key: string, value?: string) {
  const next = new URLSearchParams(searchParams);

  if (!value) {
    next.delete(key);
  } else {
    next.set(key, value);
  }

  return next;
}

interface ParsedSearchQuery {
  terms: string[];
  qualifiers: Array<{ key: string; value: string }>;
}

const featureSearchHints = [
  "tag:web",
  "in:production",
  "archived:false",
  "with:variations",
  "without:variations",
  "variation:treatment",
  "with:variables",
  "variable:country",
];

function parseSearchQuery(query: string): ParsedSearchQuery {
  const terms: string[] = [];
  const qualifiers: Array<{ key: string; value: string }> = [];
  const matcher = /(?:(\w+):"([^"]+)")|(?:(\w+):([^\s]+))|(?:"([^"]+)")|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(query))) {
    const qualifierKey = match[1] || match[3];
    const qualifierValue = match[2] || match[4];
    const term = match[5] || match[6];

    if (qualifierKey && qualifierValue) {
      qualifiers.push({
        key: qualifierKey.toLowerCase(),
        value: qualifierValue.toLowerCase(),
      });
    } else if (term) {
      terms.push(term.toLowerCase());
    }
  }

  return { terms, qualifiers };
}

function listIncludes(values: string[] | undefined, value: string) {
  return (values || []).some((item) => item.toLowerCase().includes(value));
}

function matchesFeatureQualifier(entity: EntitySummary, key: string, value: string) {
  if (key === "tag") {
    return listIncludes(entity.tags, value);
  }

  if (key === "in") {
    return listIncludes(entity.environments, value);
  }

  if (key === "archived") {
    return String(Boolean(entity.archived)) === value;
  }

  if (key === "with") {
    if (value === "variations") return Boolean(entity.hasVariations);
    if (value === "variables") return Boolean(entity.hasVariables);
  }

  if (key === "without") {
    if (value === "variations") return !entity.hasVariations;
    if (value === "variables") return !entity.hasVariables;
  }

  if (key === "variation") {
    return listIncludes(entity.variationValues, value);
  }

  if (key === "variable") {
    return listIncludes(entity.variableKeys, value);
  }

  return true;
}

function matchesQuery(entity: EntitySummary, query: string, entityPath: EntityPath) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  if (entityPath !== "features") {
    return normalizedQuery.split(/\s+/).every((term) => {
      const haystack = [
        entity.key,
        entity.description || "",
        ...(entity.tags || []),
        ...(entity.targets || []),
        ...(entity.environments || []),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }

  const parsedQuery = parseSearchQuery(normalizedQuery);

  if (
    entityPath === "features" &&
    !parsedQuery.qualifiers.every((qualifier) =>
      matchesFeatureQualifier(entity, qualifier.key, qualifier.value),
    )
  ) {
    return false;
  }

  const haystack = [
    entity.key,
    entity.description || "",
    ...(entity.tags || []),
    ...(entity.targets || []),
    ...(entity.environments || []),
  ]
    .join(" ")
    .toLowerCase();

  return parsedQuery.terms.every((term) => haystack.includes(term));
}

function getStatusBadges(entity: EntitySummary) {
  return (
    <div className="flex flex-wrap gap-2">
      {entity.archived && <Badge tone="danger">archived</Badge>}
      {entity.deprecated && <Badge tone="warning">deprecated</Badge>}
      {entity.promotable === false && <Badge>not promotable</Badge>}
    </div>
  );
}

function LastModified(props: { entity: EntitySummary }) {
  if (!props.entity.lastModified) {
    return <span>Last modified n/a</span>;
  }

  const date = new Date(props.entity.lastModified.timestamp);
  const formattedDate = Number.isNaN(date.getTime())
    ? props.entity.lastModified.timestamp
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);

  return (
    <span>
      Last modified by <span className="font-semibold">{props.entity.lastModified.author}</span> on{" "}
      {formattedDate}
    </span>
  );
}

function getRelationshipBadges(entity: EntitySummary) {
  return entity.targets || [];
}

function EnvironmentDot(props: {
  status?: EntitySummary["environmentStatus"];
  environment?: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const [tooltipPosition, setTooltipPosition] = React.useState<{
    left: number;
    top: number;
  } | null>(null);

  if (!props.status) {
    return null;
  }

  const tooltip =
    props.status === "production"
      ? `enabled in ${props.environment || "production"}`
      : props.status === "other"
        ? "enabled in non-production environments"
        : "disabled everywhere";
  const dotClass =
    props.status === "production"
      ? "bg-green-500"
      : props.status === "other"
        ? "bg-amber-500"
        : "bg-slate-300";

  function showTooltip() {
    const rect = ref.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setTooltipPosition({
      left: rect.left + rect.width / 2,
      top: rect.top,
    });
  }

  function hideTooltip() {
    setTooltipPosition(null);
  }

  return (
    <span
      ref={ref}
      className={`relative inline-flex ${props.className || ""}`}
      aria-label={tooltip}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      <span className="relative flex h-3 w-3">
        {props.status === "production" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        )}
        <span className={`relative inline-flex h-3 w-3 rounded-full ${dotClass}`} />
      </span>
      {tooltipPosition &&
        createPortal(
          <span
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-header px-2 py-1 text-xs font-semibold text-header-text shadow-lg"
            style={{
              left: tooltipPosition.left,
              top: tooltipPosition.top - 8,
            }}
          >
            {tooltip}
          </span>,
          document.body,
        )}
    </span>
  );
}

function TargetBadges(props: { targets: string[] }) {
  if (props.targets.length === 0) {
    return null;
  }

  return (
    <div className="relative min-w-0 max-w-full overflow-hidden">
      <div className="flex min-w-0 max-w-full gap-2 overflow-hidden whitespace-nowrap pr-10">
        {props.targets.map((label) => (
          <span key={label} className="shrink-0">
            <Badge>{label}</Badge>
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-surface to-transparent" />
    </div>
  );
}

function FeatureSearchHints(props: {
  query: string;
  searchParams: URLSearchParams;
  setSearchParams: (params: URLSearchParams) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold uppercase tracking-wide text-muted">Try</span>
      {featureSearchHints.map((hint) => (
        <button
          key={hint}
          type="button"
          className="rounded-full border border-border bg-elevated px-2.5 py-1 font-mono text-muted hover:border-primary hover:text-primary"
          onClick={() => {
            const nextQuery = props.query.trim() ? `${props.query.trim()} ${hint}` : hint;
            props.setSearchParams(setSearchParam(props.searchParams, "q", nextQuery));
          }}
        >
          {hint}
        </button>
      ))}
    </div>
  );
}

export function ListPage() {
  const { entityPath, setKey } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [index, setIndex] = React.useState<CatalogIndex | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const query = searchParams.get("q") || "";
  const sortDirection = getSortDirection(searchParams.get("sort"));

  React.useEffect(() => {
    setIndex(null);
    setError(null);
    fetchIndex(setKey)
      .then(setIndex)
      .catch((err: Error) => setError(err.message));
  }, [setKey]);

  React.useEffect(() => {
    setShowAll(false);
  }, [query, sortDirection, entityPath, setKey]);

  if (!isEntityPath(entityPath)) {
    return <Navigate to="features" replace />;
  }

  const type = entityPathToType[entityPath];

  if (error) {
    return <EmptyState title="Unable to load catalog index" description={error} />;
  }

  if (!index) {
    return (
      <div className="px-6 py-8 text-muted">
        Loading {entityLabels[type].plural.toLowerCase()}...
      </div>
    );
  }

  const filtered = index.entities[type]
    .filter((entity) => matchesQuery(entity, query, entityPath))
    .slice()
    .sort((left, right) => {
      const result = left.key.localeCompare(left.key === right.key ? "" : right.key);
      return sortDirection === "desc" ? result * -1 : result;
    });
  const visible = showAll ? filtered : filtered.slice(0, LIST_INITIAL_LIMIT);
  const hasHiddenEntities = filtered.length > LIST_INITIAL_LIMIT && !showAll;

  return (
    <div className="space-y-4">
      <PageHeader title={entityLabels[type].plural} />

      <div className="px-6 pt-1">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={query}
            onChange={(event) =>
              setSearchParams(setSearchParam(searchParams, "q", event.target.value || undefined))
            }
            placeholder={`Search ${entityLabels[type].plural.toLowerCase()}...`}
            className="w-full rounded-full border border-border bg-surface px-5 py-2 text-xl text-text outline-none placeholder:text-faint focus:border-primary"
          />

          <button
            type="button"
            className="inline-flex h-[46px] w-fit max-w-full cursor-pointer items-center gap-2 self-start rounded-full border border-border bg-surface px-3 py-2 text-left text-sm font-semibold text-muted outline-none focus-visible:ring-2 focus-visible:ring-primary md:justify-self-end"
            onClick={() =>
              setSearchParams(
                setSearchParam(
                  searchParams,
                  "sort",
                  sortDirection === "desc" ? undefined : "-name",
                ),
              )
            }
          >
            <span>Sort</span>
            <span className="whitespace-nowrap font-bold text-text">
              {sortDirection === "desc" ? "Z-A" : "A-Z"}
            </span>
          </button>
        </div>
        {entityPath === "features" && (
          <FeatureSearchHints
            query={query}
            searchParams={searchParams}
            setSearchParams={setSearchParams}
          />
        )}
      </div>

      {filtered.length === 0 && <EmptyState title="No results found" />}

      <div className="divide-y divide-border bg-surface">
        {visible.map((entity) => (
          <Link
            key={entity.key}
            to={getEntityRoute(type, entity.key, setKey)}
            className="block px-6 py-3 hover:bg-elevated"
          >
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      {type === "feature" && (
                        <EnvironmentDot
                          status={entity.environmentStatus}
                          environment={entity.environmentStatusEnvironment}
                        />
                      )}
                      <EntityKey
                        value={entity.key}
                        className="text-sm font-semibold text-primary"
                      />
                    </div>
                    <div className="mt-1 truncate text-sm text-muted">
                      {entity.description || "No description"}
                    </div>
                  </div>
                  <div className="shrink-0">{getStatusBadges(entity)}</div>
                </div>
                <div className="mt-2 flex flex-col gap-2 text-xs text-muted md:flex-row md:items-center md:justify-between">
                  <TargetBadges targets={getRelationshipBadges(entity)} />
                  <span className="shrink-0 md:text-right">
                    <LastModified entity={entity} />
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="space-y-4 px-6 pb-6">
        <p className="text-center text-sm text-muted">
          {visible.length} of {filtered.length} {entityLabels[type].plural.toLowerCase()}
          {filtered.length !== index.entities[type].length
            ? ` (${index.entities[type].length} total)`
            : ""}
        </p>

        {hasHiddenEntities && (
          <div className="flex justify-center">
            <Button onClick={() => setShowAll(true)}>
              Load all {filtered.length} {entityLabels[type].plural.toLowerCase()}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
