import { getPortableTimestamp } from "@featurevisor/sdk";
import type { Deadline, Metadata, MetadataKind } from "@featurevisor/types";

import { FeaturevisorCLIError } from "../error";

/**
 * Metadata is for people and never reaches a datafile. Featurevisor understands two of its keys,
 * `owner` and `deadlines`, and this module reads them for lint and `list`. Catalog cannot import
 * Core, so catalog/src/metadata.ts keeps its own copy of the reading, and a test in this folder
 * checks that both agree.
 */

/** The kinds of definition that can carry metadata, in the order the docs list them */
export const METADATA_KINDS: readonly MetadataKind[] = [
  "features",
  "variables",
  "segments",
  "attributes",
  "targets",
  "schemas",
];

export type DeadlineStatus = "done" | "overdue" | "today" | "upcoming" | "later";

/** Words a deadline filter reads as statuses, so none of them can name a deadline type */
export const DEADLINE_STATUS_FILTERS = [
  "overdue",
  "today",
  "upcoming",
  "later",
  "open",
  "done",
] as const;

/** How many days ahead a deadline is upcoming rather than later */
export const UPCOMING_DAYS = 30;

/** Featurevisor's own fields of every deadline. A type's own fields come after them. */
export const DEADLINE_FIELDS = ["by", "done", "description"];

const DEADLINE_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const DAY = 24 * 60 * 60 * 1000;
export const TIMESTAMP_EXAMPLE = "2027-01-15T09:00:00Z";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

/** Metadata as JSON writes it, so a TOML date or a JavaScript Date reads as its string */
export function toMetadataJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? undefined : JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** A deadline type key, such as `review` or `notifyCustomers`, that is not a status word */
export function isDeadlineType(key: string): boolean {
  return (
    DEADLINE_TYPE_PATTERN.test(key) &&
    !(DEADLINE_STATUS_FILTERS as readonly string[]).includes(key.toLowerCase())
  );
}

/** Why a key cannot name a deadline type, as a sentence, or undefined when it can */
export function getDeadlineTypeError(key: string): string | undefined {
  if (isDeadlineType(key)) return undefined;
  return DEADLINE_TYPE_PATTERN.test(key)
    ? `${JSON.stringify(key)} is a deadline status, so it cannot name a deadline type.`
    : "A deadline type starts with a letter, and has only letters, digits, _ and -.";
}

/** Whether a filter value is a status word, in any case, as Catalog's `deadline:` reads it */
export function isDeadlineStatusFilter(value: string): boolean {
  return (DEADLINE_STATUS_FILTERS as readonly string[]).includes(value.toLowerCase());
}

/** A calendar date written as YYYY-MM-DD that exists. Deadlines need a time too, and lint says so */
export function isCalendarDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    getPortableTimestamp(`${value}T00:00:00Z`) !== null
  );
}

/**
 * Milliseconds for an ISO 8601 timestamp with a timezone, such as 2027-03-01T09:00:00Z. Conditions
 * read `before` and `after` with the same function, so both accept exactly the same timestamps.
 */
export function getDeadlineTimestamp(value: unknown): number | null {
  return typeof value === "string" ? getPortableTimestamp(value) : null;
}

/** A timestamp with a timezone, as `by`, `done` and `--now` accept */
export function isDeadlineTimestamp(value: unknown): value is string {
  return getDeadlineTimestamp(value) !== null;
}

/**
 * What a value that is not a timestamp needs, worded as conditions word it. A date alone is the
 * likely slip, so it gets the timestamp it could become.
 */
export function getTimestampMessage(value: unknown, expected = "a timestamp with a timezone") {
  return isCalendarDate(value)
    ? `Expected ${expected}, such as ${value}T09:00:00Z. A date alone has no time or timezone.`
    : `Expected ${expected}, such as ${TIMESTAMP_EXAMPLE}. Use YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm.`;
}

/** Refuses a `--now` that is not a timestamp, for `list` and `lint` alike */
export function assertNowOption(value: unknown) {
  if (value === undefined || isDeadlineTimestamp(value)) return;
  throw new FeaturevisorCLIError(
    `Invalid --now: ${JSON.stringify(value)}. ${getTimestampMessage(value)}`,
    { code: "invalid_cli_arguments", details: { option: "now" } },
  );
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

/** The local calendar date of a moment, as YYYY-MM-DD */
function getLocalDate(time: number): string {
  const date = new Date(time);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  // setUTCFullYear keeps years before 100 as written, which Date.UTC would move to the 1900s
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  return Math.round(utc.getTime() / DAY);
}

/** Calendar days from the clock's date to a moment's local date */
function daysUntil(timestamp: number, clock: DeadlineClock): number {
  return dayNumber(getLocalDate(timestamp)) - dayNumber(clock.today);
}

/**
 * The moment statuses are worked out at, and its local date. `--now` fixes the moment, so a
 * report reads the same on every run.
 */
export interface DeadlineClock {
  now: number;
  today: string;
}

/** The clock at a timestamp, such as `--now` gives, or at the current moment */
export function getDeadlineClock(at?: string, now = Date.now()): DeadlineClock {
  const moment = at === undefined ? now : (getDeadlineTimestamp(at) ?? now);
  return { now: moment, today: getLocalDate(moment) };
}

export function isDeadlineDone(deadline: { done?: unknown }): boolean {
  return deadline.done === true || (typeof deadline.done === "string" && deadline.done !== "");
}

/** Days from today to the day a deadline is due: 0 today, negative once it has passed */
export function getDaysUntilDeadline(by: unknown, clock: DeadlineClock): number | undefined {
  const timestamp = getDeadlineTimestamp(by);
  return timestamp === null ? undefined : daysUntil(timestamp, clock);
}

/**
 * A deadline is overdue from the moment in `by`. Before that it is due today on the same local
 * day, upcoming within 30 days, and later after that.
 */
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

/** Whether a status matches a filter word. `upcoming` includes today, `open` is anything not done. */
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
  if (!isPlainObject(metadata)) return [];
  const owner = metadata.owner;
  if (typeof owner === "string") return owner ? [owner] : [];
  return Array.isArray(owner)
    ? owner.filter((name): name is string => typeof name === "string" && name !== "")
    : [];
}

export interface DeadlineEntry {
  type: string;
  deadline: Deadline;
}

/** Each deadline with a `by`, in the order written */
export function getDeadlines(metadata: unknown): DeadlineEntry[] {
  if (!isPlainObject(metadata) || !isPlainObject(metadata.deadlines)) return [];
  return Object.entries(metadata.deadlines)
    .filter(([, deadline]) => isPlainObject(deadline) && typeof deadline.by === "string")
    .map(([type, deadline]) => ({ type, deadline: deadline as Deadline }));
}

/** Whether one deadline of a type, in a status, matches every value of a filter, in any case */
export function matchesDeadline(
  type: string,
  status: DeadlineStatus | undefined,
  values: string[],
): boolean {
  return values.every((value) =>
    isDeadlineStatusFilter(value)
      ? matchesDeadlineStatus(status, value)
      : type.toLowerCase() === value.toLowerCase(),
  );
}

/**
 * Whether one deadline matches every value, each a status word or a type. Several values
 * describe one deadline, so `remove` and `upcoming` find removals that are coming up.
 */
export function matchesDeadlineFilters(
  metadata: Metadata | unknown,
  values: string[],
  clock: DeadlineClock,
): boolean {
  if (values.length === 0) return true;
  return getDeadlineStatuses(metadata, clock).some(({ type, status }) =>
    matchesDeadline(type, status, values),
  );
}

/** Each deadline's type, date and status, as `list --deadline --json` adds them */
export function getDeadlineStatuses(metadata: unknown, clock: DeadlineClock) {
  return getDeadlines(metadata).map(({ type, deadline }) => ({
    type,
    by: deadline.by,
    status: getDeadlineStatus(deadline, clock),
  }));
}
