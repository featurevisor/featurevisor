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

/** Featurevisor's own fields of every deadline. A type's own fields come after them. */
export const DEADLINE_FIELDS = ["by", "done", "description"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Metadata as JSON writes it, which is how everything reads metadata. A TOML date and time is an
 * object whose JSON form keeps its offset, and a TOML date alone stays a date, as lint sees it.
 */
export function toMetadataJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? undefined : JSON.parse(json);
  } catch {
    return undefined;
  }
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

function getLocalDate(time: number): string {
  const date = new Date(time);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  return Math.round(utc.getTime() / DAY);
}

/** Calendar days from the clock's date to a moment's local date */
function daysUntil(timestamp: number, clock: DeadlineClock): number {
  return dayNumber(getLocalDate(timestamp)) - dayNumber(clock.today);
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

export function isDeadlineDone(deadline: { done?: unknown }): boolean {
  return deadline.done === true || (typeof deadline.done === "string" && deadline.done !== "");
}

export function getDaysUntilDeadline(by: unknown, clock: DeadlineClock): number | undefined {
  const timestamp = getDeadlineTimestamp(by);
  return timestamp === null ? undefined : daysUntil(timestamp, clock);
}

export function getDeadlineStatus(
  deadline: { by?: unknown; done?: unknown },
  clock: DeadlineClock,
): DeadlineStatus | undefined {
  if (isDeadlineDone(deadline)) return "done";
  const timestamp = getDeadlineTimestamp(deadline.by);
  if (timestamp === null) return undefined;
  if (clock.now >= timestamp) return "overdue";
  const days = daysUntil(timestamp, clock);
  if (days <= 0) return "today";
  return days <= UPCOMING_DAYS ? "upcoming" : "later";
}

/** Whether a filter value is a status word, in any case, as `list --deadline` reads it */
export function isDeadlineStatusFilter(value: string): boolean {
  return (DEADLINE_STATUS_FILTERS as readonly string[]).includes(value.toLowerCase());
}

export function matchesDeadlineStatus(status: DeadlineStatus | undefined, filter: string) {
  if (!status) return false;
  const word = filter.toLowerCase();
  if (word === "open") return status !== "done";
  if (word === "upcoming") return status === "today" || status === "upcoming";
  return status === word;
}

/** "notifyCustomers" reads "Notify customers", and "remove_code" "Remove code" */
export function getDeadlineLabel(type: string): string {
  const words = type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()))
    .join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : type;
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

/** A description short enough for the index, ending on a whole word, with an ellipsis when cut */
function shortenDescription(description: string): string {
  if (description.length <= DESCRIPTION_LIMIT) return description;
  // Room for the ellipsis, and the last word whole unless that would lose half the text
  let cut = description.slice(0, DESCRIPTION_LIMIT - 1);
  if (/\S/.test(description[DESCRIPTION_LIMIT - 1])) {
    const words = cut.replace(/\s+\S*$/, "");
    if (words.length >= DESCRIPTION_LIMIT / 2) cut = words;
  }
  return `${cut.trimEnd()}…`;
}

/** One deadline as an index string: type, by, done and description */
export function encodeDeadline(deadline: Deadline): string {
  const description = shortenDescription(deadline.description || "");
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

/**
 * The deadline that matters most: the earliest open one, which is the earliest overdue when any
 * is, since an open deadline's status follows its moment.
 */
export function getMostPressingDeadline(deadlines: Deadline[], clock: DeadlineClock) {
  let best: { deadline: Deadline; status: DeadlineStatus; time: number } | undefined;
  for (const deadline of deadlines) {
    const status = getDeadlineStatus(deadline, clock);
    const time = getDeadlineTimestamp(deadline.by);
    if (!status || status === "done" || time === null) continue;
    if (!best || time < best.time) best = { deadline, status, time };
  }
  return best;
}

/**
 * Open deadlines first, by the moment they are due, then those done, the latest first. One that
 * is not a date Featurevisor can read comes last.
 */
export function compareDeadlines(
  left: { deadline: { by: string }; status?: DeadlineStatus },
  right: { deadline: { by: string }; status?: DeadlineStatus },
) {
  const rank = (status?: DeadlineStatus) => (!status ? 2 : status === "done" ? 1 : 0);
  const byRank = rank(left.status) - rank(right.status);
  if (byRank !== 0) return byRank;
  const leftTime = getDeadlineTimestamp(left.deadline.by) ?? 0;
  const rightTime = getDeadlineTimestamp(right.deadline.by) ?? 0;
  return left.status === "done" ? rightTime - leftTime : leftTime - rightTime;
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

/** Each index's deadlines, for the latest minute they were worked out in */
const cache = new WeakMap<CatalogIndex, { key: string; deadlines: ProjectDeadline[] }>();

/** Every deadline in an index, archived definitions apart, nearest first */
export function getProjectDeadlines(index: CatalogIndex, clock: DeadlineClock): ProjectDeadline[] {
  // Statuses change at most by the minute, so a page shares one list while the minute lasts
  const cacheKey = `${clock.today}|${Math.floor(clock.now / 60000)}`;
  const cached = cache.get(index);
  if (cached?.key === cacheKey) return cached.deadlines;

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
  cache.set(index, { key: cacheKey, deadlines });
  return deadlines;
}
