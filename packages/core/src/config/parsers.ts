import * as YAML from "js-yaml";

/**
 * If we want to add more built-in parsers,
 * add them to this object with new file extension as the key,
 * and a function that takes file content as string and returns parsed object as the value.
 */
export const parsers: { [key: string]: CustomParser } = {
  // YAML
  yml: {
    extension: "yml",
    parse: function <T>(content: string): T {
      return YAML.load(content) as T;
    },
    stringify: function (content: any) {
      return YAML.dump(content);
    },
  },

  // JSON
  json: {
    extension: "json",
    parse: function <T>(content: string): T {
      return JSON.parse(content) as T;
    },
    stringify: function (content: any) {
      return JSON.stringify(content, null, 2);
    },
  },
};

export type BuiltInParser = keyof typeof parsers; // keys of parsers object

export interface CustomParser {
  extension: string;
  parse: <T>(content: string, filePath?: string) => T;
  stringify: (content: any) => string;
}

export type Parser = BuiltInParser | CustomParser;
