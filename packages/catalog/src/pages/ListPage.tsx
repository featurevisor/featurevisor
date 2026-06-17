import * as React from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

import { fetchIndex } from "../api";
import { entityLabels, entityPathToType, getEntityRoute } from "../entityTypes";
import type { CatalogIndex, EntityPath, EntitySummary } from "../types";
import {
  Badge,
  Button,
  EmptyState,
  EntityKey,
  LabelValueBadge,
  PageHeader,
} from "../components/ui";

const LIST_INITIAL_LIMIT = 1000;

function isEntityPath(value: string | undefined): value is EntityPath {
  return (
    value === "features" ||
    value === "segments" ||
    value === "attributes" ||
    value === "targets" ||
    value === "groups" ||
    value === "schemas"
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

function getFeatureSearchHints(index: CatalogIndex) {
  const features = index.entities.feature || [];
  const tags = sortValues(features.flatMap((feature) => feature.tags || []));
  const environments = sortValues(features.flatMap((feature) => feature.environments || []));
  const variationValues = sortValues(features.flatMap((feature) => feature.variationValues || []));
  const variableKeys = sortValues(features.flatMap((feature) => feature.variableKeys || []));
  const hasVariations = features.some((feature) => feature.hasVariations);
  const hasNoVariations = features.some((feature) => !feature.hasVariations);
  const hasVariables = features.some((feature) => feature.hasVariables);
  const hasNoVariables = features.some((feature) => !feature.hasVariables);

  return [
    tags[0] ? `tag:${tags[0]}` : undefined,
    environments[0] ? `in:${environments[0]}` : undefined,
    "archived:false",
    hasVariations ? "with:variations" : undefined,
    hasNoVariations ? "without:variations" : undefined,
    variationValues[0] ? `variation:${variationValues[0]}` : undefined,
    hasVariables ? "with:variables" : undefined,
    hasNoVariables ? "without:variables" : undefined,
    variableKeys[0] ? `variable:${variableKeys[0]}` : undefined,
  ].filter((hint): hint is string => Boolean(hint));
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
      Last modified by <span className="font-medium">{props.entity.lastModified.author}</span> on{" "}
      {formattedDate}
    </span>
  );
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

function HoverTooltip(props: { label: string; children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const [tooltipPosition, setTooltipPosition] = React.useState<{
    left: number;
    top: number;
  } | null>(null);

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
      aria-label={props.label}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {props.children}
      {tooltipPosition &&
        createPortal(
          <span
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-header px-2 py-1 text-xs font-semibold text-header-text shadow-lg"
            style={{
              left: tooltipPosition.left,
              top: tooltipPosition.top - 8,
            }}
          >
            {props.label}
          </span>,
          document.body,
        )}
    </span>
  );
}

function TagIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M4.25 3A1.25 1.25 0 0 0 3 4.25v4.86c0 .33.13.65.37.88l6.64 6.64a1.25 1.25 0 0 0 1.77 0l4.85-4.85a1.25 1.25 0 0 0 0-1.77L9.99 3.37A1.25 1.25 0 0 0 9.11 3H4.25Zm1.5 4a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M10 2.75a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5ZM4.25 10a5.75 5.75 0 1 1 11.5 0 5.75 5.75 0 0 1-11.5 0ZM10 6.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5ZM7.75 10a2.25 2.25 0 1 1 4.5 0 2.25 2.25 0 0 1-4.5 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function sortValues(values?: string[]) {
  return Array.from(new Set(values || [])).sort((left, right) => left.localeCompare(right));
}

function RowMetadataIcons(props: { entity: EntitySummary }) {
  const tags = sortValues(props.entity.tags);
  const targets = sortValues(props.entity.targets);

  if (tags.length === 0 && targets.length === 0) {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      {tags.length > 0 && (
        <HoverTooltip
          label={`Tags: ${tags.join(", ")}`}
          className="rounded-full bg-slate-100 p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
        >
          <TagIcon />
        </HoverTooltip>
      )}
      {targets.length > 0 && (
        <HoverTooltip
          label={`Targets: ${targets.join(", ")}`}
          className="rounded-full bg-slate-100 p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
        >
          <TargetIcon />
        </HoverTooltip>
      )}
    </div>
  );
}

function QueryHints(props: {
  query: string;
  hints: string[];
  onHintClick: (hint: string) => void;
}) {
  if (props.hints.length === 0) {
    return null;
  }

  const tokens = props.query.trim().split(/\s+/);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-2 text-xs text-muted">
      <span className="shrink-0">Try:</span>
      {props.hints.map((hint) => {
        const isActive = tokens.some((token) => token.toLowerCase() === hint.toLowerCase());

        return (
          <button
            key={hint}
            type="button"
            onClick={() => props.onHintClick(hint)}
            className={[
              "cursor-pointer rounded px-1.5 py-0.5 font-mono transition-colors",
              isActive ? "bg-primary/10 text-primary" : "bg-elevated text-muted hover:text-text",
            ].join(" ")}
          >
            {hint}
          </button>
        );
      })}
    </div>
  );
}

function SearchControls(props: {
  query: string;
  label: string;
  hints: string[];
  searchParams: URLSearchParams;
  setSearchParams: (params: URLSearchParams) => void;
}) {
  const hasHints = props.hints.length > 0;
  const showHints = hasHints && props.searchParams.get("hints") === "1";

  function setQuery(value?: string) {
    props.setSearchParams(setSearchParam(props.searchParams, "q", value || undefined));
  }

  function setShowHints(value: boolean) {
    props.setSearchParams(setSearchParam(props.searchParams, "hints", value ? "1" : undefined));
  }

  function handleHintClick(hint: string) {
    const current = props.query.trim();
    const tokens = current.split(/\s+/).filter(Boolean);
    const existingIndex = tokens.findIndex((token) => token.toLowerCase() === hint.toLowerCase());
    const next =
      existingIndex >= 0
        ? tokens.filter((_, index) => index !== existingIndex).join(" ")
        : current
          ? `${current} ${hint}`
          : hint;

    setQuery(next);
  }

  return (
    <div>
      <div className="relative">
        <input
          value={props.query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${props.label.toLowerCase()}...`}
          className={[
            "w-full rounded-full border border-border bg-surface px-5 py-2 text-xl text-text outline-none placeholder:text-faint focus:border-primary",
            hasHints ? "pr-10" : "",
          ].join(" ")}
        />
        {hasHints && (
          <button
            type="button"
            onClick={() => setShowHints(!showHints)}
            aria-label={showHints ? "Hide advanced search hints" : "Show advanced search hints"}
            aria-pressed={showHints}
            className={[
              "absolute right-3 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border text-[10px] font-black leading-none transition-all",
              showHints
                ? "scale-105 border-primary bg-primary text-header-text shadow-sm"
                : "border-border bg-surface text-faint hover:border-primary hover:bg-primary/10 hover:text-primary",
            ].join(" ")}
          >
            ?
          </button>
        )}
      </div>

      <div
        className={[
          "grid transition-all duration-200 ease-in-out",
          showHints ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        ].join(" ")}
      >
        <div className="overflow-hidden pl-5">
          <QueryHints query={props.query} hints={props.hints} onHintClick={handleHintClick} />
        </div>
      </div>
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
  const searchHints = entityPath === "features" ? getFeatureSearchHints(index) : [];

  return (
    <div className="space-y-4">
      <PageHeader title={entityLabels[type].plural} />

      <div className="px-6 pt-1">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <SearchControls
            query={query}
            label={entityLabels[type].plural}
            hints={searchHints}
            searchParams={searchParams}
            setSearchParams={setSearchParams}
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
            className="group block px-6 py-3 hover:bg-elevated"
          >
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              {type === "feature" && (
                <div className="flex h-5 w-5 shrink-0 items-center justify-center pt-1.5">
                  <EnvironmentDot
                    status={entity.environmentStatus}
                    environment={entity.environmentStatusEnvironment}
                  />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
                  <div className="min-w-0">
                    <EntityKey value={entity.key} className="text-sm font-semibold text-primary" />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {type === "segment" && (entity.usedInFeatureCount ?? 0) > 0 && (
                      <LabelValueBadge
                        compact
                        label="Used in"
                        value={`${entity.usedInFeatureCount} ${entity.usedInFeatureCount === 1 ? "feature" : "features"}`}
                      />
                    )}
                    {type === "attribute" && (entity.usedInSegmentCount ?? 0) > 0 && (
                      <LabelValueBadge
                        compact
                        label="Used in"
                        value={`${entity.usedInSegmentCount} ${entity.usedInSegmentCount === 1 ? "segment" : "segments"}`}
                      />
                    )}
                    <RowMetadataIcons entity={entity} />
                    {getStatusBadges(entity)}
                  </div>
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-4">
                  <span className="min-w-0 flex-1 truncate text-sm text-muted">
                    {entity.description || "No description"}
                  </span>
                  <span className="max-w-[48%] shrink-0 truncate text-right text-[11px] text-faint">
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
