import { isMap, isPair, isScalar, isSeq, parse, parseDocument, Scalar, visit } from "yaml";
import type { Document, Node, Pair, YAMLMap, YAMLSeq } from "yaml";

/**
 * A position in a YAML document: map keys as strings and sequence indexes as numbers.
 */
export type YmlPath = (string | number)[];

export interface YmlLayout {
  /**
   * Returns the keys of the map at `path` in the order to write them, or undefined to keep
   * the authored order. Keys left out of the returned list keep their authored order after it.
   */
  orderKeys?: (path: YmlPath, keys: string[]) => string[] | undefined;
  /** Whether the items of the sequence at `path` are separated by a blank line */
  spaceItems?: (path: YmlPath) => boolean;
}

export class YmlFormatError extends Error {
  linePos?: { line: number; col: number };

  constructor(message: string, linePos?: { line: number; col: number }) {
    super(message);
    this.name = "YmlFormatError";
    this.linePos = linePos;
  }
}

// Long strings never fold. Needed quotes are double, or single when the text has a double
// quote in it, the choice with the fewest escapes, as Prettier makes it.
const TO_STRING_OPTIONS = {
  indent: 2,
  indentSeq: true,
  lineWidth: 0,
  minContentWidth: 0,
} as const;

/** A comment above a key belongs to it. Text above a blank line is the file's own header. */
function splitHeader(comment: string): { header?: string; own?: string } {
  const index = comment.lastIndexOf("\n\n");
  if (index === -1) return { own: comment };
  return { header: comment.slice(0, index), own: comment.slice(index + 2) || undefined };
}

/**
 * A string YAML 1.2 reads back as itself can still be read as something else by YAML 1.1
 * tools: `no` as false, `2026-10-28` as a date. Those keep double quotes.
 */
function readsAsAnotherType(value: string): boolean {
  try {
    return parse(value, { version: "1.1" }) !== value;
  } catch {
    return true;
  }
}

function formatScalar(node: Scalar) {
  if (typeof node.value !== "string") return;
  if (node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED) return;
  if (readsAsAnotherType(node.value)) {
    node.type =
      node.value.includes('"') && !node.value.includes("'")
        ? Scalar.QUOTE_SINGLE
        : Scalar.QUOTE_DOUBLE;
  } else {
    // plain where YAML allows it, quoted where it does not
    delete node.type;
  }
}

function keyOf(pair: Pair): string | undefined {
  const key = pair.key as unknown;
  if (isScalar(key)) return String(key.value);
  if (typeof key === "string" || typeof key === "number") return String(key);
  return undefined;
}

function reorder(map: YAMLMap, order: string[]) {
  const rank = new Map(order.map((key, index) => [key, index]));
  const items = (map.items as Pair[]).map((pair, index) => ({ pair, index }));
  items.sort((a, b) => {
    const ra = rank.get(keyOf(a.pair) ?? "") ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(keyOf(b.pair) ?? "") ?? Number.MAX_SAFE_INTEGER;
    return ra === rb ? a.index - b.index : ra - rb;
  });
  map.items = items.map((item) => item.pair);
}

function walk(node: unknown, path: YmlPath, layout: YmlLayout, inSequence: boolean) {
  if (isScalar(node)) {
    formatScalar(node);
    node.spaceBefore = false;
    return;
  }

  if (isMap(node)) {
    const map = node as YAMLMap;
    // empty collections stay as {} and []
    map.flow = map.items.length === 0;
    map.spaceBefore = false;

    // A comment above the first key of a nested map is stored on the map. Move it onto the
    // key so it travels with that key when keys are reordered. Sequence items keep theirs,
    // which YAML writes above the item's dash.
    if (!inSequence && map.commentBefore && map.items.length > 0) {
      const first = map.items[0] as Pair;
      if (isScalar(first.key)) {
        const own = first.key.commentBefore;
        first.key.commentBefore = own ? `${map.commentBefore}\n${own}` : map.commentBefore;
        map.commentBefore = undefined;
      }
    }

    const keys = (map.items as Pair[]).map((pair) => keyOf(pair) ?? "");
    const order = layout.orderKeys?.(path, keys);
    if (order) reorder(map, order);

    for (const pair of map.items as Pair[]) {
      if (isScalar(pair.key)) {
        formatScalar(pair.key);
        pair.key.spaceBefore = false;
      }
      const key = keyOf(pair);
      walk(pair.value, key === undefined ? path : [...path, key], layout, false);
    }
    return;
  }

  if (isSeq(node)) {
    const seq = node as YAMLSeq;
    seq.flow = seq.items.length === 0;
    seq.spaceBefore = false;
    const spaced = layout.spaceItems?.(path) === true;

    seq.items.forEach((item, index) => {
      walk(item, [...path, index], layout, true);
      if (item && typeof item === "object" && !isPair(item)) {
        (item as Node).spaceBefore = spaced && index > 0;
      }
    });
  }
}

/** Every comment line in a YAML document, trimmed, for checking that formatting kept them. */
export function listYmlComments(source: string): string[] {
  const doc = parseDocument(source);
  const comments: string[] = [];
  const add = (comment: string | null | undefined) => {
    if (!comment) return;
    for (const line of comment.split("\n")) {
      if (line.trim()) comments.push(line.trim());
    }
  };

  add(doc.commentBefore);
  add(doc.comment);
  visit(doc, {
    Node(_, node) {
      add(node.commentBefore);
      add(node.comment);
    },
  });

  return comments.sort();
}

/**
 * Formats a YAML document in Featurevisor's layout: two space indentation, block style, one
 * blank line between top level keys, blank lines between the items of the sequences the
 * layout names, no folding, and quotes only where a value needs them. Comments stay with the
 * key or item below them. The layout's key order is applied map by map.
 *
 * Throws YmlFormatError when the source is not a single valid YAML document.
 */
export function formatYml(source: string, layout: YmlLayout = {}): string {
  const doc = parseDocument(source) as Document.Parsed;

  if (doc.errors.length > 0) {
    const error = doc.errors[0];
    throw new YmlFormatError(error.message, error.linePos?.[0]);
  }

  const root = doc.contents;
  if (root === null || root === undefined) return source;

  if (isMap(root)) {
    const first = root.items[0] as Pair | undefined;
    if (first && isScalar(first.key) && first.key.commentBefore) {
      const { header, own } = splitHeader(first.key.commentBefore);
      if (header !== undefined) {
        doc.commentBefore = doc.commentBefore ? `${doc.commentBefore}\n\n${header}` : header;
        first.key.commentBefore = own;
      }
    }
  }

  walk(root, [], layout, false);

  if (isMap(root)) {
    (root.items as Pair[]).forEach((pair, index) => {
      if (isScalar(pair.key)) pair.key.spaceBefore = index > 0;
    });
  }

  if (doc.directives) doc.directives.docStart = null;

  return doc.toString(TO_STRING_OPTIONS);
}
