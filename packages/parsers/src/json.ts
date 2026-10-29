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
  // JSON has no comments or blank lines, so the key order and indentation apply, and lists
  // are laid out as Prettier writes them
  format: function (source, layout) {
    return formatJson(
      layout.orderValue(JSON.parse(source)),
      layout.indent,
      layout.options as JsonFormatOptions,
    );
  },
};
