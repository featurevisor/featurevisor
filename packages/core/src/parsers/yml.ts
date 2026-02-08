import * as fs from "fs";

import { parse, parseDocument, stringify, Document } from "yaml";

import type { CustomParser } from "./index";

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

function deepMergeIntoDocument(
  doc: Document,
  newData: JsonValue,
  path: (string | number)[] = [],
): void {
  if (newData === null || typeof newData !== "object" || Array.isArray(newData)) {
    // For primitives, arrays, or null, just set the value directly
    if (path.length === 0) {
      // Can't set root to primitive, shouldn't happen in normal usage
      throw new Error("Cannot set root document to a primitive value");
    }
    doc.setIn(path, newData);

    return;
  }

  // For objects, recursively merge each key
  for (const [key, value] of Object.entries(newData)) {
    const currentPath = [...path, key];
    const existingValue = doc.getIn(currentPath, true);

    // If both existing and new values are objects, recurse
    if (
      existingValue !== undefined &&
      existingValue !== null &&
      typeof existingValue === "object" &&
      !Array.isArray(existingValue) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      // Recurse to merge nested objects
      deepMergeIntoDocument(doc, value, currentPath);
    } else {
      // Otherwise, replace the value
      doc.setIn(currentPath, value);
    }
  }
}

function saveYamlWithPreservation(doc: Document, newObjectToSave: JsonObject): Document {
  deepMergeIntoDocument(doc, newObjectToSave);

  return doc;
}

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

    const doc = parseDocument(fileContent);
    const newDoc = saveYamlWithPreservation(doc, content);

    return newDoc.toString();
  },
};
