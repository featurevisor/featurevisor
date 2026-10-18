import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { fetchHistoryPage } from "../api";
import { encodeRouteSegment, entityLabels, getEntityRoute } from "../entityTypes";
import {
  Button,
  EmptyState,
  EntityKey,
  AuthorAvatar,
  PageHeader,
  PageSkeleton,
} from "../components/ui";
import { useCatalog } from "../context/CatalogContext";
import type { CatalogEntityType, HistoryEntity, HistoryEntry } from "../types";
import { useDocumentTitle } from "../useDocumentTitle";
import { formatDate, formatFullTimestamp, formatTime, toDate } from "../dates";

/** Entries touching this many definitions or fewer list them inline; larger ones start collapsed. */
const HISTORY_INLINE_ENTITY_LIMIT = 3;

const HISTORY_TYPE_ORDER = [
  "feature",
  "variable",
  "segment",
  "attribute",
  "target",
  "schema",
  "test",
  "scenario",
];

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

interface DayLabel {
  /** Short month for the calendar tile, such as "Sep". */
  month: string;
  day: string;
  /** "Today", "Yesterday" or the weekday. */
  label: string;
  year?: number;
  /** The full date for assistive technology and tooltips. */
  full: string;
}

const dayFormatters = {
  weekday: new Intl.DateTimeFormat(undefined, { weekday: "long" }),
  month: new Intl.DateTimeFormat(undefined, { month: "short" }),
  full: new Intl.DateTimeFormat(undefined, { dateStyle: "full" }),
};

function formatDay(value: string): DayLabel {
  const date = toDate(value);

  if (!date) return { month: "", day: "", label: value, full: value, year: undefined };

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  weekAgo.setHours(0, 0, 0, 0);
  // A bare weekday only makes sense within the last week. Older days use the shared date format.
  const label = isSameDay(date, today)
    ? "Today"
    : isSameDay(date, yesterday)
      ? "Yesterday"
      : date >= weekAgo
        ? dayFormatters.weekday.format(date)
        : formatDate(value);

  return {
    month: dayFormatters.month.format(date),
    day: String(date.getDate()),
    label,
    year: date.getFullYear(),
    full: dayFormatters.full.format(date),
  };
}

function getDayKey(value: string) {
  const date = toDate(value);

  return date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : value;
}

function getHistoryEntityRoute(entity: HistoryEntity, setKey?: string) {
  const type: CatalogEntityType =
    entity.type === "scenario" ? "test" : (entity.type as CatalogEntityType);

  return getEntityRoute(type, entity.key, entity.set || setKey);
}

function getHistoryTypeLabel(type: string, count: number) {
  if (type === "scenario") return count === 1 ? "scenario" : "scenarios";

  const labels = entityLabels[type as CatalogEntityType];

  if (!labels) return type;

  return (count === 1 ? labels.singular : labels.plural).toLowerCase();
}

function groupHistoryEntities(entities: HistoryEntity[]) {
  const groups = new Map<string, HistoryEntity[]>();

  for (const entity of entities) {
    groups.set(entity.type, [...(groups.get(entity.type) || []), entity]);
  }

  const rank = (type: string) => {
    const index = HISTORY_TYPE_ORDER.indexOf(type);
    return index === -1 ? HISTORY_TYPE_ORDER.length : index;
  };

  return Array.from(groups.entries()).sort(([left], [right]) => rank(left) - rank(right));
}

function HistoryEntityLinks(props: { entities: HistoryEntity[]; setKey?: string }) {
  return (
    <>
      {props.entities.map((entity, index) => (
        <React.Fragment key={`${entity.type}-${entity.key}-${entity.set || ""}`}>
          {index > 0 && <span className="text-faint">, </span>}
          <Link
            to={getHistoryEntityRoute(entity, props.setKey)}
            className="font-medium text-text decoration-slate-300 underline-offset-2 hover:underline"
          >
            <EntityKey value={entity.key} />
          </Link>
        </React.Fragment>
      ))}
    </>
  );
}

/** Changed definitions grouped by type, as text rather than a wall of chips. */
function HistoryEntities(props: { entities: HistoryEntity[]; setKey?: string }) {
  const entities = props.entities;
  const [expanded, setExpanded] = React.useState(entities.length <= HISTORY_INLINE_ENTITY_LIMIT);
  const groups = groupHistoryEntities(entities);

  if (entities.length === 0) return null;

  const summary = groups
    .map(([type, items]) => `${items.length} ${getHistoryTypeLabel(type, items.length)}`)
    .join(", ");
  const collapsible = entities.length > HISTORY_INLINE_ENTITY_LIMIT;

  return (
    <div className="mt-1 text-xs">
      {collapsible && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex items-start gap-1 text-left text-muted hover:text-text"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={`mt-px h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 5l5 5-5 5" />
          </svg>
          <span>Changed {summary}</span>
        </button>
      )}
      {expanded && (
        <dl
          className={[
            "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1",
            collapsible ? "mt-2 border-l-2 border-border pl-3" : "",
          ].join(" ")}
        >
          {groups.map(([type, items]) => (
            <React.Fragment key={type}>
              <dt className="pt-px text-[10px] font-semibold uppercase leading-4 tracking-wide text-faint">
                {getHistoryTypeLabel(type, items.length)}
              </dt>
              <dd className="leading-4 [overflow-wrap:anywhere]">
                <HistoryEntityLinks entities={items} setKey={props.setKey} />
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

type RailPosition = { first: boolean; last: boolean; continues: boolean };

/**
 * One segment of the timeline rail. Every row draws the full height of its own
 * rail column, so segments join into a single line; the first row starts at its
 * marker and the last row stops at its marker, or fades out when older history
 * can still be loaded.
 */
function RailLine(props: RailPosition & { markerCenter: string }) {
  if (props.first && props.last && !props.continues) return null;

  return (
    <span
      aria-hidden="true"
      className={[
        "absolute left-1/2 w-px -translate-x-1/2",
        props.last && props.continues
          ? "bg-gradient-to-b from-border via-border to-transparent"
          : "bg-border",
      ].join(" ")}
      style={{
        top: props.first ? props.markerCenter : 0,
        bottom: props.last && !props.continues ? `calc(100% - ${props.markerCenter})` : 0,
      }}
    />
  );
}

/** Rail column width, shared by day tiles and author avatars so both centre on one line. */
const RAIL_COLUMN = "w-9";

/** Opens an earlier year: the year sits on the rail with a hairline rule beside it. */
function HistoryYearRow(props: { year: number } & RailPosition) {
  const offset = props.first ? 0 : 20;

  return (
    <li className="relative flex gap-3">
      <div className={`relative ${RAIL_COLUMN} shrink-0`}>
        <RailLine {...props} markerCenter={`${offset + 10}px`} />
        <span
          style={{ top: offset }}
          className="absolute left-1/2 flex h-5 -translate-x-1/2 items-center rounded-full bg-header-active px-2 text-[10px] font-semibold tabular-nums text-header-text ring-4 ring-surface"
        >
          {props.year}
        </span>
      </div>
      <div className="min-w-0 flex-1 pb-5" style={{ paddingTop: offset }}>
        <div className="flex h-5 items-center">
          <span aria-hidden="true" className="h-px w-full bg-border" />
        </div>
      </div>
    </li>
  );
}

/** A day starts with a small calendar tile on the rail, then its weekday and commit count. */
function HistoryDayRow(props: { label: DayLabel; count: number } & RailPosition) {
  const offset = props.first ? 0 : 16;

  return (
    <li className="relative flex gap-3">
      <div className={`relative ${RAIL_COLUMN} shrink-0`}>
        <RailLine {...props} markerCenter={`${offset + 20}px`} />
        <span
          aria-hidden="true"
          style={{ top: offset }}
          className="absolute left-1/2 flex h-10 w-9 -translate-x-1/2 flex-col items-center justify-center overflow-hidden rounded-lg border border-border bg-surface shadow-xs ring-4 ring-surface"
        >
          <span className="text-[9px] font-semibold uppercase leading-none tracking-wider text-muted">
            {props.label.month}
          </span>
          <span className="mt-0.5 text-[15px] font-semibold leading-none tabular-nums text-text">
            {props.label.day}
          </span>
        </span>
      </div>
      {/* The label line matches the 40px tile and the padding sits outside it, so the row
          always ends 16px below the tile and never runs into the first avatar. */}
      <h2
        className="min-w-0 flex-1 pb-4 text-sm"
        style={{ paddingTop: offset }}
        title={props.label.full}
      >
        <span className="sr-only">{props.label.full}</span>
        <span className="flex h-10 flex-wrap items-center gap-x-2">
          <span aria-hidden="true" className="font-medium text-text">
            {props.label.label}
          </span>
          <span aria-hidden="true" className="text-faint">
            ·
          </span>
          <span className="text-xs text-muted">
            {props.count} {props.count === 1 ? "commit" : "commits"}
          </span>
        </span>
      </h2>
    </li>
  );
}

function HistoryEntryRow(
  props: {
    entry: HistoryEntry;
    setKey?: string;
    commitUrl?: string;
    showEntities: boolean;
  } & RailPosition,
) {
  const { entry } = props;
  const commitHref = props.commitUrl?.replace("{{hash}}", entry.commit);
  const subject = entry.subject || `Changes by ${entry.author}`;
  const commitTitle = `${entry.commit.slice(0, 7)} by ${entry.author}`;

  return (
    <li className="relative flex gap-3">
      <div className={`relative ${RAIL_COLUMN} flex shrink-0 justify-center`}>
        <RailLine {...props} markerCenter="12px" />
        <AuthorAvatar name={entry.author} className="ring-4 ring-surface" />
      </div>
      <div className={`min-w-0 flex-1 ${props.last && !props.continues ? "pb-1" : "pb-5"}`}>
        <div className="flex min-w-0 items-baseline justify-between gap-4">
          {commitHref ? (
            <a
              href={commitHref}
              target="_blank"
              rel="noreferrer"
              title={`Open commit ${commitTitle}`}
              className="group/commit min-w-0 text-sm leading-6 text-text decoration-slate-400 underline-offset-2 [overflow-wrap:anywhere] hover:underline"
            >
              {subject}
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="ml-1 inline h-3 w-3 align-[-1px] text-faint opacity-0 transition-opacity group-hover/commit:opacity-100 group-focus-visible/commit:opacity-100"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 3h7v7M13 3 5.5 10.5" />
              </svg>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span
              title={commitTitle}
              className="min-w-0 text-sm leading-6 text-text [overflow-wrap:anywhere]"
            >
              {subject}
            </span>
          )}
          <time
            dateTime={entry.timestamp}
            title={formatFullTimestamp(entry.timestamp)}
            className="shrink-0 font-mono text-[11px] tabular-nums text-faint"
          >
            {formatTime(entry.timestamp)}
          </time>
        </div>
        {props.showEntities && <HistoryEntities entities={entry.entities} setKey={props.setKey} />}
      </div>
    </li>
  );
}

/** Commits grouped by day, loaded one history page at a time. */
export function HistoryTimeline(props: {
  path: string;
  setKey?: string;
  commitUrl?: string;
  showEntities?: boolean;
  limit?: number;
  /** Shown under the timeline, aligned with its content, such as a link to the full history. */
  footer?: React.ReactNode;
  /** Keep only matching commits. Applies to the pages loaded so far. */
  matches?: (entry: HistoryEntry) => boolean;
}) {
  const [entries, setEntries] = React.useState<HistoryEntry[]>([]);
  const [page, setPage] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);

  async function loadPage(nextPage: number) {
    try {
      const response = await fetchHistoryPage(props.path, nextPage);
      setEntries((current) =>
        nextPage === 1 ? response.entries : [...current, ...response.entries],
      );
      setPage(response.page);
      setTotalPages(response.totalPages);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  React.useEffect(() => {
    setEntries([]);
    setPage(0);
    setTotalPages(1);
    setError(null);
    loadPage(1);
  }, [props.path]);

  if (error) {
    return <EmptyState title="History unavailable" description={error} />;
  }

  if (page === 0) {
    return <PageSkeleton label="Loading history" variant="timeline" />;
  }

  if (entries.length === 0) {
    return <EmptyState title="No history found" />;
  }

  const shown = props.matches ? entries.filter(props.matches) : entries;
  const loadOlder =
    !props.limit && page < totalPages ? (
      <div className="pl-12">
        <Button onClick={() => loadPage(page + 1)}>Load older commits</Button>
      </div>
    ) : null;
  // A filter only sees loaded pages, so say how far back it looked.
  const searched = props.matches ? (
    <p className="mb-4 text-sm text-muted">
      {shown.length} of the {entries.length} most recent commits match.
      {page < totalPages && " Load older commits to search further."}
    </p>
  ) : null;

  if (shown.length === 0) {
    return (
      <div className="space-y-4">
        {searched}
        <EmptyState title="No loaded commits match" />
        {loadOlder}
      </div>
    );
  }

  const visible = props.limit ? shown.slice(0, props.limit) : shown;
  const hasMore = page < totalPages || visible.length < shown.length;
  const dayCounts = new Map<string, number>();
  for (const entry of shown) {
    const key = getDayKey(entry.timestamp);
    dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
  }

  const days: Array<{
    key: string;
    label: DayLabel;
    entries: HistoryEntry[];
  }> = [];
  for (const entry of visible) {
    const key = getDayKey(entry.timestamp);
    const last = days[days.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else days.push({ key, label: formatDay(entry.timestamp), entries: [entry] });
  }

  // A year marker opens each earlier year, so day rows only need the weekday.
  const currentYear = new Date().getFullYear();
  const rows: Array<
    | { kind: "year"; year: number }
    | { kind: "day"; day: (typeof days)[number] }
    | { kind: "entry"; entry: HistoryEntry }
  > = [];
  let previousYear: number | undefined = currentYear;

  for (const day of days) {
    if (day.label.year !== undefined && day.label.year !== previousYear) {
      rows.push({ kind: "year", year: day.label.year });
    }
    previousYear = day.label.year ?? previousYear;
    rows.push({ kind: "day", day });
    day.entries.forEach((entry) => rows.push({ kind: "entry", entry }));
  }

  return (
    <div>
      {searched}
      <ol>
        {rows.map((row, index) => {
          const rail = {
            first: index === 0,
            last: index === rows.length - 1,
            continues: hasMore,
          };

          if (row.kind === "year") {
            return <HistoryYearRow key={`year-${row.year}`} year={row.year} {...rail} />;
          }

          return row.kind === "day" ? (
            <HistoryDayRow
              key={`day-${row.day.key}`}
              label={row.day.label}
              count={dayCounts.get(row.day.key) || row.day.entries.length}
              {...rail}
            />
          ) : (
            <HistoryEntryRow
              key={`${row.entry.commit}-${row.entry.timestamp}`}
              entry={row.entry}
              setKey={props.setKey}
              commitUrl={props.commitUrl}
              showEntities={props.showEntities !== false}
              {...rail}
            />
          );
        })}
      </ol>

      {loadOlder}
      {props.footer && <div className="pl-12">{props.footer}</div>}
    </div>
  );
}

const HISTORY_TYPES: Array<{ type: HistoryEntity["type"]; label: string }> = [
  { type: "feature", label: "Features" },
  { type: "variable", label: "Variables" },
  { type: "segment", label: "Segments" },
  { type: "attribute", label: "Attributes" },
  { type: "target", label: "Targets" },
  { type: "schema", label: "Schemas" },
  { type: "test", label: "Tests" },
  { type: "scenario", label: "Scenarios" },
];

/** Text matches a commit's subject, author, hash or any changed key. */
export function getHistoryMatcher(query: string, type?: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length && !type) return undefined;
  return (entry: HistoryEntry) => {
    if (type && !entry.entities.some((entity) => entity.type === type)) return false;
    const text = [
      entry.subject || "",
      entry.author,
      entry.commit,
      ...entry.entities.map((entity) => entity.key),
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  };
}

export function HistoryPage() {
  const { manifest } = useCatalog();
  const { setKey } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  useDocumentTitle("History", setKey && decodeURIComponent(setKey));
  const path = setKey
    ? `/data/sets/${encodeRouteSegment(setKey)}/history`
    : "/data/project/history";
  const query = searchParams.get("q") || "";
  const type = searchParams.get("type") || undefined;
  const matches = React.useMemo(() => getHistoryMatcher(query, type), [query, type]);
  const update = (key: string, value?: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title={setKey ? `History for ${setKey}` : "Project History"}
        description="Recent Git changes for authored definitions."
      />
      <div className="space-y-4 px-6 pb-6">
        <div className="space-y-3">
          <input
            type="search"
            value={query}
            onChange={(event) => update("q", event.target.value || undefined)}
            placeholder="Search commits, authors and keys..."
            aria-label="Search history"
            className="w-full rounded-full border border-border bg-surface px-5 py-2 text-base text-text outline-none placeholder:text-faint focus:border-primary"
          />
          <div role="group" aria-label="Changed type" className="flex flex-wrap gap-1.5">
            {HISTORY_TYPES.map((item) => {
              const active = type === item.type;
              return (
                <button
                  key={item.type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update("type", active ? undefined : item.type)}
                  className={[
                    "cursor-pointer rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                    active
                      ? "border-header-active bg-header-active text-header-text"
                      : "border-slate-300 bg-surface text-slate-700 hover:border-slate-400 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
        <HistoryTimeline
          path={path}
          setKey={setKey}
          commitUrl={manifest.links?.commit}
          matches={matches}
        />
      </div>
    </div>
  );
}
