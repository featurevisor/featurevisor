/** A position in a definition: map keys as strings and list indexes as numbers. */
export type FormatPath = (string | number)[];

/** A comment inside a value, beside the item at `path`, with its text after the `#` */
export interface FormatComment {
  path: FormatPath;
  text: string;
}

/**
 * A comment among the comments at the top of a file that tells fmt to leave the whole file as
 * it is written. Featurevisor checks for it before calling a parser's `format`.
 */
export const IGNORE_FILE_COMMENT = "featurevisor-ignore";

/**
 * A comment at the end of a line that tells fmt to keep the key and value on that line as they
 * are written, and the line where it is among its siblings. A parser's `format` honours it
 * when its format has comments.
 */
export const IGNORE_LINE_COMMENT = "featurevisor-ignore-line";

/**
 * How Featurevisor lays out a definition, whatever its file format. Featurevisor builds one
 * per kind of definition and passes it to a parser's `format`, which applies what its format
 * can express and ignores the rest. Featurevisor may add fields in a later version, and a
 * parser that does not know them keeps working.
 */
export interface FormatLayout {
  /** Spaces per level of nesting, for formats that indent */
  indent: number;
  /**
   * The keys of the map at `path` in the order to write them, or undefined to keep the
   * authored order. Keys left out of the list keep their authored order after it.
   */
  orderKeys: (path: FormatPath, keys: string[]) => string[] | undefined;
  /** Whether the entries of the map at `path` are separated by a blank line */
  spaceEntries: (path: FormatPath) => boolean;
  /** Whether the items of the list at `path` are separated by a blank line */
  spaceItems: (path: FormatPath) => boolean;
  /**
   * Whether a blank line the author wrote between two entries or items stays, besides the
   * ones the layout asks for. A run of blank lines becomes one.
   */
  keepBlankLines: boolean;
  /** The parsed value with every map's keys in order, for parsers that write from values */
  orderValue: <T>(value: T) => T;
  /**
   * The text of the string at `path` in house style, such as an expression's in
   * `conditions`, or undefined to keep it as written. Text over several lines is written as a
   * block in formats that have one. Parsers that write from values can use `applyFormatValues`.
   */
  formatText?: (path: FormatPath, text: string) => string | undefined;
  /**
   * Text to write in place of the list or map at `path`, such as a condition tree written as
   * an expression, or undefined to keep it. `comments` are the comments written inside it, each
   * with the path of the item it sits above or beside, relative to `path`, so the text can keep
   * them. Formats without comments pass none. A line marked with the ignore comment, and
   * everything below it, keeps its value.
   */
  replaceValue?: (
    path: FormatPath,
    value: unknown,
    comments: FormatComment[],
  ) => string | undefined;
  /**
   * Choices only this file format can express, such as YAML's quotes, from the house style's
   * section for the parser's extension. Empty when the house style has none for it.
   */
  options: Record<string, unknown>;
}

/**
 * A copy of `value` laid out by the layout's value hooks, for parsers that write from values:
 * each list or map `replaceValue` gives text for becomes that text, and each string takes the
 * text `formatText` gives it.
 */
export function applyFormatValues<T>(
  value: T,
  layout: Pick<FormatLayout, "formatText" | "replaceValue">,
  path: FormatPath = [],
): T {
  if (value && typeof value === "object" && (Array.isArray(value) || isPlainObject(value))) {
    const text = path.length > 0 ? layout.replaceValue?.(path, value, []) : undefined;
    if (text !== undefined) return text as T;
    if (Array.isArray(value)) {
      return value.map((item, index) => applyFormatValues(item, layout, [...path, index])) as T;
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = applyFormatValues(item, layout, [...path, key]);
    }
    return result as T;
  }
  if (typeof value === "string") return (layout.formatText?.(path, value) ?? value) as T;
  return value;
}

function isPlainObject(value: object): boolean {
  return Object.getPrototypeOf(value) === Object.prototype;
}
