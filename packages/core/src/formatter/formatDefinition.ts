import { YmlFormatError, type CustomParser } from "@featurevisor/parsers";

import { getFormatLayout, type FormatEntityType } from "./keyOrder";

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
  try {
    return parser.format!(source, getFormatLayout(entityType), filePath);
  } catch (error) {
    if (error instanceof YmlFormatError) throw new FormatParseError(error.message, error.linePos);
    throw new FormatGuardError((error as Error).message);
  }
}

/**
 * Formats one definition file's source with its parser's `format`, which applies what its
 * format can express of Featurevisor's layout for this kind of definition. The result is
 * checked before it is returned: it must parse to the same value and stay the same when
 * formatted again. Keeping comments is the parser's part, as the YAML parser does.
 */
export function formatDefinition(
  entityType: FormatEntityType,
  source: string,
  parser: CustomParser,
  filePath?: string,
): FormatResult {
  if (!canFormat(parser)) return { output: source, changed: false };

  const before = parseSource(parser, source, filePath);
  const output = formatOnce(entityType, source, parser, filePath);
  if (output === source) return { output, changed: false };

  const after = parseSource(parser, output, filePath);
  if (!sameValue(before, after)) {
    throw new FormatGuardError("Formatting would change the parsed value.");
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
  if (!canFormat(parser)) return text;
  try {
    return parser.format!(text, getFormatLayout(entityType));
  } catch {
    return text;
  }
}
