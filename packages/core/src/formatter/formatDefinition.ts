import {
  formatYml,
  listYmlComments,
  parsers,
  YmlFormatError,
  type CustomParser,
} from "@featurevisor/parsers";

import { getYmlLayout, orderValue, type FormatEntityType } from "./keyOrder";

export interface FormatResult {
  output: string;
  changed: boolean;
}

/** The source could not be read as a definition, so it was left as it is. */
export class FormatParseError extends Error {
  line?: number;
  column?: number;

  constructor(message: string, position?: { line: number; col: number }) {
    // one line, as lint reports it: the position is kept apart from the message
    super(
      message
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)[0]
        ?.replace(/ at line \d+, column \d+:?$/, "") || message,
    );
    this.name = "FormatParseError";
    this.line = position?.line;
    this.column = position?.col;
  }
}

/** Formatting would have changed a value or lost a comment. A formatter bug, never written. */
export class FormatGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatGuardError";
  }
}

function isBuiltIn(parser: CustomParser, name: "yml" | "json") {
  const builtIn = parsers[name];
  return parser === builtIn || (parser.extension === name && parser.parse === builtIn.parse);
}

/** Equal as values: maps compare without key order, lists in order. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a === "number") return Number.isNaN(a) && Number.isNaN(b as number);
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((item, index) => sameValue(item, other[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && sameValue(left[key], right[key]));
}

function parseSource(parser: CustomParser, source: string, filePath?: string): unknown {
  try {
    return parser.parse(source, filePath);
  } catch (error) {
    const linePos = (error as { linePos?: { line: number; col: number }[] }).linePos?.[0];
    throw new FormatParseError((error as Error).message, linePos);
  }
}

function formatOnce(
  entityType: FormatEntityType,
  source: string,
  parser: CustomParser,
  filePath?: string,
): string {
  if (isBuiltIn(parser, "yml")) {
    try {
      return formatYml(source, getYmlLayout(entityType));
    } catch (error) {
      if (error instanceof YmlFormatError) throw new FormatParseError(error.message, error.linePos);
      throw error;
    }
  }

  const value = parseSource(parser, source, filePath);
  const ordered = orderValue(entityType, value);

  if (isBuiltIn(parser, "json")) {
    return `${JSON.stringify(ordered, null, 2)}\n`;
  }

  // A custom parser writes its own layout, so only the key order is Featurevisor's.
  return parser.stringify(ordered, filePath);
}

/**
 * Formats one definition file's source. YAML gets Featurevisor's layout and key order, JSON
 * and custom parsers get the key order. The result is checked before it is returned: it must
 * parse to the same value, keep every comment, and stay the same when formatted again.
 */
export function formatDefinition(
  entityType: FormatEntityType,
  source: string,
  parser: CustomParser,
  filePath?: string,
): FormatResult {
  const output = formatOnce(entityType, source, parser, filePath);
  if (output === source) return { output, changed: false };

  const before = parseSource(parser, source, filePath);
  const after = parseSource(parser, output, filePath);
  if (!sameValue(before, after)) {
    throw new FormatGuardError("Formatting would change the parsed value.");
  }

  if (isBuiltIn(parser, "yml")) {
    const commentsBefore = listYmlComments(source);
    const commentsAfter = listYmlComments(output);
    if (!sameValue(commentsBefore, commentsAfter)) {
      throw new FormatGuardError("Formatting would lose or change a comment.");
    }
  }

  if (formatOnce(entityType, output, parser, filePath) !== output) {
    throw new FormatGuardError("Formatting is not stable: a second pass changes the output.");
  }

  return { output, changed: true };
}

/**
 * Lays out text a command is about to write, such as a promoted definition. Falls back to the
 * text as given, since a write must never fail on layout.
 */
export function formatWrittenDefinition(
  entityType: FormatEntityType,
  text: string,
  parser: CustomParser,
): string {
  try {
    if (isBuiltIn(parser, "yml")) return formatYml(text, getYmlLayout(entityType));
    if (isBuiltIn(parser, "json")) return text.endsWith("\n") ? text : `${text}\n`;
  } catch {
    return text;
  }
  return text;
}
