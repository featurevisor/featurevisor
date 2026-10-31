import { formatJson, parsers, type CustomParser } from "@featurevisor/parsers";
import {
  Document,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  Scalar,
  visit,
  YAMLMap,
  YAMLSeq,
} from "yaml";
import type { Node, Pair } from "yaml";
import type { EntityType } from "@featurevisor/types";

import { formatDefinition } from "../formatter/formatDefinition";
import { lineEndings, mergeLines, yamlOptions } from "../rewrite/lines";

/**
 * Definitions are edited as YAML documents whatever their parser, so one set of edits serves
 * every format. A YAML file keeps its comments, and every file keeps the lines a conversion
 * does not touch.
 */

/**
 * A file as a document. Aliases are written out in full, since splitting lanes apart can leave
 * an alias without its anchor. `expanded` says whether there were any.
 */
export function load(source: string, parser: CustomParser): { doc: Document; expanded: boolean } {
  if (parser !== parsers.yml) return { doc: new Document(parser.parse(source)), expanded: false };
  const doc = parseDocument(lineEndings(source).text);
  let expanded = false;
  visit(doc, {
    Alias(_, alias) {
      expanded = true;
      const target = alias.resolve(doc);
      return target ? (target.clone() as Node) : visit.REMOVE;
    },
  });
  if (expanded) {
    visit(doc, {
      Node(_, node) {
        if ("anchor" in node) delete (node as { anchor?: string }).anchor;
      },
    });
  }
  return { doc, expanded };
}

function write(value: unknown, parser: CustomParser): string {
  if (parser === parsers.json) return `${formatJson(value)}\n`;
  return parser.stringify(value);
}

/** Whether fmt leaves a file as it is, so a converted file should be formatted too */
function isFormatted(entityType: EntityType, text: string, parser: CustomParser): boolean {
  try {
    const result = formatDefinition(entityType, text, parser);
    return !result.changed && !result.declined && !result.ignored;
  } catch {
    return false;
  }
}

/**
 * The document as the file's new text, with the file's own lines where nothing changed. A file
 * that was formatted comes out formatted, so a project fmt keeps clean stays clean.
 */
export function render(
  source: string,
  doc: Document,
  parser: CustomParser,
  entityType?: EntityType,
): string {
  return renderFile(source, doc, parser, entityType).text;
}

/**
 * `render`, saying too whether the file came out as its parser writes it rather than in its own
 * lines. YAML keeps its comments either way and JSON has none, but a custom format may lose them.
 */
export function renderFile(
  source: string,
  doc: Document,
  parser: CustomParser,
  entityType?: EntityType,
): { text: string; rewritten: boolean } {
  const { text, restore } = lineEndings(source);
  let base: string;
  let changed: string;
  if (parser === parsers.yml) {
    const options = yamlOptions(text);
    base = parseDocument(text).toString(options);
    changed = doc.toString(options);
  } else {
    base = write(parser.parse(source), parser);
    changed = write(doc.toJS(), parser);
  }
  const merged = mergeLines(text, base, changed);
  // the merge must read back as the document, or the rendered text is written instead
  const kept = merged !== undefined && same(parser.parse(merged), doc.toJS());
  let candidate = kept ? merged : changed;
  if (entityType && candidate !== text && isFormatted(entityType, text, parser)) {
    try {
      candidate = formatDefinition(entityType, candidate, parser).output;
    } catch {
      // the merged text stands when fmt cannot format it
    }
  }
  return { text: restore(candidate), rewritten: !kept };
}

export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function rootMap(doc: Document): YAMLMap | undefined {
  return isMap(doc.contents) ? doc.contents : undefined;
}

export function pairOf(map: YAMLMap, key: string): Pair | undefined {
  return (map.items as Pair[]).find((pair) => isScalar(pair.key) && String(pair.key.value) === key);
}

/** Whether the value at `key` is a map, such as rules grouped by environment */
export function isLaneMap(map: YAMLMap, key: string): boolean {
  return isMap(pairOf(map, key)?.value);
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
