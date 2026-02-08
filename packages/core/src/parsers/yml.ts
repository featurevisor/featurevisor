import * as fs from "fs";

import { parse, parseDocument, stringify } from "yaml";
import type { Pair, YAMLMap, YAMLSeq } from "yaml/types";
import { Scalar as ScalarCtor } from "yaml/types";

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
  const srcVal = source.value as
    | { comment?: string | null; commentBefore?: string | null }
    | undefined;
  const tgtVal = target.value;
  if (srcVal && tgtVal && typeof tgtVal === "object" && tgtVal !== null) {
    const t = tgtVal as { comment?: string | null; commentBefore?: string | null };
    if (srcVal.comment != null) t.comment = srcVal.comment;
    if (srcVal.commentBefore != null) t.commentBefore = srcVal.commentBefore;
  }
}

function isYamlMap(node: unknown): node is YAMLMap {
  return node != null && typeof node === "object" && Array.isArray((node as YAMLMap).items);
}

function isYamlSeq(node: unknown): node is YAMLSeq {
  return node != null && typeof node === "object" && Array.isArray((node as YAMLSeq).items);
}

function seqItemValueKey(item: unknown): string {
  if (item == null) return String(item);
  const n = item as { value?: unknown; toJSON?: () => unknown };
  if (typeof n.value !== "undefined") return JSON.stringify(n.value);
  if (typeof n.toJSON === "function") return JSON.stringify(n.toJSON());
  return JSON.stringify(item);
}

function primitiveValueKey(v: unknown): string {
  return JSON.stringify(v);
}

function createValueWithComments(
  schema: { createNode: (v: unknown) => unknown; createPair: (k: unknown, v: unknown) => Pair },
  oldNode: unknown,
  newValue: unknown,
): unknown {
  if (newValue === null || typeof newValue !== "object") {
    const node = new ScalarCtor(newValue);
    const old = oldNode as { comment?: string | null; commentBefore?: string | null } | undefined;
    if (old) {
      if (old.comment != null) node.comment = old.comment;
      if (old.commentBefore != null) node.commentBefore = old.commentBefore;
    }
    return node;
  }
  if (Array.isArray(newValue)) {
    const oldSeq = isYamlSeq(oldNode) ? (oldNode as YAMLSeq) : null;
    const oldItemsByValue = new Map<string, unknown>();
    if (oldSeq && oldSeq.items) {
      for (const item of oldSeq.items) {
        oldItemsByValue.set(seqItemValueKey(item), item);
      }
    }
    const newSeq = schema.createNode([]) as YAMLSeq;
    for (const el of newValue) {
      const oldItem = oldItemsByValue.get(primitiveValueKey(el));
      const itemNode = createValueWithComments(schema, oldItem, el);
      newSeq.add(itemNode);
    }
    return newSeq;
  }
  // newValue is a plain object; preserve comments from old map if present
  const oldMap = isYamlMap(oldNode) ? (oldNode as YAMLMap) : null;
  const oldPairsByKey = new Map<string, Pair>();
  if (oldMap) {
    for (const pair of (oldMap.items || []) as Pair[]) {
      const keyStr = getKeyString(pair.key);
      if (keyStr !== undefined) oldPairsByKey.set(keyStr, pair);
    }
  }
  const newMap = schema.createNode({}) as YAMLMap;
  const obj = newValue as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    const oldPair = oldPairsByKey.get(k);
    const childOldNode = oldPair ? oldPair.value : undefined;
    const childNewValue = createValueWithComments(schema, childOldNode, obj[k]);
    const newPair = schema.createPair(k, childNewValue);
    if (oldPair) copyComments(oldPair, newPair);
    newMap.add(newPair);
  }
  const result = newMap as { comment?: string | null; commentBefore?: string | null };
  const oldVal = oldNode as { comment?: string | null; commentBefore?: string | null } | undefined;
  if (oldVal && result) {
    if (oldVal.comment != null) result.comment = oldVal.comment;
    if (oldVal.commentBefore != null) result.commentBefore = oldVal.commentBefore;
  }
  return result;
}

function replaceContentsPreservingComments(
  doc: {
    contents: unknown;
    schema: { createNode: (v: unknown) => unknown; createPair: (k: unknown, v: unknown) => Pair };
  },
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
    const oldPair = oldPairsByKey.get(key);
    const valueNode = createValueWithComments(schema, oldPair?.value, newContent[key]);
    const newPair = schema.createPair(key, valueNode);
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
