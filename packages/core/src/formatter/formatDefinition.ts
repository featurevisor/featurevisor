import type { FelOptions } from "@featurevisor/fel";
import { IGNORE_FILE_COMMENT, type CustomParser } from "@featurevisor/parsers";
import type { EntityType } from "@featurevisor/types";

import { describeParseError } from "../datasource/parseError";
import { BUILT_IN_PARSERS, lineEndings, sameComments } from "../rewrite/lines";
import { formatTextOf, getFelTexts, withFelTexts, type FelTexts } from "./fel";
import { getFormatLayout } from "./layout";
import { HOUSE_STYLE } from "./style";

export interface FormatDefinitionOptions {
  /**
   * The project's FEL options when it allows FEL, so expressions in `conditions` are written in
   * the house style too. Without them, expressions stay as written.
   */
  fel?: FelOptions;
}

export interface FormatResult {
  output: string;
  changed: boolean;
  /** The parser's `format` left the file as it is, such as a file whose comments it cannot keep */
  declined?: boolean;
  /** The file asks to be left as it is, with the ignore comment at its top */
  ignored?: boolean;
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

/** Whether one of the comments at the top of the file, in # or // syntax, is the ignore comment */
export function isIgnoredFile(source: string): boolean {
  for (const line of source.replace(/^\uFEFF/, "").split("\n")) {
    const text = line.trim();
    if (!text) continue;
    const comment = /^(?:#|\/\/)(.*)$/.exec(text);
    if (!comment) return false;
    if (comment[1].trim() === IGNORE_FILE_COMMENT) return true;
  }
  return false;
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

function parseSource(parser: CustomParser, source: string, filePath?: string): unknown {
  try {
    return parser.parse(source, filePath);
  } catch (error) {
    throw new FormatParseError(error);
  }
}

/** The house style texts of the expressions in a source, when FEL is formatted and it parses */
function felTextsOf(
  entityType: EntityType,
  source: string,
  parser: CustomParser,
  filePath: string | undefined,
  options: FormatDefinitionOptions,
): FelTexts {
  if (!options.fel) return new Map();
  let value: unknown;
  try {
    value = parser.parse(source, filePath);
  } catch {
    // the format reports the parse error itself
    return new Map();
  }
  return getFelTexts(entityType, value, options.fel);
}

/**
 * One pass of the parser's `format`, or undefined when it leaves the file as it is. Line
 * endings, a byte order mark and the final newline are the same in every format, so they are
 * handled here: the parser sees `\n` line endings, and the output gets the house style's.
 */
function formatOnce(
  entityType: EntityType,
  source: string,
  parser: CustomParser,
  filePath: string | undefined,
  texts: FelTexts,
): string | undefined {
  const { text, restore } = lineEndings(source, HOUSE_STYLE.endOfLine);
  const layout = getFormatLayout(entityType, parser.extension);
  if (texts.size > 0) layout.formatText = formatTextOf(texts);

  let output: string | undefined;
  try {
    output = parser.format!(text, layout, filePath);
  } catch (error) {
    // the author's when the parser cannot read the file either, and a fault in the format if not
    parseSource(parser, source, filePath);
    throw new FormatGuardError((error as Error).message);
  }

  if (output === undefined || output === null) return undefined;
  if (output.length > 0 && !output.endsWith("\n")) output += "\n";
  return restore(output);
}

/**
 * Formats one definition file's source with its parser's `format`, which applies what its
 * format can express of Featurevisor's layout for this kind of definition. The result is
 * checked before it is returned: it must parse to the same value, apart from FEL expressions
 * written in the house style, keep every comment when the parser can list them, and stay the
 * same when formatted again. A file with the ignore comment at its top is left as it is.
 */
export function formatDefinition(
  entityType: EntityType,
  source: string,
  parser: CustomParser,
  filePath?: string,
  options: FormatDefinitionOptions = {},
): FormatResult {
  if (!canFormat(parser)) return { output: source, changed: false };
  if (isIgnoredFile(source)) return { output: source, changed: false, ignored: true };

  const texts = felTextsOf(entityType, source, parser, filePath, options);
  const output = formatOnce(entityType, source, parser, filePath, texts);
  if (output === undefined || output === source) {
    // a built-in format reads the source as its parse does, and a custom one may not read it
    if (!BUILT_IN_PARSERS.has(parser)) parseSource(parser, source, filePath);
    return output === undefined
      ? { output: source, changed: false, declined: true }
      : { output, changed: false };
  }

  // the source parsed, so output that does not is the format's fault, not the author's
  const before = parseSource(parser, source, filePath);
  let readable = true;
  let after: unknown;
  try {
    after = parser.parse(output, filePath);
  } catch {
    readable = false;
  }
  // each expression is as written or in the house style, which fel checks reads back the same
  if (!readable || !sameValue(withFelTexts(before, texts, after), after)) {
    throw new FormatGuardError("Formatting would change the parsed value.");
  }
  if (!sameComments(parser, source, output)) {
    throw new FormatGuardError("Formatting would lose or change a comment.");
  }
  const again = felTextsOf(entityType, output, parser, filePath, options);
  if (formatOnce(entityType, output, parser, filePath, again) !== output) {
    throw new FormatGuardError("Formatting is not stable: a second pass changes the output.");
  }

  return { output, changed: true };
}
