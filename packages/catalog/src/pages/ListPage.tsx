import * as React from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

import { fetchIndex } from "../api";
import { entityLabels, entityPathToType, getEntityRoute } from "../entityTypes";
import type { CatalogEntityType, CatalogIndex, EntityPath, EntitySummary } from "../types";
import { Badge, Button, EmptyState, EntityKey, PageHeader, getEntityTone } from "../components/ui";

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

function matchesQuery(entity: EntitySummary, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
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

  return normalizedQuery.split(/\s+/).every((term) => haystack.includes(term));
}

function getStatusBadges(entity: EntitySummary, type: CatalogEntityType) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge tone={getEntityTone(type)}>{entityLabels[type].singular}</Badge>
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
  return [...(entity.targets || []), ...(entity.tags || []), ...(entity.environments || [])];
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
    .filter((entity) => matchesQuery(entity, query))
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
                    <EntityKey value={entity.key} className="text-sm font-semibold text-primary" />
                    <div className="mt-1 truncate text-sm text-muted">
                      {entity.description || "No description"}
                    </div>
                  </div>
                  <div className="shrink-0">{getStatusBadges(entity, type)}</div>
                </div>
                <div className="mt-2 flex flex-col gap-2 text-xs text-muted md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-wrap gap-2">
                    {getRelationshipBadges(entity).map((label) => (
                      <Badge key={label}>{label}</Badge>
                    ))}
                  </div>
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
