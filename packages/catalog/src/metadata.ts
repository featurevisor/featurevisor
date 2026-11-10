import type { CatalogEntityType, CatalogIndex, EntitySummary } from "./types";

/**
 * Owners and deadlines from definitions' metadata. Catalog cannot import Core, so this keeps
 * its own copy of Core's reading in core/src/metadata, and a Core test checks that both agree.
 * Statuses are always worked out here, when the page is viewed, so an export never goes stale.
 */

export type DeadlineStatus = "done" | "overdue" | "today" | "upcoming" | "later";

/** Words `deadline:` reads as statuses. None of them can name a deadline type. */
export const DEADLINE_STATUS_FILTERS = [
  "overdue",
  "today",
  "upcoming",
  "later",
  "open",
  "done",
] as const;

export const UPCOMING_DAYS = 30;

const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const DAY = 24 * 60 * 60 * 1000;
/** Separates the parts of a deadline in the index. Authored text never holds it. */
const SEPARATOR = "\u001f";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Milliseconds for an ISO 8601 timestamp with a timezone, as conditions and Core read it */
export function getDeadlineTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = TIMESTAMP_PATTERN.exec(value);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const offsetHour = +(parts[10] || 0);
  const offsetMinute = +(parts[11] || 0);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null;
  }
  const fraction = Number(`0.${parts[7] || "0"}`) * 1000;
  const sign = parts[9] === "-" ? -1 : 1;
  const offset = parts[8] === "Z" ? 0 : sign * (offsetHour * 60 + offsetMinute) * 60 * 1000;
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, second, 0);
  return utc.getTime() + Math.floor(fraction) - offset;
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

export function getLocalDate(time: number): string {
  const date = new Date(time);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  return Math.round(utc.getTime() / DAY);
}

/** The moment statuses are worked out at, and its local date */
export interface DeadlineClock {
  now: number;
  today: string;
}

export function getDeadlineClock(at?: string, now = Date.now()): DeadlineClock {
  const moment = at === undefined ? now : (getDeadlineTimestamp(at) ?? now);
  return { now: moment, today: getLocalDate(moment) };
}

/** The local date a deadline is due on */
export function getDeadlineDate(by: unknown): string | undefined {
  const timestamp = getDeadlineTimestamp(by);
  return timestamp === null ? undefined : getLocalDate(timestamp);
}

export function isDeadlineDone(deadline: { done?: unknown }): boolean {
  return deadline.done === true || (typeof deadline.done === "string" && deadline.done !== "");
}

export function getDaysUntilDeadline(by: unknown, clock: DeadlineClock): number | undefined {
  const date = getDeadlineDate(by);
  return date === undefined ? undefined : dayNumber(date) - dayNumber(clock.today);
}

export function getDeadlineStatus(
  deadline: { by?: unknown; done?: unknown },
  clock: DeadlineClock,
): DeadlineStatus | undefined {
  if (isDeadlineDone(deadline)) return "done";
  const timestamp = getDeadlineTimestamp(deadline.by);
  if (timestamp === null) return undefined;
  if (clock.now >= timestamp) return "overdue";
  const days = dayNumber(getLocalDate(timestamp)) - dayNumber(clock.today);
  if (days <= 0) return "today";
  return days <= UPCOMING_DAYS ? "upcoming" : "later";
}

export function isDeadlineStatusFilter(value: string): boolean {
  return (DEADLINE_STATUS_FILTERS as readonly string[]).includes(value);
}

export function matchesDeadlineStatus(status: DeadlineStatus | undefined, filter: string) {
  if (!status) return false;
  if (filter === "open") return status !== "done";
  if (filter === "upcoming") return status === "today" || status === "upcoming";
  return status === filter;
}

/** "notifyCustomers" reads "Notify customers", and "remove_code" "Remove code" */
export function getDeadlineLabel(type: string): string {
  const words = type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()));
  if (words.length === 0) return type;
  return (
    words[0].charAt(0).toUpperCase() +
    words[0].slice(1) +
    words
      .slice(1)
      .map((word) => ` ${word}`)
      .join("")
  );
}

export function getOwners(metadata: unknown): string[] {
  if (!isRecord(metadata)) return [];
  const owner = metadata.owner;
  if (typeof owner === "string") return owner ? [owner] : [];
  return Array.isArray(owner)
    ? owner.filter((name): name is string => typeof name === "string" && name !== "")
    : [];
}

export interface Deadline {
  type: string;
  by: string;
  done?: true | string;
  description?: string;
}

/** Each deadline with a `by`, in the order written */
export function getDeadlines(metadata: unknown): Deadline[] {
  if (!isRecord(metadata) || !isRecord(metadata.deadlines)) return [];
  return Object.entries(metadata.deadlines).flatMap(([type, deadline]) => {
    if (!isRecord(deadline) || typeof deadline.by !== "string") return [];
    return [
      {
        type,
        by: deadline.by,
        ...(deadline.done === true || (typeof deadline.done === "string" && deadline.done)
          ? { done: deadline.done as true | string }
          : {}),
        ...(typeof deadline.description === "string" && deadline.description
          ? { description: deadline.description }
          : {}),
      },
    ];
  });
}

export function matchesDeadlineFilters(
  deadlines: Deadline[],
  values: string[],
  clock: DeadlineClock,
): boolean {
  if (values.length === 0) return true;
  return deadlines.some((deadline) => {
    const status = getDeadlineStatus(deadline, clock);
    return values.every((value) =>
      isDeadlineStatusFilter(value)
        ? matchesDeadlineStatus(status, value)
        : deadline.type.toLowerCase() === value.toLowerCase(),
    );
  });
}

const DESCRIPTION_LIMIT = 160;

/** One deadline as an index string: type, by, done and description */
export function encodeDeadline(deadline: Deadline): string {
  const description = (deadline.description || "").slice(0, DESCRIPTION_LIMIT);
  return [
    deadline.type,
    deadline.by,
    deadline.done === true ? "true" : deadline.done || "",
    description,
  ]
    .join(SEPARATOR)
    .replace(new RegExp(`${SEPARATOR}+$`), "");
}

export function decodeDeadline(value: string): Deadline {
  const [type, by, done, description] = value.split(SEPARATOR);
  return {
    type,
    by: by || "",
    ...(done ? { done: done === "true" ? true : done } : {}),
    ...(description ? { description } : {}),
  };
}

const summaryDeadlines = new WeakMap<EntitySummary, Deadline[]>();

/** An index summary's deadlines, decoded once per summary */
export function getSummaryDeadlines(entity: EntitySummary): Deadline[] {
  if (!entity.deadlines?.length) return [];
  let deadlines = summaryDeadlines.get(entity);
  if (!deadlines) {
    deadlines = entity.deadlines.map(decodeDeadline);
    summaryDeadlines.set(entity, deadlines);
  }
  return deadlines;
}

const STATUS_ORDER: Record<DeadlineStatus, number> = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  later: 3,
  done: 4,
};

/** The deadline that matters most: the earliest overdue, then the next one due */
export function getMostPressingDeadline(deadlines: Deadline[], clock: DeadlineClock) {
  let best: { deadline: Deadline; status: DeadlineStatus; days: number } | undefined;
  for (const deadline of deadlines) {
    const status = getDeadlineStatus(deadline, clock);
    const days = getDaysUntilDeadline(deadline.by, clock);
    if (!status || status === "done" || days === undefined) continue;
    if (
      !best ||
      STATUS_ORDER[status] < STATUS_ORDER[best.status] ||
      (STATUS_ORDER[status] === STATUS_ORDER[best.status] && days < best.days)
    ) {
      best = { deadline, status, days };
    }
  }
  return best;
}

export function compareDeadlines(
  left: { status?: DeadlineStatus; days?: number },
  right: { status?: DeadlineStatus; days?: number },
) {
  const rank = (status?: DeadlineStatus) => (status ? STATUS_ORDER[status] : 5);
  if (left.status === "done" || right.status === "done") {
    return rank(left.status) - rank(right.status) || (right.days ?? 0) - (left.days ?? 0);
  }
  return (left.days ?? Infinity) - (right.days ?? Infinity);
}

const METADATA_TERM_LIMIT = 24;
const METADATA_VALUE_LENGTH = 120;

/**
 * The project's own metadata as "path=value" for each text, number or true and false in it, so
 * lists can filter by it and search can find it. `owner` and `deadlines` have columns of their own.
 */
export function getMetadataTerms(metadata: unknown): string[] {
  if (!isRecord(metadata)) return [];
  const terms = new Set<string>();
  const walk = (value: unknown, path: string) => {
    if (terms.size >= METADATA_TERM_LIMIT) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = String(value).trim();
      if (text && text.length <= METADATA_VALUE_LENGTH) terms.add(`${path}=${text}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, path));
      return;
    }
    if (isRecord(value)) {
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    }
  };
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "owner" || key === "deadlines") continue;
    walk(value, key);
  }
  return [...terms];
}

export function splitMetadataTerm(term: string) {
  const separator = term.indexOf("=");
  return { path: term.slice(0, separator), value: term.slice(separator + 1) };
}

/**
 * `metadata:jira` finds definitions with that key, nested keys too, and `metadata:jira=checkout-1`
 * those where it holds that value, in any case.
 */
export function matchesMetadataFilter(terms: string[] | undefined, filter: string) {
  if (!terms?.length) return false;
  const separator = filter.indexOf("=");
  const path = (separator === -1 ? filter : filter.slice(0, separator)).toLowerCase();
  const value = separator === -1 ? undefined : filter.slice(separator + 1).toLowerCase();
  return terms.some((term) => {
    const item = splitMetadataTerm(term);
    const itemPath = item.path.toLowerCase();
    if (itemPath !== path && !itemPath.startsWith(`${path}.`)) return false;
    return value === undefined || item.value.toLowerCase() === value;
  });
}

/** Text worth linking: only http and https URLs, so authored text can never run script */
export function getSafeUrl(value: string): string | undefined {
  if (!/^https?:\/\/\S+$/i.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** One deadline of one definition, as the home page and the Deadlines page list them */
export interface ProjectDeadline {
  type: CatalogEntityType;
  entity: EntitySummary;
  deadline: Deadline;
  status?: DeadlineStatus;
  days?: number;
}

const METADATA_TYPES: CatalogEntityType[] = [
  "feature",
  "variable",
  "segment",
  "attribute",
  "target",
  "schema",
];

const cache = new WeakMap<CatalogIndex, Map<string, ProjectDeadline[]>>();

/** Every deadline in an index, archived definitions apart, nearest first */
export function getProjectDeadlines(index: CatalogIndex, clock: DeadlineClock): ProjectDeadline[] {
  let byDay = cache.get(index);
  if (!byDay) {
    byDay = new Map();
    cache.set(index, byDay);
  }
  const cacheKey = `${clock.today}|${clock.now === undefined ? "" : Math.floor(clock.now / 60000)}`;
  const cached = byDay.get(cacheKey);
  if (cached) return cached;

  const deadlines = METADATA_TYPES.flatMap((type) =>
    (index.entities[type] || [])
      .filter((entity) => !entity.archived && entity.deadlines?.length)
      .flatMap((entity) =>
        getSummaryDeadlines(entity).map((deadline) => ({
          type,
          entity,
          deadline,
          status: getDeadlineStatus(deadline, clock),
          days: getDaysUntilDeadline(deadline.by, clock),
        })),
      ),
  ).sort(
    (left, right) =>
      compareDeadlines(left, right) || left.entity.key.localeCompare(right.entity.key),
  );
  byDay.set(cacheKey, deadlines);
  return deadlines;
}
