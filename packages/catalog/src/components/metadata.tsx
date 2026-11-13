import * as React from "react";

import { entityLabels, entityTypeToPath, getBasePath, getEntityRoute } from "../entityTypes";
import { formatDate, formatDateTime, formatFullTimestamp } from "../dates";
import {
  compareDeadlines,
  DEADLINE_FIELDS,
  getDaysUntilDeadline,
  getDeadlineClock,
  getDeadlines,
  getDeadlineLabel,
  getDeadlineStatus,
  getDeadlineTimestamp,
  getSafeUrl,
  type Deadline,
  type DeadlineClock,
  type DeadlineStatus,
  type ProjectDeadline,
} from "../metadata";
import type { CatalogEntityType } from "../types";
import { Badge, EntityChip, EntityKey, MarkdownContent, OverviewChipLink, type Tone } from "./ui";

/**
 * Owners, deadlines and the rest of a definition's metadata, as Overview, lists, the home page
 * and the Deadlines page show them. Values are always text, never HTML, and only http and https
 * URLs become links.
 */

export const DEADLINE_TONES: Record<DeadlineStatus, Tone> = {
  overdue: "danger",
  today: "warning",
  upcoming: "info",
  later: "neutral",
  done: "success",
};

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "9 days", or "about 4 months" once days stop being useful */
export function formatDayDistance(days: number) {
  if (days <= 60) return plural(days, "day");
  if (days < 365 * 2) return `about ${plural(Math.round(days / 30.44), "month")}`;
  return `about ${plural(Math.round(days / 365.25), "year")}`;
}

export interface DeadlineView {
  status?: DeadlineStatus;
  days?: number;
  tone: Tone;
  /** For a badge on a list row, such as "due in 12 days" */
  short: string;
  /** For the deadline itself, such as "Overdue by 9 days" */
  long: string;
}

/**
 * How a deadline stands, in words and a tone. An archived definition needs nothing more, so its
 * open deadlines read only as not done, never as overdue, as lint and the home page treat them.
 */
export function describeDeadline(
  deadline: Deadline,
  clock: DeadlineClock,
  archived = false,
): DeadlineView {
  const status = getDeadlineStatus(deadline, clock);
  const days = getDaysUntilDeadline(deadline.by, clock);
  if (archived && status && status !== "done") {
    return { status, days, tone: "neutral", short: "not done", long: "Not done" };
  }
  const tone = status ? DEADLINE_TONES[status] : "neutral";
  if (status === "done") {
    const doneAt = typeof deadline.done === "string" ? getDeadlineTimestamp(deadline.done) : null;
    const late =
      doneAt !== null
        ? (getDaysUntilDeadline(deadline.by, getDeadlineClock(deadline.done as string)) ?? 0) * -1
        : 0;
    const long =
      doneAt !== null
        ? `Done on ${formatDate(deadline.done as string)}${late > 0 ? `, ${plural(late, "day")} after its deadline` : ""}`
        : "Done";
    return { status, days, tone, short: "done", long };
  }
  if (status === "overdue" && days !== undefined) {
    const long = days < 0 ? `Overdue by ${formatDayDistance(-days)}` : "Overdue since today";
    return { status, days, tone, short: "overdue", long };
  }
  if (status === "today") return { status, days, tone, short: "due today", long: "Due today" };
  if (days === 1) return { status, days, tone, short: "due tomorrow", long: "Due tomorrow" };
  if (days !== undefined && days > 0) {
    const distance = formatDayDistance(days);
    return { status, days, tone, short: `due in ${distance}`, long: `Due in ${distance}` };
  }
  return { status, days, tone, short: "no date", long: "Not a date Featurevisor can read" };
}

/** The status of one deadline on a list row, only while it needs attention */
export function DeadlineRowBadge(props: { deadline: Deadline; clock: DeadlineClock }) {
  const view = describeDeadline(props.deadline, props.clock);
  if (view.status !== "overdue" && view.status !== "today" && view.status !== "upcoming") {
    return null;
  }
  const title = `${getDeadlineLabel(props.deadline.type)}, due ${formatFullTimestamp(props.deadline.by)}`;
  const badge = (
    <Badge tone={view.tone} title={title}>
      {view.short}
    </Badge>
  );
  // An overdue deadline stays on phones, where the longer ones would squeeze the key
  return view.status === "overdue" ? badge : <span className="hidden sm:inline-flex">{badge}</span>;
}

export function getListRoute(type: CatalogEntityType, setKey: string | undefined, query: string) {
  return `${getBasePath(setKey)}/${entityTypeToPath[type]}?q=${encodeURIComponent(query)}`;
}

/** A qualifier with a value that can hold spaces */
export function qualifierToken(key: string, value: string) {
  return /\s/.test(value) ? `${key}:"${value}"` : `${key}:${value}`;
}

export function OwnerChips(props: { owners: string[]; type: CatalogEntityType; setKey?: string }) {
  return (
    <>
      {props.owners.map((owner) => (
        <OverviewChipLink
          key={owner}
          to={getListRoute(props.type, props.setKey, qualifierToken("owner", owner))}
          title={`Everything ${owner} owns`}
        >
          {owner}
        </OverviewChipLink>
      ))}
    </>
  );
}

/** A value a person wrote, as text, with http and https URLs as links */
function MetadataText(props: { value: string }) {
  const url = getSafeUrl(props.value);
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="font-medium text-primary underline decoration-border underline-offset-2 [overflow-wrap:anywhere] hover:decoration-current"
      >
        {props.value}
      </a>
    );
  }
  return <span className="text-text [overflow-wrap:anywhere]">{props.value}</span>;
}

function Literal(props: { value: unknown }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
      {JSON.stringify(props.value)}
    </code>
  );
}

const COLLAPSE_AFTER = 12;

function isScalar(value: unknown) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function MetadataValue(props: { value: unknown; depth: number }) {
  const [open, setOpen] = React.useState(false);
  const { value } = props;

  if (typeof value === "string") return <MetadataText value={value} />;
  if (isScalar(value)) return <Literal value={value} />;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted">none</span>;
    const shown = open ? value : value.slice(0, COLLAPSE_AFTER);
    const more = value.length - shown.length;
    if (value.every(isScalar)) {
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {shown.map((item, index) => (
            <span
              key={index}
              className="inline-flex items-center rounded-full bg-surface px-2.5 py-0.5 text-xs text-slate-700 ring-1 ring-inset ring-slate-200"
            >
              {typeof item === "string" ? <MetadataText value={item} /> : JSON.stringify(item)}
            </span>
          ))}
          {more > 0 && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              +{more} more
            </button>
          )}
        </span>
      );
    }
    return (
      <ol className="w-full space-y-2">
        {shown.map((item, index) => (
          <li key={index} className="flex gap-2">
            <span className="w-5 shrink-0 text-right font-mono text-[11px] text-faint">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <MetadataValue value={item} depth={props.depth + 1} />
            </div>
          </li>
        ))}
        {more > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              +{more} more
            </button>
          </li>
        )}
      </ol>
    );
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-muted">empty</span>;
    return (
      <dl className="w-full space-y-2 border-l border-border pl-3">
        {entries.map(([key, item]) => (
          <MetadataRow key={key} name={key} value={item} depth={props.depth + 1} />
        ))}
      </dl>
    );
  }

  return <Literal value={value} />;
}

function MetadataRow(props: { name: string; value: unknown; depth: number }) {
  return (
    <div
      className={[
        "flex flex-col gap-1 sm:flex-row sm:items-baseline",
        props.depth === 0 ? "sm:gap-5" : "sm:gap-4",
      ].join(" ")}
    >
      <dt
        className={[
          "shrink-0 font-mono text-xs text-muted [overflow-wrap:anywhere]",
          props.depth === 0 ? "sm:w-32" : "sm:w-24",
        ].join(" ")}
      >
        {props.name}
      </dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm">
        <MetadataValue value={props.value} depth={props.depth} />
      </dd>
    </div>
  );
}

/** Every key a project wrote in metadata, apart from owner and deadlines */
export function getMetadataEntries(metadata: unknown): Array<[string, unknown]> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  return Object.entries(metadata).filter(([key]) => key !== "owner" && key !== "deadlines");
}

/** Those keys as written, one row each */
export function MetadataFields(props: { entries: Array<[string, unknown]> }) {
  return (
    <dl className="space-y-3">
      {props.entries.map(([key, value]) => (
        <MetadataRow key={key} name={key} value={value} depth={0} />
      ))}
    </dl>
  );
}

export interface DeadlineEntry extends Deadline {
  /** Fields of the deadline's type, beyond by, done and description */
  fields: Array<[string, unknown]>;
}

/** Each deadline of one definition's metadata, with its type's own fields */
export function getDeadlineEntries(metadata: unknown): DeadlineEntry[] {
  const written = (metadata as { deadlines?: Record<string, Record<string, unknown>> } | undefined)
    ?.deadlines;
  return getDeadlines(metadata).map((deadline) => ({
    ...deadline,
    fields: Object.entries(written![deadline.type]).filter(
      ([field]) => !DEADLINE_FIELDS.includes(field),
    ),
  }));
}

/** One deadline: what, when and how it stands */
export function DeadlineItem(props: {
  deadline: DeadlineEntry | Deadline;
  clock: DeadlineClock;
  typeDescription?: string;
  /** Who it belongs to, on pages listing deadlines of many definitions */
  subject?: React.ReactNode;
  /** Whether its definition is archived, so that nothing about it needs attention */
  archived?: boolean;
}) {
  const { deadline, clock } = props;
  const view = describeDeadline(deadline, clock, props.archived);
  const done = view.status === "done";
  const fields = "fields" in deadline ? deadline.fields : [];

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={`text-sm font-semibold ${done ? "text-muted" : "text-text"}`}>
            {getDeadlineLabel(deadline.type)}
          </span>
          {props.subject}
        </div>
        {props.typeDescription && (
          <p className="mt-0.5 text-xs text-faint">{props.typeDescription}</p>
        )}
        {deadline.description && (
          <div className="mt-1 min-w-0 [overflow-wrap:anywhere]">
            <MarkdownContent value={deadline.description} quiet />
          </div>
        )}
        {fields.length > 0 && (
          <dl className="mt-2 flex flex-wrap gap-1.5">
            {fields.map(([field, value]) => (
              <div
                key={field}
                className="inline-flex h-5 overflow-hidden rounded-md border border-border/70 text-[10px] leading-none"
              >
                <dt className="flex items-center bg-elevated px-1.5 font-mono text-muted">
                  {field}
                </dt>
                <dd className="flex items-center bg-surface px-1.5 text-text">
                  {typeof value === "string" ? (
                    <MetadataText value={value} />
                  ) : (
                    JSON.stringify(value)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="flex shrink-0 flex-row items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
        <Badge tone={view.tone}>{view.long}</Badge>
        <time
          dateTime={deadline.by}
          title={formatFullTimestamp(deadline.by)}
          className="text-xs tabular-nums text-muted"
        >
          {done ? "Due " : ""}
          {formatDateTime(deadline.by)}
        </time>
      </div>
    </li>
  );
}

/** A definition's deadlines, open ones first by date, then those done */
export function DeadlineList(props: {
  deadlines: DeadlineEntry[];
  clock: DeadlineClock;
  types?: Record<string, { description?: string }>;
  archived?: boolean;
}) {
  const sorted = props.deadlines
    .map((deadline) => ({ deadline, status: getDeadlineStatus(deadline, props.clock) }))
    .sort(compareDeadlines);

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {sorted.map(({ deadline }) => (
        <DeadlineItem
          key={deadline.type}
          deadline={deadline}
          clock={props.clock}
          typeDescription={props.types?.[deadline.type]?.description}
          archived={props.archived}
        />
      ))}
    </ul>
  );
}

/** The definition a deadline belongs to, with its owner */
export function DeadlineSubject(props: { item: ProjectDeadline; setKey?: string }) {
  const { item } = props;
  const owners = item.entity.owners || [];
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <EntityChip
        to={getEntityRoute(item.type, item.entity.key, props.setKey)}
        label={entityLabels[item.type].singular}
      >
        <EntityKey value={item.entity.key} />
      </EntityChip>
      {owners.length > 0 && (
        <span className="text-xs text-muted [overflow-wrap:anywhere]">{owners.join(", ")}</span>
      )}
    </span>
  );
}

export function ProjectDeadlineList(props: {
  items: ProjectDeadline[];
  clock: DeadlineClock;
  setKey?: string;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {props.items.map((item) => (
        <DeadlineItem
          key={`${item.type}:${item.entity.key}:${item.deadline.type}`}
          deadline={item.deadline}
          clock={props.clock}
          subject={<DeadlineSubject item={item} setKey={props.setKey} />}
        />
      ))}
    </ul>
  );
}
