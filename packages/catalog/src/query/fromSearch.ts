import { isDeadlineStatusFilter } from "../metadata";

import type { Subject } from "./report";

/**
 * A list's search as FQL, for "Open in Query": `tag:web owner:growth-team checkout` becomes
 * `WHERE tags includes 'web' and owners includes 'growth-team' and (key contains 'checkout' or
 * description contains 'checkout')`. Filters FQL has no property for stay behind as a comment,
 * so the report says what it left out.
 */

const quote = (text: string) => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const WITH: Record<string, [string, string]> = {
  variations: ["variations notEmpty", "variations empty"],
  variables: ["variables notEmpty", "variables empty"],
  composition: ["composed == true", "composed == false"],
  tests: ["tested == true", "tested == false"],
  drift: ["differs == true", "differs == false"],
  usage: ["usedBy > 0", "usedBy == 0"],
  dependents: ["usedBy > 0", "usedBy == 0"],
  dependencies: [
    "(segments notEmpty or attributes notEmpty or requires notEmpty)",
    "segments empty and attributes empty and requires empty",
  ],
  "deprecated-dependency": ["usesDeprecated == true", "usesDeprecated == false"],
  owner: ["owner exists", "owner notExists"],
  deadlines: ["deadline exists", "deadline notExists"],
};

/** One list filter as an FQL condition, or undefined when FQL has no property for it */
export function filterToCondition(key: string, value: string): string | undefined {
  const name = key.toLowerCase();
  if (name === "tag") return `tags includes ${quote(value)}`;
  if (name === "in") return `environments includes ${quote(value)}`;
  if (name === "archived" || name === "deprecated")
    return `${name} == ${value.toLowerCase() === "true"}`;
  if (name === "type") return `type == ${quote(value)}`;
  if (name === "format") return `format == ${quote(value)}`;
  if (name === "variation") return `variations includes ${quote(value)}`;
  if (name === "variable") return `variables includes ${quote(value)}`;
  if (name === "owner") return `owners includes ${quote(value)}`;
  if (name === "deadline") {
    const status = value.toLowerCase();
    if (status === "open") return "deadlineStatus in ['overdue', 'today', 'upcoming', 'later']";
    return isDeadlineStatusFilter(status)
      ? `deadlineStatus == ${quote(status)}`
      : `deadlineType == ${quote(value)}`;
  }
  if (name === "metadata") {
    const [path, ...rest] = value.split("=");
    if (!/^[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*$/.test(path)) return undefined;
    return rest.length ? `metadata.${path} == ${quote(rest.join("="))}` : `metadata.${path} exists`;
  }
  if (name === "with" || name === "without") {
    const pair = WITH[value.toLowerCase()];
    return pair && pair[name === "with" ? 0 : 1];
  }
  return undefined;
}

/** A list search's filters and words, as the list reads them but keeping their case */
function tokensOf(search: string) {
  const tokens: Array<{ key?: string; value: string; text: string }> = [];
  const matcher = /(?:(\w+):"([^"]+)")|(?:(\w+):([^\s]+))|(?:"([^"]+)")|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(search))) {
    const key = match[1] || match[3];
    const value = match[2] || match[4];
    if (key && value) tokens.push({ key, value, text: match[0] });
    else tokens.push({ value: match[5] || match[6], text: match[0] });
  }
  return tokens;
}

const FROM: Partial<Record<Subject, string>> = {
  feature: "features",
  variable: "variables",
  segment: "segments",
  attribute: "attributes",
};

/** The FQL a list's search opens as on the Query page, for the lists FQL reads */
export function searchToFql(subject: Subject, search: string): string {
  const conditions: string[] = [];
  const left: string[] = [];
  for (const token of tokensOf(search.trim())) {
    if (token.key === undefined) {
      const word = quote(token.value);
      conditions.push(`(key contains ${word} or description contains ${word})`);
      continue;
    }
    const condition = filterToCondition(token.key, token.value);
    if (condition) conditions.push(condition);
    else left.push(token.text);
  }
  return [
    ...(left.length ? [`# Not in FQL: ${left.join(" ")}`] : []),
    `FROM ${FROM[subject]}`,
    ...(conditions.length
      ? [`WHERE ${conditions[0]}`, ...conditions.slice(1).map((item) => `  and ${item}`)]
      : []),
  ].join("\n");
}
