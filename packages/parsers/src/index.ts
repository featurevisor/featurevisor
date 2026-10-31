import { jsonParser } from "./json";
import type { FormatLayout } from "./layout";
import { ymlParser } from "./yml";

export { formatJson, type JsonFormatOptions } from "./jsonFormat";
export type { YmlFormatOptions } from "./ymlFormat";
export { IGNORE_FILE_COMMENT, IGNORE_LINE_COMMENT } from "./layout";
export type { FormatLayout, FormatPath } from "./layout";

export interface CustomParser {
  extension: string;
  parse: <T>(content: string, filePath?: string) => T;
  stringify: (content: any, filePath?: string) => string;
  /**
   * Optional. Rewrites a file's source in Featurevisor's layout, for `featurevisor fmt`.
   * Apply what the format can express and ignore the rest, since the layout may grow. Keep
   * anything the source has that a value does not, such as comments, or return undefined to
   * leave the file as it is. In a format with comments, keep a line that ends with
   * IGNORE_LINE_COMMENT as written. The source has `\n` line endings and no byte order mark,
   * and Featurevisor writes the house style's and ends the file with one newline. Featurevisor
   * leaves a file with IGNORE_FILE_COMMENT at its top as it is, without calling `format`.
   * Without `format`, fmt leaves the parser's files as they are.
   */
  format?: (source: string, layout: FormatLayout, filePath?: string) => string | undefined;
  /**
   * Optional. Every comment in a file's source, one entry per line, in any order. fmt checks
   * that formatting kept them all, as it checks that values stay the same.
   */
  listComments?: (source: string) => string[];
}

/**
 * If we want to add more built-in parsers,
 * add them to this object with new file extension as the key,
 * and a function that takes file content as string and returns parsed object as the value.
 */
export const parsers: { [key: string]: CustomParser } = {
  yml: ymlParser,
  json: jsonParser,
};

export type BuiltInParser = keyof typeof parsers; // keys of parsers object

export type Parser = BuiltInParser | CustomParser;

export { locateYamlString } from "./locate";
export type { LocatedString, SourcePosition } from "./locate";
