/** A position in a definition: map keys as strings and list indexes as numbers. */
export type FormatPath = (string | number)[];

/**
 * How Featurevisor lays out a definition, whatever its file format. Featurevisor builds one
 * per kind of definition and passes it to a parser's `format`, which applies what its format
 * can express and ignores the rest.
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
  /** The parsed value with every map's keys in order, for parsers that write from values */
  orderValue: <T>(value: T) => T;
}
