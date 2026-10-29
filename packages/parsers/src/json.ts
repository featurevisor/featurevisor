import type { CustomParser } from "./index";
import { formatJson, type JsonFormatOptions } from "./jsonFormat";

export const jsonParser: CustomParser = {
  extension: "json",
  parse: function <T>(content: string): T {
    return JSON.parse(content) as T;
  },
  stringify: function (content: any) {
    return JSON.stringify(content, null, 2);
  },
  // JSON has no comments, so the key order, indentation and the blank lines an author wrote
  // apply, and lists are laid out as Prettier writes them
  format: function (source, layout) {
    return formatJson(
      layout.orderValue(JSON.parse(source)),
      layout.indent,
      layout.options as JsonFormatOptions,
      layout.keepBlankLines ? source : undefined,
    );
  },
};
