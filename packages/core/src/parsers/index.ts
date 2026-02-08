import { jsonParser } from "./json";
import { ymlParser } from "./yml";

export interface CustomParser {
  extension: string;
  parse: <T>(content: string, filePath?: string) => T;
  stringify: (content: any) => string;
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
