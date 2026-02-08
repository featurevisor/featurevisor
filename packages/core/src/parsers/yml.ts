import * as fs from "fs";

import { parse, parseDocument, stringify } from "yaml";
import type { Pair, YAMLMap } from "yaml/types";

import type { CustomParser } from "./index";

function getKeyString(keyNode: unknown): string | undefined {
  if (keyNode == null) return undefined;
  if (typeof (keyNode as { value?: unknown }).value !== "undefined") {
    return String((keyNode as { value: unknown }).value);
  }
  return typeof keyNode === "string" ? keyNode : undefined;
}

function copyComments(source: Pair, target: Pair): void {
  if (source.comment != null) target.comment = source.comment;
  if (source.commentBefore != null) target.commentBefore = source.commentBefore;
  const srcVal = source.value as { comment?: string | null; commentBefore?: string | null } | undefined;
  const tgtVal = target.value as { comment?: string | null; commentBefore?: string | null } | undefined;
  if (srcVal && tgtVal) {
    if (srcVal.comment != null) tgtVal.comment = srcVal.comment;
    if (srcVal.commentBefore != null) tgtVal.commentBefore = srcVal.commentBefore;
  }
}

function replaceContentsPreservingComments(
  doc: { contents: unknown; schema: { createNode: (v: unknown) => unknown; createPair: (k: unknown, v: unknown) => Pair } },
  newContent: Record<string, unknown>,
): void {
  const oldRoot = doc.contents as YAMLMap | null | undefined;
  if (!oldRoot || !Array.isArray((oldRoot as YAMLMap).items)) {
    doc.contents = doc.schema.createNode(newContent) as typeof doc.contents;
    return;
  }

  const schema = doc.schema;
  const oldPairsByKey = new Map<string, Pair>();
  for (const pair of (oldRoot as YAMLMap).items as Pair[]) {
    const keyStr = getKeyString(pair.key);
    if (keyStr !== undefined) oldPairsByKey.set(keyStr, pair);
  }

  const newMap = schema.createNode({}) as YAMLMap;
  for (const key of Object.keys(newContent)) {
    const newPair = schema.createPair(key, newContent[key]);
    const oldPair = oldPairsByKey.get(key);
    if (oldPair) copyComments(oldPair, newPair);
    newMap.add(newPair);
  }

  (doc as { contents: unknown }).contents = newMap;
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

    // newObject is the final saved object; existing file is only for ordering/comments
    if (content === null || typeof content !== "object" || Array.isArray(content)) {
      throw new Error("Cannot set root document to a primitive value");
    }

    const doc = parseDocument(fileContent) as {
      contents: unknown;
      schema: { createNode: (v: unknown) => unknown; createPair: (k: unknown, v: unknown) => Pair };
    };
    replaceContentsPreservingComments(doc, content);
    return doc.toString();
  },
};
