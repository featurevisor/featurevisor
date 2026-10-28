import { jsonParser } from "./json";
import type { FormatLayout } from "./layout";
import { ymlParser } from "./yml";

export { formatYml, listYmlComments, YmlFormatError } from "./format";
export type { YmlLayout } from "./format";
export type { FormatLayout, FormatPath } from "./layout";

export interface CustomParser {
  extension: string;
  parse: <T>(content: string, filePath?: string) => T;
  stringify: (content: any, filePath?: string) => string;
  /**
   * Optional. Rewrites a file's source in Featurevisor's layout, for `featurevisor fmt` and
   * for the definitions the CLI writes. Apply what the format can express, and keep anything
   * the source has that a value does not, such as comments. Without it, fmt leaves the
   * parser's files as they are.
   */
  format?: (source: string, layout: FormatLayout, filePath?: string) => string;
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
