import * as fs from "fs";

import { parse, parseDocument, stringify } from "yaml";

import type { CustomParser } from "./index";

export const ymlParser: CustomParser = {
  extension: "yml",
  parse: function <T>(content: string): T {
    return parse(content) as T;
  },
  stringify: function (content: any, filePath?: string) {
    if (!filePath || !fs.existsSync(filePath)) {
      return stringify(content);
    }

    const fileContent = fs.readFileSync(filePath, "utf8");
    if (!fileContent.trim()) {
      return stringify(content);
    }

    // newObject is the final saved object; existing file is only for ordering/comments
    if (content === null || typeof content !== "object" || Array.isArray(content)) {
      throw new Error("Cannot set root document to a primitive value");
    }

    const doc = parseDocument(fileContent);
    doc.contents = doc.schema.createNode(content) as typeof doc.contents;
    return doc.toString();
  },
};
