import * as fs from "node:fs";

import { parse, parseDocument, stringify, Scalar as ScalarCtor } from "yaml";
import type { Pair, YAMLMap, YAMLSeq } from "yaml";

import type { CustomParser } from "./index";

function getKeyString(keyNode: unknown): string | undefined {
  if (keyNode == null) return undefined;
  if (typeof (keyNode as { value?: unknown }).value !== "undefined") {
    return String((keyNode as { value: unknown }).value);
  }
  return typeof keyNode === "string" ? keyNode : undefined;
}

function copyComments(source: Pair, target: Pair): void {
  const sourcePair = source as Pair & { comment?: string | null; commentBefore?: string | null };
  const targetPair = target as Pair & { comment?: string | null; commentBefore?: string | null };
  if (sourcePair.comment != null) targetPair.comment = sourcePair.comment;
  if (sourcePair.commentBefore != null) targetPair.commentBefore = sourcePair.commentBefore;
  const srcKey = source.key as
    | { comment?: string | null; commentBefore?: string | null }
    | undefined;
  const tgtKey = target.key;
  if (srcKey && tgtKey && typeof tgtKey === "object") {
    const t = tgtKey as {
      comment?: string | null;
      commentBefore?: string | null;
    };
    if (srcKey.comment != null) t.comment = srcKey.comment;
    if (srcKey.commentBefore != null) t.commentBefore = srcKey.commentBefore;
  }
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

interface NodeCreator {
  createNode: (value: unknown) => unknown;
  createPair: (key: unknown, value: unknown) => Pair;
}

function createValueWithComments(
  creator: NodeCreator,
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
    const newSeq = creator.createNode([]) as YAMLSeq;
    for (const el of newValue) {
      const oldItem = oldItemsByValue.get(primitiveValueKey(el));
      const itemNode = createValueWithComments(creator, oldItem, el);
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
  const newMap = creator.createNode({}) as YAMLMap;
  const obj = newValue as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    const oldPair = oldPairsByKey.get(k);
    const childOldNode = oldPair ? oldPair.value : undefined;
    const childNewValue = createValueWithComments(creator, childOldNode, obj[k]);
    const newPair = creator.createPair(k, childNewValue);
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
  } & NodeCreator,
  newContent: Record<string, unknown>,
): void {
  const oldRoot = doc.contents as YAMLMap | null | undefined;
  if (!oldRoot || !Array.isArray((oldRoot as YAMLMap).items)) {
    doc.contents = doc.createNode(newContent) as typeof doc.contents;
    return;
  }

  const oldPairsByKey = new Map<string, Pair>();
  for (const pair of (oldRoot as YAMLMap).items as Pair[]) {
    const keyStr = getKeyString(pair.key);
    if (keyStr !== undefined) oldPairsByKey.set(keyStr, pair);
  }

  const newMap = doc.createNode({}) as YAMLMap;
  for (const key of Object.keys(newContent)) {
    const oldPair = oldPairsByKey.get(key);
    const valueNode = createValueWithComments(doc, oldPair?.value, newContent[key]);
    const newPair = doc.createPair(key, valueNode);
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

    const doc = parseDocument(fileContent) as unknown as { contents: unknown } & NodeCreator;
    replaceContentsPreservingComments(doc, content);
    return doc.toString();
  },
};
