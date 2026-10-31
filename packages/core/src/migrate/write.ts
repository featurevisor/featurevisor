import { isDeepStrictEqual } from "node:util";

import { formatJson, listYmlComments, parsers, type CustomParser } from "@featurevisor/parsers";
import { isAlias, isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
import type { Document, Node, Pair, Scalar } from "yaml";

import { lineEndings, mergeLines, yamlOptions } from "../rewrite/lines";
import { isPlain, type Path, type Rename } from "./definitions";

/**
 * Writes a migrated value back to its file. The new text is rendered from the value, then only
 * its changes are merged into the file's own text, so every line migration did not touch stays
 * exactly as written.
 */

// YAML

function keyOf(pair: Pair): string | undefined {
  return isScalar(pair.key) ? String(pair.key.value) : undefined;
}

function commentsIn(node: unknown): string[] {
  const comments: string[] = [];
  const add = (comment?: string | null) => comment && comments.push(comment);
  if (!node || typeof node !== "object") return comments;
  visit(node as Node, {
    Node(_, child) {
      add(child.commentBefore);
      add(child.comment);
    },
  });
  return comments;
}

function addCommentBefore(node: Node | undefined, comments: string[]) {
  if (!node || comments.length === 0) return;
  node.commentBefore = [node.commentBefore, ...comments].filter(Boolean).join("\n");
}

/** A new node for a value, which keeps the comments and blank line of the one it replaces */
function replace(doc: Document, old: unknown, value: unknown): Node {
  const node = doc.createNode(value) as Node;
  if (old && typeof old === "object") {
    const previous = old as Node;
    node.spaceBefore = previous.spaceBefore;
    if (isScalar(previous)) {
      node.commentBefore = previous.commentBefore;
      node.comment = previous.comment;
    } else {
      addCommentBefore(node, commentsIn(previous));
    }
  }
  return node;
}

const samePath = (a: Path, b: Path) =>
  a.length === b.length && a.every((key, index) => key === b[index]);

/** Updates the node for `value` in place, keeping every node whose value is the same */
function sync(
  doc: Document,
  node: unknown,
  value: unknown,
  path: Path,
  renames: Rename[],
): unknown {
  if (isAlias(node)) {
    return isDeepStrictEqual(node.resolve(doc)?.toJS(doc), value)
      ? node
      : replace(doc, node, value);
  }

  if (isPlain(value)) {
    if (!isMap(node)) return replace(doc, node, value);
    const pairs = node.items as Pair[];
    const used = new Set<Pair>();
    const items: Pair[] = [];
    for (const [key, item] of Object.entries(value)) {
      let pair = pairs.find((candidate) => !used.has(candidate) && keyOf(candidate) === key);
      const rename = renames.find((entry) => samePath(entry.path, path) && entry.to === key);
      if (!pair && rename) {
        pair = rename.from
          .map((from) =>
            pairs.find((candidate) => !used.has(candidate) && keyOf(candidate) === from),
          )
          .find(Boolean);
        if (pair) (pair.key as Scalar).value = key;
      }
      if (pair) {
        used.add(pair);
        const previous = pair.value;
        pair.value = sync(doc, previous, item, [...path, key], renames);
        // a comment after a value that is now a block list or map stays on the key's line
        const next = pair.value as Node;
        if (isScalar(previous) && previous.comment && (isMap(next) || isSeq(next)) && !next.flow) {
          (pair.key as Scalar).comment = next.comment;
          next.comment = undefined;
        }
        items.push(pair);
      } else {
        const added = doc.createPair(key, item) as Pair;
        // a key added to a map whose keys are spaced is spaced too
        const spaced = pairs.slice(1).some((other) => (other.key as Node | null)?.spaceBefore);
        if (spaced && items.length > 0) (added.key as Node).spaceBefore = true;
        items.push(added);
      }
    }
    // the comments of keys merged away go to the key that took them in, or the first one
    for (const pair of pairs) {
      if (used.has(pair)) continue;
      const rename = renames.find(
        (entry) => samePath(entry.path, path) && entry.from.includes(keyOf(pair) ?? ""),
      );
      const target = items.find((item) => keyOf(item) === rename?.to) || items[0];
      addCommentBefore(target?.key as Node | undefined, commentsIn(pair));
    }
    node.items = items;
    return node;
  }

  if (Array.isArray(value)) {
    if (!isSeq(node)) return replace(doc, node, value);
    const items = node.items;
    node.items = value.map((item, index) =>
      index < items.length
        ? sync(doc, items[index], item, [...path, index], renames)
        : doc.createNode(item),
    );
    for (const dropped of items.slice(value.length)) {
      node.comment = [node.comment, ...commentsIn(dropped)].filter(Boolean).join("\n");
    }
    return node;
  }

  if (isScalar(node) && node.value === value) return node;
  return replace(doc, node, value);
}

function renderYaml(source: string, value: unknown, renames: Rename[]) {
  const options = yamlOptions(source);
  const doc = parseDocument(source);
  const base = doc.toString(options);
  doc.contents = sync(doc, doc.contents, value, [], renames) as typeof doc.contents;
  return { base, changed: doc.toString(options) };
}

// Any parser

export class WriteError extends Error {}

function sameComments(parser: CustomParser, before: string, after: string): boolean {
  const list = parser === parsers.yml ? listYmlComments : parser.listComments;
  if (!list) return true;
  return isDeepStrictEqual([...list(before)].sort(), [...list(after)].sort());
}

/**
 * The file's new text, with the file's own line endings and byte order mark. Throws a
 * WriteError when the text would not parse to the migrated value or would lose a comment, so
 * nothing is written that migration did not mean.
 */
export function writeDefinition(
  file: string,
  before: unknown,
  after: unknown,
  renames: Rename[],
  parser: CustomParser,
): string {
  // the merge works on lines ending in \n, as the renderers write them
  const { text: source, restore } = lineEndings(file);

  let rendered: { base: string; changed: string };
  if (parser === parsers.yml) {
    rendered = renderYaml(source, after, renames);
  } else if (parser === parsers.json) {
    rendered = { base: `${formatJson(before)}\n`, changed: `${formatJson(after)}\n` };
  } else {
    rendered = { base: parser.stringify(before), changed: parser.stringify(after) };
  }

  const candidates = [mergeLines(source, rendered.base, rendered.changed), rendered.changed];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    let parsed: unknown;
    try {
      parsed = parser.parse(candidate);
    } catch {
      continue;
    }
    // key order matters to mutation maps, so compare as JSON
    if (
      JSON.stringify(parsed) === JSON.stringify(after) &&
      sameComments(parser, source, candidate)
    ) {
      return restore(candidate);
    }
  }
  throw new WriteError(
    "The migrated file would not keep every comment, or would not read back as migrated.",
  );
}
