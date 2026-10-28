import type { CustomParser } from "./index";

export const jsonParser: CustomParser = {
  extension: "json",
  parse: function <T>(content: string): T {
    return JSON.parse(content) as T;
  },
  stringify: function (content: any) {
    return JSON.stringify(content, null, 2);
  },
  // JSON has no comments or blank lines, so only the key order applies
  format: function (source, layout) {
    return `${JSON.stringify(layout.orderValue(JSON.parse(source)), null, 2)}\n`;
  },
};
