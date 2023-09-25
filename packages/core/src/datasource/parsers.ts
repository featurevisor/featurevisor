import { parseYaml } from "../utils";

/**
 * If we want to add more built-in parsers,
 * add them to this object with new file extension as the key,
 * and a function that takes file content as string and returns parsed object as the value.
 */
export const parsers = {
  // extension => function
  yml(content: string) {
    return parseYaml(content);
  },

  json(content: string) {
    return JSON.parse(content);
  },
};

export type BuiltInParser = keyof typeof parsers; // keys of parsers object

export interface CustomParser {
  extension: string;
  parse: (content: string) => any;
}

export type Parser = BuiltInParser | CustomParser;
