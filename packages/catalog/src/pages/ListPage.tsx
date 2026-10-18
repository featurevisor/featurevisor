import * as React from "react";
import { prefetchEntityDetail } from "../api";
import { createPortal } from "react-dom";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";

import { useCatalog } from "../context/CatalogContext";
import { TestReportSummary } from "../components/testReport";
import { decodeRouteSegment, entityLabels, entityPathToType, getEntityRoute } from "../entityTypes";
import type { CatalogEntityType, CatalogIndex, EntityPath, EntitySummary } from "../types";
import {
  AuthorAvatar,
  Badge,
  Button,
  EmptyState,
  EntityKey,
  LabelValueBadge,
  PageHeader,
  PageSkeleton,
} from "../components/ui";
import { useCatalogIndex } from "../useCatalogIndex";
import { getDependencyNodes, getDependentNodes } from "../dependencyIndex";
import { useDocumentTitle } from "../useDocumentTitle";
import { rememberListSearch } from "../listMemory";
import { formatDateTime, formatFullTimestamp } from "../dates";
import { DECODED_JSON_DESCRIPTION, formatVariableType } from "../components/valueFormat";

const LIST_INITIAL_LIMIT = 1000;
// Rows off screen skip layout and paint until scrolled near, which keeps long lists cheap.
const LIST_ROW_CLASS =
  "group block px-6 py-3 hover:bg-elevated [content-visibility:auto] [contain-intrinsic-size:auto_73px]";

function isEntityPath(value: string | undefined): value is EntityPath {
  return (
    value === "features" ||
    value === "segments" ||
    value === "attributes" ||
    value === "targets" ||
    value === "schemas" ||
    value === "variables" ||
    value === "tests"
  );
}

type SortOrder = "name" | "-name" | "modified";

const SORT_LABELS: Record<SortOrder, string> = {
  name: "Name A-Z",
  "-name": "Name Z-A",
  modified: "Recently modified",
};

function getSortOrder(sortValue: string | null): SortOrder {
  if (sortValue === "-name" || sortValue === "name:desc" || sortValue === "desc") return "-name";
  if (sortValue === "modified" || sortValue === "-modified") return "modified";

  return "name";
}

function getModifiedTime(entity: EntitySummary) {
  const time = entity.lastModified ? Date.parse(entity.lastModified.timestamp) : NaN;

  return Number.isNaN(time) ? 0 : time;
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

export function parseSearchQuery(query: string): ParsedSearchQuery {
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

interface FilterChip {
  label: string;
  token: string;
  /** Chips sharing a group sit together under its label. */
  group: string;
}

function sortValuesOf(values: Array<string | undefined>) {
  return sortValues(values.filter((value): value is string => Boolean(value)));
}

/** Filters shown as chips, each backed by a search qualifier token. */
export function getFilterChips(index: CatalogIndex, entityPath: EntityPath): FilterChip[] {
  const type = entityPathToType[entityPath];
  const entities = index.entities[type] || [];
  const chips: FilterChip[] = [];

  if (entityPath === "features") {
    sortValuesOf(entities.flatMap((entity) => entity.environments || [])).forEach((environment) =>
      chips.push({ label: environment, token: `in:${environment}`, group: "Environment" }),
    );
    if (entities.some((entity) => entity.hasVariations))
      chips.push({ label: "With variations", token: "with:variations", group: "Contains" });
    if (entities.some((entity) => entity.hasVariables))
      chips.push({ label: "With variables", token: "with:variables", group: "Contains" });
    if (entities.some((entity) => entity.environmentsDiffer))
      chips.push({ label: "Differs across environments", token: "with:drift", group: "Status" });
  }

  if (entityPath === "variables") {
    sortValuesOf(entities.map((entity) => entity.variableType)).forEach((variableType) =>
      chips.push({ label: variableType, token: `type:${variableType}`, group: "Type" }),
    );
    if (entities.some((entity) => entity.isComposed))
      chips.push({ label: "Composed", token: "with:composition", group: "Type" });
  }

  if (entityPath === "attributes") {
    sortValuesOf(entities.map((entity) => entity.attributeType)).forEach((attributeType) =>
      chips.push({ label: attributeType, token: `type:${attributeType}`, group: "Type" }),
    );
    sortValuesOf(entities.map((entity) => entity.attributeFormat)).forEach((attributeFormat) =>
      chips.push({ label: attributeFormat, token: `format:${attributeFormat}`, group: "Format" }),
    );
  }

  if (entityPath === "tests") {
    const labels: Record<string, string> = {
      feature: "Features",
      segment: "Segments",
      variable: "Variables",
      scenario: "Scenarios",
    };
    sortValuesOf(entities.map((entity) => entity.testKind)).forEach((kind) =>
      chips.push({ label: labels[kind] || kind, token: `kind:${kind}`, group: "Kind" }),
    );
    if (entities.some((entity) => entity.testPassed === false))
      chips.push({ label: "Failed", token: "status:failed", group: "Result" });
    if (entities.some((entity) => entity.testPassed === true))
      chips.push({ label: "Passed", token: "status:passed", group: "Result" });
  }

  if (entities.some((entity) => entity.hasTests === false))
    chips.push({ label: "Without tests", token: "without:tests", group: "Status" });
  // Segments, attributes and schemas export a usage count, so both chips always apply. An
  // empty Unused list is itself the answer. Other types never get these chips.
  if (entities.some((entity) => typeof entity.usedByCount === "number")) {
    chips.push({ label: "Used", token: "with:usage", group: "Usage" });
    chips.push({ label: "Unused", token: "without:usage", group: "Usage" });
  }
  if (
    (entityPath === "features" || entityPath === "variables") &&
    entities.some((entity) => hasDependents(entity))
  )
    chips.push({ label: "Required by others", token: "with:dependents", group: "Dependencies" });
  if (entities.some((entity) => entity.dependsOnDeprecated))
    chips.push({
      label: "Depends on deprecated",
      token: "with:deprecated-dependency",
      group: "Dependencies",
    });
  if (entities.some((entity) => entity.deprecated))
    chips.push({ label: "Deprecated", token: "deprecated:true", group: "Status" });
  if (entities.some((entity) => entity.archived))
    chips.push({ label: "Archived", token: "archived:true", group: "Status" });

  if (entityPath === "features") {
    sortValuesOf(entities.flatMap((entity) => entity.tags || [])).forEach((tag) =>
      chips.push({ label: `#${tag}`, token: `tag:${tag}`, group: "Tags" }),
    );
  }

  return chips;
}

function listIncludes(values: string[] | undefined, value: string) {
  return (values || []).some((item) => item.toLowerCase().includes(value));
}

function hasDependents(entity: EntitySummary) {
  return (entity.usedInFeatureCount ?? 0) + (entity.usedInVariableCount ?? 0) > 0;
}

/** Qualifiers the list understands. Any other one is ignored, and the list says so. */
const KNOWN_QUALIFIERS = new Set([
  "tag",
  "in",
  "archived",
  "deprecated",
  "type",
  "format",
  "kind",
  "status",
  "variation",
  "variable",
  "with",
  "without",
  "uses",
  "usedby",
]);

export function getUnknownQualifiers(query: string) {
  const unknown = new Map<string, string>();
  for (const qualifier of parseSearchQuery(query.trim().toLowerCase()).qualifiers) {
    if (!KNOWN_QUALIFIERS.has(qualifier.key) && !unknown.has(qualifier.key)) {
      unknown.set(qualifier.key, qualifier.value);
    }
  }
  return [...unknown].map(([key, value]) => ({ key, value }));
}

/**
 * The `uses:` filter an unknown one most likely meant. "segment:regions.eu" names an entity, so
 * it becomes "uses:regions.eu". Otherwise a used segment serves as an example.
 */
export function getUsesSuggestion(
  index: CatalogIndex,
  unknown: Array<{ key: string; value: string }>,
) {
  for (const { value } of unknown) {
    for (const rows of Object.values(index.entities)) {
      const match = rows.find((row) => row.key.toLowerCase() === value);
      if (match) return { key: match.key, named: true };
    }
  }
  const segment = (index.entities.segment || []).find((entity) => entity.usedByCount);
  return segment ? { key: segment.key, named: false } : undefined;
}

function UnknownFilterNotice(props: {
  query: string;
  unknown: Array<{ key: string; value: string }>;
  index: CatalogIndex;
}) {
  const location = useLocation();
  const suggestion = getUsesSuggestion(props.index, props.unknown);
  const names = props.unknown.map(({ key }) => `${key}:`).join(", ");
  const one = props.unknown.length === 1;
  const suggestedQuery = suggestion?.named
    ? props.query.replace(
        new RegExp(`(^|\\s)${props.unknown[0].key}:\\S+`, "i"),
        `$1uses:${suggestion.key}`,
      )
    : undefined;
  const params = new URLSearchParams(location.search);
  if (suggestedQuery) params.set("q", suggestedQuery);

  return (
    <div
      role="status"
      className="mx-6 mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"
    >
      <p className="font-semibold">
        {names} {one ? "is not a filter" : "are not filters"}, so the list ignores{" "}
        {one ? "it" : "them"}
      </p>
      <p className="mt-0.5 text-amber-900/90">
        {suggestion && (
          <>
            {suggestedQuery ? (
              <Link
                to={{ search: `?${params.toString()}` }}
                replace
                className="font-mono font-medium underline underline-offset-2"
              >
                uses:{suggestion.key}
              </Link>
            ) : (
              <code className="font-mono">uses:{suggestion.key}</code>
            )}{" "}
            lists what depends on {suggestion.key}, directly or not.{" "}
          </>
        )}
        <code className="font-mono">usedby:</code> lists what an entity depends on. Other filters
        are tag, in, type, kind, status, variation, variable, with, without, deprecated and
        archived.
      </p>
    </div>
  );
}

/** "regions.eu" names an entity of any type, and "segment:regions.eu" one exact entity. */
function matchesReference(node: string, value: string) {
  const lower = node.toLowerCase();
  return lower === value || lower.slice(lower.indexOf(":") + 1) === value;
}

/** Context a query needs beyond one summary, such as what another entity depends on. */
interface QueryContext {
  index?: CatalogIndex;
  type?: CatalogEntityType;
}

function matchesQualifier(
  entity: EntitySummary,
  key: string,
  value: string,
  related?: Map<string, Set<string>>,
  context: QueryContext = {},
) {
  if (!KNOWN_QUALIFIERS.has(key)) return true;
  if (key === "uses" || key === "usedby") {
    const id = context.type ? `${context.type}:${entity.key}`.toLowerCase() : undefined;
    return Boolean(id && related?.get(`${key}:${value}`)?.has(id));
  }
  if (key === "tag") return listIncludes(entity.tags, value);
  if (key === "in") return listIncludes(entity.environments, value);
  if (key === "archived") return String(Boolean(entity.archived)) === value;
  if (key === "deprecated") return String(Boolean(entity.deprecated)) === value;
  if (key === "type")
    return (entity.variableType || entity.attributeType || "").toLowerCase() === value;
  if (key === "format") return (entity.attributeFormat || "").toLowerCase() === value;
  if (key === "kind") return (entity.testKind || "").toLowerCase() === value;
  if (key === "status") {
    if (value === "failed") return entity.testPassed === false;
    if (value === "passed") return entity.testPassed === true;
  }
  if (key === "variation") return listIncludes(entity.variationValues, value);
  if (key === "variable") return listIncludes(entity.variableKeys, value);

  if (key === "with") {
    if (value === "composition") return Boolean(entity.isComposed);
    if (value === "variations") return Boolean(entity.hasVariations);
    if (value === "variables") return Boolean(entity.hasVariables);
    if (value === "tests") return Boolean(entity.hasTests);
    if (value === "drift") return Boolean(entity.environmentsDiffer);
    if (value === "usage") return (entity.usedByCount ?? 0) > 0;
    if (value === "dependents") return hasDependents(entity);
    if (value === "dependencies") return Boolean(entity.references?.length);
    if (value === "deprecated-dependency") return Boolean(entity.dependsOnDeprecated);
  }

  if (key === "without") {
    if (value === "composition") return !entity.isComposed;
    if (value === "variations") return !entity.hasVariations;
    if (value === "variables") return !entity.hasVariables;
    if (value === "tests") return entity.hasTests === false;
    // Only types that export a usage count can be unused. Unknown counts never match.
    if (value === "usage") return entity.usedByCount === 0;
    if (value === "dependents") return !hasDependents(entity);
    if (value === "dependencies") return !entity.references?.length;
    if (value === "deprecated-dependency") return !entity.dependsOnDeprecated;
  }

  return true;
}

// Index summaries are immutable once loaded, so each one's search text is built once.
const haystacks = new WeakMap<EntitySummary, string>();

function getHaystack(entity: EntitySummary) {
  let haystack = haystacks.get(entity);
  if (haystack === undefined) {
    haystack = [
      entity.key,
      entity.description || "",
      entity.testSubject || "",
      ...(entity.tags || []),
      ...(entity.targets || []),
      ...(entity.environments || []),
    ]
      .join(" ")
      .toLowerCase();
    haystacks.set(entity, haystack);
  }
  return haystack;
}

/**
 * For each `uses:` value, everything depending on the named entities, and for each `usedby:`
 * value, everything they depend on, directly or not, as lowercase "type:key". The graph comes
 * from the index once, and each value is searched once per query.
 */
function getRelatedLookup(qualifiers: Array<{ key: string; value: string }>, index?: CatalogIndex) {
  const values = qualifiers.filter(
    (qualifier) => qualifier.key === "uses" || qualifier.key === "usedby",
  );
  if (!values.length || !index) return undefined;
  const lookup = new Map<string, Set<string>>();
  for (const { key, value } of values) {
    const related = new Set<string>();
    for (const [type, rows] of Object.entries(index.entities)) {
      for (const row of rows) {
        if (!matchesReference(`${type}:${row.key}`, value)) continue;
        const reference = { type: type as CatalogEntityType, key: row.key };
        const nodes =
          key === "uses"
            ? getDependentNodes(index, reference)
            : getDependencyNodes(index, reference);
        for (const node of nodes) related.add(node.toLowerCase());
      }
    }
    lookup.set(`${key}:${value}`, related);
  }
  return lookup;
}

/** Parse a list query once and return a matcher for every entity. */
export function createQueryMatcher(
  query: string,
  context: QueryContext = {},
): (entity: EntitySummary) => boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return () => true;

  const parsedQuery = parseSearchQuery(normalizedQuery);
  const related = getRelatedLookup(parsedQuery.qualifiers, context.index);
  return (entity) =>
    parsedQuery.qualifiers.every((qualifier) =>
      matchesQualifier(entity, qualifier.key, qualifier.value, related, context),
    ) && parsedQuery.terms.every((term) => getHaystack(entity).includes(term));
}

export function matchesQuery(entity: EntitySummary, query: string, context?: QueryContext) {
  return createQueryMatcher(query, context)(entity);
}

const keyCollator = new Intl.Collator();

/** Filter and sort one list. Callers memoize it, since lists can hold thousands of entities. */
export function getListEntities(
  entities: EntitySummary[],
  query: string,
  sortOrder: SortOrder,
  context?: QueryContext,
): EntitySummary[] {
  const matches = createQueryMatcher(query, context);
  const filtered = entities.filter(matches);
  if (sortOrder === "modified") {
    const times = new Map(filtered.map((entity) => [entity, getModifiedTime(entity)]));
    return filtered.sort(
      (left, right) =>
        times.get(right)! - times.get(left)! || keyCollator.compare(left.key, right.key),
    );
  }
  const direction = sortOrder === "-name" ? -1 : 1;
  return filtered.sort((left, right) => direction * keyCollator.compare(left.key, right.key));
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

/** "2 features · 1 variable", counting everything that depends on an entity, directly or not. */
export function formatDependentCounts(entity: EntitySummary) {
  const count = (value: number | undefined, noun: string) =>
    value ? `${value} ${noun}${value === 1 ? "" : "s"}` : undefined;
  return [
    count(entity.usedInFeatureCount, "feature"),
    count(entity.usedInVariableCount, "variable"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function RowTrailingMeta(props: { entity: EntitySummary; type: CatalogEntityType }) {
  const dependents = formatDependentCounts(props.entity);
  const label =
    props.type === "segment" || props.type === "attribute"
      ? "Used by"
      : props.type === "feature" || props.type === "variable"
        ? "Required by"
        : undefined;

  return (
    <>
      {getStatusBadges(props.entity)}
      {/* Phones keep the key readable. The filters still find these there. */}
      {props.entity.dependsOnDeprecated && (
        <span className="hidden sm:inline-flex">
          <Badge tone="warning" title="Depends on a deprecated feature, directly or not">
            deprecated dependency
          </Badge>
        </span>
      )}
      {dependents && label && (
        <span className="hidden sm:inline-flex">
          <LabelValueBadge compact label={label} value={dependents} />
        </span>
      )}
    </>
  );
}

/** Row details that are useful but too noisy to show on every row, as hover text. */
function getRowHint(entity: EntitySummary) {
  const targets = sortValues(entity.targets);

  return (
    [
      entity.hasVariations && "Has variations",
      entity.hasVariables && "Has variables",
      targets.length > 0 && `Targets: ${targets.join(", ")}`,
    ]
      .filter(Boolean)
      .join(" · ") || undefined
  );
}

/** Rows are memoized: while typing, most visible entities stay the same between renders. */
const ListRow = React.memo(function ListRow(props: {
  entity: EntitySummary;
  type: CatalogEntityType;
  setKey?: string;
}) {
  const { entity, type, setKey } = props;
  const hint = getRowHint(entity);
  const description = entity.description || "No description";
  const trailingMeta = <RowTrailingMeta entity={entity} type={type} />;
  const lastModified = (
    <span className="hidden text-right text-[11px] text-muted whitespace-nowrap sm:inline-flex">
      <LastModified entity={entity} />
    </span>
  );

  if (type === "test") {
    return <TestListRow entity={entity} setKey={setKey} lastModified={lastModified} />;
  }

  if (type === "feature") {
    return (
      <Link
        to={getEntityRoute(type, entity.key, setKey)}
        onMouseEnter={() => prefetchEntityDetail(type, entity.key, setKey)}
        onFocus={() => prefetchEntityDetail(type, entity.key, setKey)}
        title={hint}
        className={LIST_ROW_CLASS}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-x-3 gap-y-1">
          <div className="col-start-1 row-start-1 flex h-6 shrink-0 items-center justify-center">
            <EnvironmentDot
              status={entity.environmentStatus}
              environment={entity.environmentStatusEnvironment}
            />
          </div>
          <div className="col-start-2 row-start-1 flex min-h-6 min-w-0 items-center">
            <EntityKey value={entity.key} className="text-sm font-semibold text-primary" />
          </div>
          <div className="col-start-3 row-start-1 flex min-h-6 w-full items-center justify-end gap-2">
            {trailingMeta}
          </div>
          <div className="col-start-2 row-start-2 flex min-h-5 min-w-0 items-center overflow-hidden">
            <span className="min-w-0 truncate text-sm text-muted">{description}</span>
          </div>
          <div className="col-start-3 row-start-2 flex min-h-5 w-full items-center justify-end">
            {lastModified}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={getEntityRoute(type, entity.key, setKey)}
      onMouseEnter={() => prefetchEntityDetail(type, entity.key, setKey)}
      onFocus={() => prefetchEntityDetail(type, entity.key, setKey)}
      title={hint}
      className={LIST_ROW_CLASS}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-x-3 gap-y-1">
        <div className="col-start-1 row-start-1 flex min-h-6 min-w-0 items-center gap-2">
          <EntityKey value={entity.key} className="text-sm font-semibold text-primary" />
          {((type === "variable" && entity.variableType) ||
            (type === "attribute" && entity.attributeType)) && (
            <code
              className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] leading-none text-slate-600"
              title={
                type === "variable" && entity.variableType === "json" && entity.isComposed
                  ? DECODED_JSON_DESCRIPTION
                  : undefined
              }
            >
              {type === "variable"
                ? formatVariableType(entity.variableType, entity.isComposed)
                : entity.attributeFormat
                  ? `${entity.attributeType} · ${entity.attributeFormat}`
                  : entity.attributeType}
            </code>
          )}
          {type === "variable" && entity.isComposed && <Badge>composed</Badge>}
        </div>
        <div className="col-start-2 row-start-1 flex min-h-6 w-full items-center justify-end gap-2">
          {trailingMeta}
        </div>
        <div className="col-start-1 row-start-2 flex min-h-5 min-w-0 items-center overflow-hidden">
          <span className="min-w-0 truncate text-sm text-muted">{description}</span>
        </div>
        <div className="col-start-2 row-start-2 flex min-h-5 w-full items-center justify-end">
          {lastModified}
        </div>
      </div>
    </Link>
  );
});

const TEST_KIND_LABELS: Record<string, string> = {
  feature: "Feature",
  segment: "Segment",
  variable: "Variable",
  scenario: "Scenario",
};

function TestListRow(props: {
  entity: EntitySummary;
  setKey?: string;
  lastModified: React.ReactNode;
}) {
  const { entity } = props;
  const kind = entity.testKind;
  const count = entity.assertionCount ?? 0;
  const unit = kind === "scenario" ? "check" : "assertion";
  // The key usually names its subject already, as in features.checkout for checkout.
  const subjectIsInKey = Boolean(
    entity.testSubject &&
    (entity.key === entity.testSubject || entity.key.endsWith(`.${entity.testSubject}`)),
  );
  const summary =
    entity.description ||
    (kind === "scenario"
      ? "Standalone scenario"
      : subjectIsInKey
        ? undefined
        : `Tests ${TEST_KIND_LABELS[kind || ""]?.toLowerCase() || "entity"} ${entity.testSubject || ""}`);
  // A whole spec result reads as one badge, such as "✓ 13 cases passed". Any caveats follow.
  const [outcome, ...caveats] = (entity.testReportStatus || "").split(". ");
  const details = entity.testPassed === undefined ? entity.testReportStatus : caveats.join(". ");

  return (
    <Link
      to={getEntityRoute("test", entity.key, props.setKey)}
      onMouseEnter={() => prefetchEntityDetail("test", entity.key, props.setKey)}
      onFocus={() => prefetchEntityDetail("test", entity.key, props.setKey)}
      className={LIST_ROW_CLASS}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-x-3 gap-y-1">
        <div className="col-start-1 row-start-1 flex min-h-6 min-w-0 items-center gap-2">
          <EntityKey value={entity.key} className="text-sm font-semibold text-primary" />
          {kind && (
            <Badge tone={kind === "scenario" ? "accent" : "neutral"}>
              {TEST_KIND_LABELS[kind]}
            </Badge>
          )}
          {entity.testPassed !== undefined && (
            <Badge tone={entity.testPassed ? "success" : "danger"}>
              {entity.testPassed ? "✓" : "✗"} {outcome || (entity.testPassed ? "Passed" : "Failed")}
            </Badge>
          )}
        </div>
        <div className="col-start-2 row-start-1 flex min-h-6 items-center justify-end">
          <LabelValueBadge compact label={count === 1 ? unit : `${unit}s`} value={String(count)} />
        </div>
        <div className="col-start-1 row-start-2 flex min-h-5 min-w-0 items-center overflow-hidden">
          {summary && <span className="min-w-0 truncate text-sm text-muted">{summary}</span>}
        </div>
        <div className="col-start-2 row-start-2 flex min-h-5 items-center justify-end">
          {props.lastModified}
        </div>
        {details && <p className="col-span-2 row-start-3 text-xs text-muted">{details}</p>}
      </div>
    </Link>
  );
}

/** The date alone keeps rows light; the author is in the hover text. */
/** Who last changed the entity (as an avatar, named on hover) and when, to the minute. */
function LastModified(props: { entity: EntitySummary }) {
  const lastModified = props.entity.lastModified;

  if (!lastModified) return null;

  const formatted = formatDateTime(lastModified.timestamp);

  return (
    // The avatar sits last, on the row's right edge, so avatars line up in one column
    // however long each timestamp is.
    <span className="inline-flex items-center gap-2">
      <time
        dateTime={lastModified.timestamp}
        title={`Last modified ${formatFullTimestamp(lastModified.timestamp)} by ${lastModified.author}`}
        className="tabular-nums"
      >
        {formatted}
      </time>
      <AuthorAvatar name={lastModified.author} size="sm" />
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

  const live = props.status === "production" || props.status === "enabled";
  const tooltip =
    props.status === "enabled"
      ? "Enabled"
      : props.status === "production"
        ? `Enabled in ${props.environment || "production"}`
        : props.status === "other"
          ? "Enabled in non-production environments"
          : props.environment
            ? "Disabled everywhere"
            : "Disabled";
  const dotClass = live
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
        {live && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75 motion-reduce:hidden" />
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

function sortValues(values?: string[]) {
  return Array.from(new Set(values || [])).sort((left, right) => left.localeCompare(right));
}

function toggleToken(query: string, token: string) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const existingIndex = tokens.findIndex((item) => item.toLowerCase() === token.toLowerCase());

  return existingIndex >= 0
    ? tokens.filter((_, index) => index !== existingIndex).join(" ")
    : [...tokens, token].join(" ");
}

/** What counts as using each type that exports a usage count. */
const USAGE_OWNERS: Partial<Record<CatalogEntityType, string>> = {
  segment: "a feature or variable, directly or through other segments",
  attribute: "a feature or variable, directly or through segments",
  schema: "a feature or variable",
};

function FilterChips(props: {
  query: string;
  chips: FilterChip[];
  /** One row without group labels, for lists whose chips read well side by side. */
  flat?: boolean;
  className?: string;
  onChange: (query: string) => void;
}) {
  if (props.chips.length === 0) {
    return null;
  }

  const tokens = props.query.trim().toLowerCase().split(/\s+/);
  const groups = new Map<string, FilterChip[]>();
  for (const chip of props.chips) {
    const name = props.flat ? "Filters" : chip.group;
    const group = groups.get(name);
    if (group) group.push(chip);
    else groups.set(name, [chip]);
  }
  const labelled = groups.size > 1;

  const renderChip = (chip: FilterChip) => {
    const active = tokens.includes(chip.token.toLowerCase());

    return (
      <button
        key={chip.token}
        type="button"
        aria-pressed={active}
        onClick={() => props.onChange(toggleToken(props.query, chip.token))}
        className={[
          "cursor-pointer rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
          active
            ? "border-header-active bg-header-active text-header-text"
            : "border-slate-300 bg-surface text-slate-700 hover:border-slate-400 hover:bg-slate-50",
        ].join(" ")}
      >
        {chip.label}
      </button>
    );
  };
  // Flat chips are direct children, so they wrap across the whole row.
  if (props.flat) {
    return (
      <div
        role="group"
        aria-label="Filters"
        className={`flex flex-wrap items-center gap-1.5 ${props.className || ""}`}
      >
        {props.chips.map(renderChip)}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${props.className || ""}`}>
      {[...groups].map(([group, chips]) => (
        <div
          key={group}
          role="group"
          aria-label={group}
          className="flex flex-wrap items-center gap-1.5"
        >
          {labelled && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
              {group}
            </span>
          )}
          {chips.map(renderChip)}
        </div>
      ))}
    </div>
  );
}

function SearchControls(props: {
  query: string;
  label: string;
  chips: FilterChip[];
  flatChips?: boolean;
  /** Beside the search box on wide screens, below it on phones. */
  sort: React.ReactNode;
  searchParams: URLSearchParams;
  setSearchParams: (params: URLSearchParams, options?: { replace?: boolean }) => void;
}) {
  // Typing replaces the history entry, so Back leaves the list instead of undoing keystrokes.
  function setQuery(value?: string, replace = false) {
    props.setSearchParams(setSearchParam(props.searchParams, "q", value || undefined), {
      replace,
    });
  }

  // Chips span both columns, so they use the width under Sort too.
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
      <input
        value={props.query}
        onChange={(event) => setQuery(event.target.value, true)}
        placeholder={`Search ${props.label.toLowerCase()}...`}
        className="w-full rounded-full border border-border bg-surface px-5 py-2 text-xl text-text outline-none placeholder:text-faint focus:border-primary"
      />
      {props.sort}
      <FilterChips
        query={props.query}
        chips={props.chips}
        flat={props.flatChips}
        className="md:col-span-2"
        onChange={setQuery}
      />
    </div>
  );
}

export function ListPage() {
  const { manifest } = useCatalog();
  const { entityPath, setKey } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { index, error } = useCatalogIndex(setKey);
  const [loadAll, setLoadAll] = React.useState(false);
  // "Load all" adds rows a chunk per frame, so thousands of rows never block one task.
  const [rendered, setRendered] = React.useState(LIST_INITIAL_LIMIT);
  const query = searchParams.get("q") || "";
  // The input follows every keystroke while the list catches up at a lower priority.
  const listQuery = React.useDeferredValue(query);
  const sortOrder = getSortOrder(searchParams.get("sort"));
  const listType = isEntityPath(entityPath) ? entityPathToType[entityPath] : undefined;
  const filtered = React.useMemo(
    () =>
      index && listType
        ? getListEntities(index.entities[listType] || [], listQuery, sortOrder, {
            index,
            type: listType,
          })
        : [],
    [index, listType, listQuery, sortOrder],
  );
  const filterChips = React.useMemo(
    () => (index && isEntityPath(entityPath) ? getFilterChips(index, entityPath) : []),
    [index, entityPath],
  );
  const unknownQualifiers = React.useMemo(() => getUnknownQualifiers(listQuery), [listQuery]);
  const location = useLocation();

  React.useEffect(() => {
    if (!loadAll || rendered >= filtered.length) return;
    const frame = window.requestAnimationFrame(() =>
      React.startTransition(() => setRendered((count) => count + LIST_INITIAL_LIMIT)),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [loadAll, rendered, filtered.length]);

  React.useEffect(() => {
    if (isEntityPath(entityPath)) {
      rememberListSearch(setKey && decodeRouteSegment(setKey), entityPath, location.search);
    }
  }, [entityPath, setKey, location.search]);
  useDocumentTitle(
    isEntityPath(entityPath) && entityLabels[entityPathToType[entityPath]].plural,
    setKey && decodeRouteSegment(setKey),
  );

  React.useEffect(() => {
    setLoadAll(false);
    setRendered(LIST_INITIAL_LIMIT);
  }, [query, sortOrder, entityPath, setKey]);

  if (!isEntityPath(entityPath)) {
    return <Navigate to="features" replace />;
  }

  const type = entityPathToType[entityPath];

  if (error) {
    return <EmptyState title="Unable to load catalog index" description={error} />;
  }

  if (!index) {
    return (
      <PageSkeleton label={`Loading ${entityLabels[type].plural.toLowerCase()}`} variant="list" />
    );
  }

  const visible = filtered.slice(0, loadAll ? rendered : LIST_INITIAL_LIMIT);
  const hasHiddenEntities = filtered.length > LIST_INITIAL_LIMIT && !loadAll;
  const hasTimestamps = visible.some((entity) => entity.lastModified);

  return (
    <div className="space-y-4">
      <PageHeader title={entityLabels[type].plural} />

      {type === "test" && manifest.testReport && (
        <div className="px-6">
          <TestReportSummary report={manifest.testReport} />
        </div>
      )}

      <div className="px-6 pt-1">
        <SearchControls
          query={query}
          label={entityLabels[type].plural}
          chips={filterChips}
          // Features and variables have small groups, which read better as one row of pills.
          flatChips={entityPath === "features" || entityPath === "variables"}
          sort={
            <label className="relative inline-flex h-[46px] w-fit max-w-full cursor-pointer items-center gap-2 rounded-full border border-border bg-surface pl-3 pr-8 text-sm font-semibold text-muted focus-within:ring-2 focus-within:ring-primary">
              <span>Sort</span>
              <select
                value={sortOrder}
                onChange={(event) =>
                  setSearchParams(
                    setSearchParam(
                      searchParams,
                      "sort",
                      event.target.value === "name" ? undefined : event.target.value,
                    ),
                    { replace: true },
                  )
                }
                aria-label="Sort order"
                className="cursor-pointer appearance-none bg-transparent font-bold text-text outline-none [&>option]:bg-surface [&>option]:text-text"
              >
                {(Object.keys(SORT_LABELS) as SortOrder[]).map((order) => (
                  <option key={order} value={order}>
                    {SORT_LABELS[order]}
                  </option>
                ))}
              </select>
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                className="pointer-events-none absolute right-3 h-4 w-4 text-muted"
              >
                <path
                  d="M6 8l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </label>
          }
          searchParams={searchParams}
          setSearchParams={setSearchParams}
        />
      </div>

      {unknownQualifiers.length > 0 && (
        <UnknownFilterNotice query={query} unknown={unknownQualifiers} index={index} />
      )}

      {filtered.length === 0 &&
        (query.trim().toLowerCase() === "without:usage" && USAGE_OWNERS[type] ? (
          <EmptyState
            title={`No unused ${entityLabels[type].plural.toLowerCase()}`}
            description={`Every one is used by ${USAGE_OWNERS[type]}.`}
          />
        ) : (
          <EmptyState title="No results found" />
        ))}

      <div className="divide-y divide-border bg-surface">
        {/* The list carries the timestamp column's heading as its first row, apart from the
            filter pills, whose wrapping would otherwise crowd it. Phones hide timestamps. */}
        {hasTimestamps && (
          <div className="hidden justify-end px-6 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint sm:flex">
            Last modified
          </div>
        )}
        {visible.map((entity) => (
          <ListRow key={entity.key} entity={entity} type={type} setKey={setKey} />
        ))}
      </div>

      <div className="space-y-4 px-6 pb-6">
        <p className="text-center text-sm text-muted">
          {visible.length} of {index.entities[type].length}{" "}
          {entityLabels[type].plural.toLowerCase()}
          {filtered.length !== index.entities[type].length && visible.length < filtered.length
            ? ` (${filtered.length} matches)`
            : ""}
        </p>

        {hasHiddenEntities && (
          <div className="flex justify-center">
            <Button onClick={() => setLoadAll(true)}>
              Load all {filtered.length} {entityLabels[type].plural.toLowerCase()}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
