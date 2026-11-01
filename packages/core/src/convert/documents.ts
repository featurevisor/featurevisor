import type { CustomParser } from "@featurevisor/parsers";
import { Document, isMap, isScalar, isSeq, Scalar, YAMLMap, YAMLSeq } from "yaml";
import type { Node, Pair } from "yaml";
import type { EntityType } from "@featurevisor/types";

import { formatDefinition, type FormatDefinitionOptions } from "../formatter/formatDefinition";
import { load, render } from "../rewrite/documents";

export { load, render };

/**
 * Definitions are edited as YAML documents whatever their parser, so one set of edits serves
 * every format. A YAML file keeps its comments, and every file keeps the lines a conversion
 * does not touch.
 */

/** Whether fmt leaves a file as it is, so a converted file should be formatted too */
export function isFormatted(
  entityType: EntityType,
  text: string,
  parser: CustomParser,
  options?: FormatDefinitionOptions,
): boolean {
  try {
    const result = formatDefinition(entityType, text, parser, undefined, options);
    return !result.changed && !result.declined && !result.ignored;
  } catch {
    return false;
  }
}

/** The text as fmt writes it, or as it is when fmt cannot format it */
export function formatted(
  entityType: EntityType,
  text: string,
  parser: CustomParser,
  options?: FormatDefinitionOptions,
): string {
  try {
    return formatDefinition(entityType, text, parser, undefined, options).output;
  } catch {
    return text;
  }
}

export function rootMap(doc: Document): YAMLMap | undefined {
  return isMap(doc.contents) ? doc.contents : undefined;
}

export function pairOf(map: YAMLMap, key: string): Pair | undefined {
  return (map.items as Pair[]).find((pair) => isScalar(pair.key) && String(pair.key.value) === key);
}

/**
 * Replaces the map by lane at `key` with one lane's value, keeping the comments above that
 * lane's key. Without one, the key goes, or becomes `empty` when given.
 */
export function takeLane(map: YAMLMap, key: string, lane: string, empty?: unknown) {
  const pair = pairOf(map, key);
  if (!pair || !isMap(pair.value)) return;
  const lanes = pair.value;
  const lanePair = pairOf(lanes, lane);
  if (lanePair && lanePair.value) {
    const node = lanePair.value as Node;
    // a comment above the first lane belongs to the map of lanes
    const above = lanes.items[0] === lanePair ? lanes.commentBefore : undefined;
    const comment = joinComments(above, (lanePair.key as Node).commentBefore);
    node.commentBefore = joinComments(comment, node.commentBefore);
    trimTrailingComment(node);
    pair.value = node;
  } else if (empty !== undefined) {
    pair.value = new Document(empty).contents;
  } else {
    map.delete(key);
  }
}

function joinComments(...comments: (string | null | undefined)[]): string | undefined {
  const joined = comments.filter(Boolean).join("\n");
  return joined || undefined;
}

/** A comment after a value ends at its last line, as blank lines between keys are their own */
function trimTrailingComment(node: Node) {
  if (node.comment) node.comment = node.comment.replace(/\n+$/, "");
}

/** Whether a map's keys are separated by blank lines, as in a formatted file */
export function isSpaced(map: YAMLMap | undefined): boolean {
  return Boolean(
    map && (map.items as Pair[]).slice(1).some((pair) => (pair.key as Node)?.spaceBefore),
  );
}

/** Separates a list's items by a blank line, or by none, as `spaced` says */
export function spaceItems(list: { items: unknown[] }, spaced: boolean) {
  list.items.forEach((item, index) => {
    if (item && typeof item === "object") (item as Node).spaceBefore = spaced && index > 0;
  });
}

/** Groups the value at `key` by lane, a copy for each */
export function spreadLanes(map: YAMLMap, key: string, lanes: string[], spaced: boolean) {
  const pair = pairOf(map, key);
  if (!pair || pair.value === null || pair.value === undefined) return;
  const value = pair.value as Node;
  pair.value = laneMap(
    lanes.map((lane) => [lane, value.clone() as Node]),
    spaced,
  );
}

/** A map from lanes to their nodes, in lane order, leaving out lanes without one */
export function laneMap(
  values: [string, Node | undefined][],
  spaced: boolean,
): YAMLMap | undefined {
  const map = new YAMLMap();
  for (const [lane, node] of values) {
    if (!node) continue;
    const key = new Scalar(lane);
    key.spaceBefore = spaced && map.items.length > 0;
    trimTrailingComment(node);
    map.set(key, node);
  }
  return map.items.length > 0 ? map : undefined;
}

/**
 * Sets `key` in a map, keeping its place when it is there already. A new key goes after the
 * last of `after` the map has, and takes a blank line before it when the map's keys have them.
 */
export function setKey(map: YAMLMap, key: string, node: Node | undefined, after?: string[]) {
  const pair = pairOf(map, key);
  if (node === undefined) {
    if (pair) map.delete(key);
    return;
  }
  if (pair) {
    pair.value = node;
    return;
  }
  const spaced = isSpaced(map);
  const scalar = new Scalar(key);
  map.set(scalar, node);
  const items = map.items as Pair[];
  if (after) {
    const added = items.pop()!;
    let index = 0;
    items.forEach((item, at) => {
      if (isScalar(item.key) && after.includes(String(item.key.value))) index = at + 1;
    });
    items.splice(index, 0, added);
  }
  scalar.spaceBefore = spaced && items[0] !== items.find((item) => item.key === scalar);
}

export function nodeAt(map: YAMLMap, key: string): Node | undefined {
  return (pairOf(map, key)?.value as Node | undefined) || undefined;
}

export function seqOf(node: unknown): YAMLSeq | undefined {
  return isSeq(node) ? node : undefined;
}
