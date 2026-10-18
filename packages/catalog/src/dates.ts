/**
 * One date vocabulary for the whole Catalog. Pages show a medium date ("11 Sept 2026"),
 * optionally with a short time, and every visible date carries the full timestamp on hover.
 */

// Constructing an Intl formatter is far slower than using one, and lists format thousands of dates.
const formatters = {
  date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }),
  time: new Intl.DateTimeFormat(undefined, { timeStyle: "short" }),
  timeWithSeconds: new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }),
  dateTime: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }),
  full: new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "long" }),
};

export function toDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function formatDate(value: string) {
  const date = toDate(value);
  return date ? formatters.date.format(date) : value;
}

export function formatTime(value: string) {
  const date = toDate(value);
  return date ? formatters.time.format(date) : "";
}

/** Seconds tell watch mode refreshes apart when several happen within a minute. */
export function formatTimeWithSeconds(value: string) {
  const date = toDate(value);
  return date ? formatters.timeWithSeconds.format(date) : "";
}

export function formatDateTime(value: string) {
  const date = toDate(value);
  return date ? formatters.dateTime.format(date) : value;
}

/** Weekday, date, time with seconds and time zone, for tooltips and assistive technology. */
export function formatFullTimestamp(value: string) {
  const date = toDate(value);
  return date ? formatters.full.format(date) : value;
}
