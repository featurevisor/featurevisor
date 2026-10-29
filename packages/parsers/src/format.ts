import { isMap, isPair, isScalar, isSeq, parse, parseDocument, Scalar, visit } from "yaml";
import type { Document, Node, Pair, YAMLMap, YAMLSeq } from "yaml";

import type { FormatLayout, FormatPath } from "./layout";

/** The parts of a layout YAML applies. All are optional: without them, YAML keeps the
 * authored key order, adds no blank lines and indents by two. */
export type YmlLayout = Partial<
  Pick<FormatLayout, "indent" | "orderKeys" | "spaceEntries" | "spaceItems">
>;

// YAML's own choices, beside the layout: list items indented under their key, long strings
// never folded, and needed quotes double, or single when the text has a double quote in it,
// the choice with the fewest escapes, as Prettier makes it.
const TO_STRING_OPTIONS = {
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

/**
 * A comment after a value can carry the blank lines that follow it. The layout decides those,
 * so they are dropped here, or each pass would add the layout's blank line to them.
 */
function trimTrailingComment(node: { comment?: string | null }) {
  if (node.comment) node.comment = node.comment.replace(/\n+$/, "");
}

function walk(node: unknown, path: FormatPath, layout: YmlLayout, inSequence: boolean) {
  if (node && typeof node === "object") trimTrailingComment(node as { comment?: string | null });

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

    const spaced = layout.spaceEntries?.(path) === true;
    (map.items as Pair[]).forEach((pair, index) => {
      if (isScalar(pair.key)) {
        formatScalar(pair.key);
        pair.key.spaceBefore = spaced && index > 0;
      }
      const key = keyOf(pair);
      walk(pair.value, key === undefined ? path : [...path, key], layout, false);
    });
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

function layOut(source: string, layout: YmlLayout): string {
  const doc = parseDocument(source) as Document.Parsed;
  // a YAMLParseError, with the position in its linePos
  if (doc.errors.length > 0) throw doc.errors[0];

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

  // one document a file, so neither --- nor ... marks where it starts or ends
  if (doc.directives) {
    doc.directives.docStart = null;
    doc.directives.docEnd = false;
  }

  return doc.toString({ ...TO_STRING_OPTIONS, indent: layout.indent ?? 2 });
}

/**
 * Formats a YAML document with a layout: its indentation, key order, and blank lines between
 * the entries of the maps and the items of the lists it names. YAML adds its own choices:
 * block style, no folding, quotes only where a value needs them, and comments kept with the
 * key or item below them.
 *
 * Throws the YAML parse error, with its linePos, when the source is not a single valid YAML
 * document.
 */
export function formatYml(source: string, layout: YmlLayout = {}): string {
  try {
    return layOut(source, layout);
  } catch (error) {
    // Key order can move an alias above its anchor, which YAML cannot write. Such a file
    // keeps the order it was written in, and the rest of the layout still applies.
    if (layout.orderKeys && /Unresolved alias/.test((error as Error).message)) {
      return layOut(source, { ...layout, orderKeys: undefined });
    }
    throw error;
  }
}
