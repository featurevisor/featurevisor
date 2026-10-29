import type { CustomParser } from "@featurevisor/parsers";
import type { EntityType } from "@featurevisor/types";

import { describeParseError } from "../datasource/parseError";
import { getFormatLayout } from "./layout";

export interface FormatResult {
  output: string;
  changed: boolean;
  /** The parser's `format` left the file as it is, such as a file whose comments it cannot keep */
  declined?: boolean;
}

/** The source could not be read as a definition, so it was left as it is. */
export class FormatParseError extends Error {
  line?: number;
  column?: number;

  constructor(cause: unknown) {
    // as lint reports it: one line, with the position kept apart from the message
    const { message, line, column } = describeParseError(cause);
    super(message);
    this.name = "FormatParseError";
    this.line = line;
    this.column = column;
  }
}

/** Formatting would have changed a value, lost something, or was not stable. Never written. */
export class FormatGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatGuardError";
  }
}

/** Whether the parser lays out its own files. Built-in YAML and JSON do. */
export function canFormat(parser: CustomParser): boolean {
  return typeof parser.format === "function";
}

function dateText(date: Date): string {
  try {
    // TOML's dates write their own kind here: a date, a time, or both
    return date.toISOString();
  } catch {
    return String(date.getTime());
  }
}

/** Equal as values: maps compare without key order, lists in order, dates by their time. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a === "number") return Number.isNaN(a) && Number.isNaN(b as number);
  if (typeof a !== "object") return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;

  if (a instanceof Date) {
    return Object.is(a.getTime(), (b as Date).getTime()) && dateText(a) === dateText(b as Date);
  }
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((item, index) => sameValue(item, other[index]));
  }

  const prototype = Object.getPrototypeOf(a);
  // any other kind of object cannot be compared, so it never passes for the same
  if (prototype !== Object.prototype && prototype !== null) return false;

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && sameValue(left[key], right[key]));
}

function sameComments(parser: CustomParser, source: string, output: string): boolean {
  if (typeof parser.listComments !== "function") return true;
  const before = [...parser.listComments(source)].sort();
  const after = [...parser.listComments(output)].sort();
  return before.length === after.length && before.every((line, index) => line === after[index]);
}

function parseSource(parser: CustomParser, source: string, filePath?: string): unknown {
  try {
    return parser.parse(source, filePath);
  } catch (error) {
    throw new FormatParseError(error);
  }
}

/**
 * One pass of the parser's `format`, or undefined when it leaves the file as it is. Line
 * endings, a byte order mark and the final newline are the same in every format, so they are
 * handled here: the parser sees `\n` line endings, and the file keeps its own.
 */
function formatOnce(
  entityType: EntityType,
  source: string,
  parser: CustomParser,
  filePath?: string,
): string | undefined {
  const bom = source.startsWith("﻿") ? "﻿" : "";
  const text = source.slice(bom.length);
  const crlf = text.match(/\r?\n/)?.[0] === "\r\n";

  let output: string | undefined;
  try {
    output = parser.format!(
      crlf ? text.replace(/\r\n/g, "\n") : text,
      getFormatLayout(entityType),
      filePath,
    );
  } catch (error) {
    // a parser that could not read the file says where, and anything else is a fault in it
    const { line } = describeParseError(error);
    if (line) throw new FormatParseError(error);
    throw new FormatGuardError((error as Error).message);
  }

  if (output === undefined || output === null) return undefined;
  if (output.length > 0 && !output.endsWith("\n")) output += "\n";
  return bom + (crlf ? output.replace(/\n/g, "\r\n") : output);
}

/**
 * Formats one definition file's source with its parser's `format`, which applies what its
 * format can express of Featurevisor's layout for this kind of definition. The result is
 * checked before it is returned: it must parse to the same value, keep every comment when the
 * parser can list them, and stay the same when formatted again.
 */
export function formatDefinition(
  entityType: EntityType,
  source: string,
  parser: CustomParser,
  filePath?: string,
): FormatResult {
  if (!canFormat(parser)) return { output: source, changed: false };

  const before = parseSource(parser, source, filePath);
  const output = formatOnce(entityType, source, parser, filePath);
  if (output === undefined) return { output: source, changed: false, declined: true };
  if (output === source) return { output, changed: false };

  const after = parseSource(parser, output, filePath);
  if (!sameValue(before, after)) {
    throw new FormatGuardError("Formatting would change the parsed value.");
  }
  if (!sameComments(parser, source, output)) {
    throw new FormatGuardError("Formatting would lose or change a comment.");
  }
  if (formatOnce(entityType, output, parser, filePath) !== output) {
    throw new FormatGuardError("Formatting is not stable: a second pass changes the output.");
  }

  return { output, changed: true };
}
