import type { CustomParser } from "./index";
import { formatJson, type JsonFormatOptions } from "./jsonFormat";
import { applyFormatText } from "./layout";

export const jsonParser: CustomParser = {
  extension: "json",
  parse: function <T>(content: string): T {
    return JSON.parse(content) as T;
  },
  stringify: function (content: any) {
    return JSON.stringify(content, null, 2);
  },
  // JSON has no comments, so the rest of the layout applies, with lists laid out as Prettier
  // writes them
  format: function (source, layout) {
    return formatJson(
      layout.orderValue(applyFormatText(JSON.parse(source), layout.formatText)),
      layout.indent,
      layout.options as JsonFormatOptions,
      {
        spaceEntries: layout.spaceEntries,
        spaceItems: layout.spaceItems,
        source: layout.keepBlankLines ? source : undefined,
      },
    );
  },
};
