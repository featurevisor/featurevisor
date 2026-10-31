import { isMap, isNode, isPair, isScalar, isSeq, parse, parseDocument, Scalar, visit } from "yaml";
import type { Document, Node, Pair, YAMLMap, YAMLSeq } from "yaml";

import { IGNORE_LINE_COMMENT, type FormatLayout, type FormatPath } from "./layout";

/** Choices only YAML can express. Featurevisor passes its own from Core's house style. */
export interface YmlFormatOptions {
  /** The quote a value gets when it needs one. The other is used when it saves escapes. */
  quote?: "double" | "single";
  /** Quote text YAML 1.1 tools read as another type, such as `no` or `2026-10-28` */
  quoteYaml11Types?: boolean;
  /** Fold text longer than this many columns. 0 never folds. */
  lineWidth?: number;
  /** Indent list items under their key */
  indentSequences?: boolean;
  /** Write each alias out in full and drop the anchors, so a value reads where it is used */
  expandAliases?: boolean;
}

const DEFAULT_OPTIONS: Required<YmlFormatOptions> = {
  quote: "double",
  quoteYaml11Types: true,
  lineWidth: 0,
  indentSequences: true,
  expandAliases: true,
};

/** The parts of a layout YAML applies. All are optional: without them, YAML keeps the
 * authored key order, writes no blank lines, indents by two and uses its default options. */
export type YmlLayout = Partial<
  Pick<FormatLayout, "indent" | "orderKeys" | "spaceEntries" | "spaceItems" | "keepBlankLines">
> & { options?: YmlFormatOptions };

/** A comment above a key belongs to it. Text above a blank line is the file's own header. */
function splitHeader(comment: string): { header?: string; own?: string } {
  const index = comment.lastIndexOf("\n\n");
  if (index === -1) return { own: comment };
  return { header: comment.slice(0, index), own: comment.slice(index + 2) || undefined };
}

/**
 * Text YAML 1.1 can only read as text: a word, or words joined by single spaces, of letters,
 * digits, `_`, `.`, `/` and `-`, starting with a letter or `_`. Of these, YAML 1.1 reads only
 * its booleans, null, and an exponent without digits before it, such as `e10`, as another type.
 */
const PLAIN_TEXT = /^[A-Za-z_][\w./-]*(?: [\w./-]+)*$/;
const YAML_11_WORDS = /^(?:y|yes|n|no|true|false|on|off|null|e[-+]?\d+)$/i;

/** Answers for text already checked, which repeats across a project's files */
const readsAsAnotherTypeCache = new Map<string, boolean>();

/**
 * A string YAML 1.2 reads back as itself can still be read as something else by YAML 1.1
 * tools: `no` as false, `2026-10-28` as a date.
 */
function readsAsAnotherType(value: string): boolean {
  if (PLAIN_TEXT.test(value) && !YAML_11_WORDS.test(value)) return false;
  let answer = readsAsAnotherTypeCache.get(value);
  if (answer === undefined) {
    try {
      answer = parse(value, { version: "1.1" }) !== value;
    } catch {
      answer = true;
    }
    if (readsAsAnotherTypeCache.size >= 10000) readsAsAnotherTypeCache.clear();
    readsAsAnotherTypeCache.set(value, answer);
  }
  return answer;
}

function formatScalar(node: Scalar, options: Required<YmlFormatOptions>) {
  if (typeof node.value !== "string") return;
  if (node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED) return;
  if (options.quoteYaml11Types && readsAsAnotherType(node.value)) {
    // the preferred quote, unless the text holds it and not the other
    const holds = (quote: string) => (node.value as string).includes(quote);
    const single =
      options.quote === "single" ? !(holds("'") && !holds('"')) : holds('"') && !holds("'");
    node.type = single ? Scalar.QUOTE_SINGLE : Scalar.QUOTE_DOUBLE;
  } else {
    // plain where YAML allows it, quoted as toString's singleQuote picks where it does not
    delete node.type;
  }
}

function keyOf(pair: Pair): string | undefined {
  const key = pair.key as unknown;
  if (isScalar(key)) return String(key.value);
  if (typeof key === "string" || typeof key === "number") return String(key);
  return undefined;
}

/** Orders a map's entries. An entry marked to be kept as written stays where it is. */
function reorder(map: YAMLMap, order: string[], kept: Set<Pair>) {
  const rank = new Map(order.map((key, index) => [key, index]));
  const pairs = map.items as Pair[];
  const sorted = pairs
    .map((pair, index) => ({ pair, index }))
    .filter(({ pair }) => !kept.has(pair))
    .sort((a, b) => {
      const ra = rank.get(keyOf(a.pair) ?? "") ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(keyOf(b.pair) ?? "") ?? Number.MAX_SAFE_INTEGER;
      return ra === rb ? a.index - b.index : ra - rb;
    })
    .map(({ pair }) => pair);
  map.items = pairs.map((pair) => (kept.has(pair) ? pair : sorted.shift()!));
}

/**
 * A comment after a key whose value is a block list or map is stored above the value. Move it
 * back onto the key, so it stays on the key's line rather than moving below it.
 */
function keepKeyLineComment(pair: Pair, source: string) {
  const { key, value } = pair;
  if (!isScalar(key) || !key.range || !(isMap(value) || isSeq(value))) return;
  if (value.flow || !value.commentBefore) return;

  const end = source.indexOf("\n", key.range[1]);
  if (!/^[ \t]*:[ \t]+#/.test(source.slice(key.range[1], end === -1 ? undefined : end))) return;

  const [first, ...rest] = value.commentBefore.split("\n");
  key.comment = key.comment ? `${first}\n${key.comment}` : first;
  value.commentBefore = rest.length > 0 ? rest.join("\n") : undefined;
}

/** A scalar, or a list or map written inline, which a single line can hold */
function isInline(node: unknown): node is Scalar | YAMLMap | YAMLSeq {
  return isScalar(node) || ((isMap(node) || isSeq(node)) && node.flow === true);
}

function isIgnoreComment(comment: string | null | undefined): boolean {
  return comment?.split("\n")[0].trim() === IGNORE_LINE_COMMENT;
}

/** An entry whose line ends with the ignore comment */
function isIgnoredPair(pair: Pair): boolean {
  if (!isScalar(pair.key)) return false;
  if (isIgnoreComment(pair.key.comment)) return true;
  return isInline(pair.value) && isIgnoreComment(pair.value.comment);
}

/**
 * Writes every alias out in full and drops every anchor, so a file reads without indirection.
 * A copy leaves the comments of the node it copies where they were, and takes the alias's own.
 * Returns the nodes that held an anchor and the copies, which a line kept as written must not
 * keep, since its text would bring the anchor or alias back.
 */
function expandAliases(doc: Document.Parsed): Set<Node> {
  const changed = new Set<Node>();
  visit(doc, {
    Alias(_, alias, path) {
      const target = alias.resolve(doc);
      if (!target) {
        throw new ReferenceError(
          `Unresolved alias (the anchor must be set before the alias): ${alias.source}`,
        );
      }
      const copy = target.clone() as Node;
      visit(copy, {
        Node(_, node) {
          node.commentBefore = undefined;
          node.comment = undefined;
        },
      });
      copy.spaceBefore = alias.spaceBefore;
      copy.commentBefore = alias.commentBefore;
      const parent = path[path.length - 1];
      if (alias.comment && (isMap(copy) || isSeq(copy)) && isPair(parent) && isScalar(parent.key)) {
        // written as a block, the copy leaves the key's line, and the comment stays with the key
        parent.key.comment = alias.comment;
      } else {
        copy.comment = alias.comment;
      }
      changed.add(copy);
      return copy;
    },
  });
  visit(doc, {
    Node(_, node) {
      if (node.anchor) {
        changed.add(node);
        node.anchor = undefined;
      }
    },
  });
  return changed;
}

/** Whether `node` or anything in it is one of `changed`, or holds an anchor */
function touches(node: Node, changed: Set<Node>): boolean {
  let found = false;
  visit(node, {
    Node(_, child) {
      if (changed.has(child) || child.anchor) found = true;
    },
  });
  return found;
}

/** A plain scalar standing in for a node, with the node's comments and blank line */
function standIn(node: Node, text: string): Scalar {
  const scalar = new Scalar(text);
  scalar.spaceBefore = node.spaceBefore;
  scalar.commentBefore = node.commentBefore;
  scalar.comment = node.comment;
  return scalar;
}

/**
 * A comment after a value can carry the blank lines that follow it. The layout decides those,
 * so they are dropped here, or each pass would add the layout's blank line to them.
 */
function trimTrailingComment(node: { comment?: string | null }) {
  if (node.comment) node.comment = node.comment.replace(/\n+$/, "");
}

interface Context {
  layout: YmlLayout;
  options: Required<YmlFormatOptions>;
  source: string;
  /** A prefix the source never holds, for the placeholders of text kept as written */
  prefix: string;
  /** Text kept as written, which YAML writes as a placeholder until it is replaced */
  kept: { placeholder: string; text: string }[];
  /** Nodes that held an anchor, and the copies that replaced aliases */
  changed: Set<Node>;
}

/**
 * The source of a line marked with the ignore comment, from `start` to the end of `node`, or
 * undefined when it cannot be kept: text over several lines, or with an anchor or an alias,
 * which is laid out as usual.
 */
function writtenText(context: Context, start: number, node: Node): string | undefined {
  if (touches(node, context.changed)) return undefined;
  const text = context.source.slice(start, node.range![1]).trimEnd();
  return text.includes("\n") ? undefined : text;
}

/** Keeps an entry marked with the ignore comment in its place, and as written where it can */
function keepPair(pair: Pair, path: FormatPath, context: Context) {
  const key = pair.key as Scalar;
  const value = pair.value;
  const text = isInline(value) ? writtenText(context, key.range![0], value) : undefined;
  if (text === undefined) {
    // a list or map below the key's line is laid out, as is a value that cannot be kept
    if ((isMap(value) || isSeq(value)) && isIgnoreComment(value.comment)) {
      // written as a block, the value leaves the line, and the comment stays with the key
      key.comment = value.comment;
      value.comment = undefined;
    }
    walk(value, [...path, keyOf(pair)!], false, context);
    return;
  }

  const id = `${context.prefix}${context.kept.length}`;
  pair.key = standIn(key, `${id}k`);
  pair.value = standIn(value as Node, `${id}v`);
  context.kept.push({ placeholder: `${id}k: ${id}v`, text });
}

function walk(node: unknown, path: FormatPath, inSequence: boolean, context: Context) {
  const { layout, options } = context;
  if (node && typeof node === "object") trimTrailingComment(node as { comment?: string | null });

  if (isScalar(node)) {
    formatScalar(node, options);
    node.spaceBefore = false;
    return;
  }

  const keep = layout.keepBlankLines === true;

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

    const pairs = map.items as Pair[];
    pairs.forEach((pair) => keepKeyLineComment(pair, context.source));
    const ignored = new Set(pairs.filter(isIgnoredPair));
    // a blank line written above an entry moves with it
    const blank = new Set(
      pairs.filter((pair, index) => index > 0 && isScalar(pair.key) && pair.key.spaceBefore),
    );

    const order = layout.orderKeys?.(
      path,
      pairs.map((pair) => keyOf(pair) ?? ""),
    );
    if (order) reorder(map, order, ignored);

    const spaced = layout.spaceEntries?.(path) === true;
    (map.items as Pair[]).forEach((pair, index) => {
      if (isScalar(pair.key)) {
        if (!ignored.has(pair)) formatScalar(pair.key, options);
        pair.key.spaceBefore = index > 0 && (spaced || (keep && blank.has(pair)));
      }
      const key = keyOf(pair);
      if (ignored.has(pair)) {
        keepPair(pair, path, context);
      } else {
        walk(pair.value, key === undefined ? path : [...path, key], false, context);
      }
    });
    return;
  }

  if (isSeq(node)) {
    const seq = node as YAMLSeq;
    seq.flow = seq.items.length === 0;
    seq.spaceBefore = false;
    const spaced = layout.spaceItems?.(path) === true;
    const blank = new Set(
      seq.items.filter((item, index) => index > 0 && isNode(item) && item.spaceBefore),
    );

    seq.items.forEach((item, index) => {
      const ignored = isInline(item) && isIgnoreComment(item.comment);
      const text = ignored ? writtenText(context, item.range![0], item) : undefined;
      if (text === undefined) walk(item, [...path, index], true, context);
      if (!isNode(item) || isPair(item)) return;

      item.spaceBefore = index > 0 && (spaced || (keep && blank.has(item)));
      if (text !== undefined) {
        const placeholder = `${context.prefix}${context.kept.length}z`;
        seq.items[index] = standIn(item, placeholder);
        context.kept.push({ placeholder, text });
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

function layOut(source: string, layout: YmlLayout, options: Required<YmlFormatOptions>): string {
  const doc = parseDocument(source) as Document.Parsed;
  // a YAMLParseError, with the position in its linePos
  if (doc.errors.length > 0) throw doc.errors[0];

  const root = doc.contents;
  if (root === null || root === undefined) return source;
  const changed = options.expandAliases ? expandAliases(doc) : new Set<Node>();

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

  let prefix = "verbatim";
  while (source.includes(prefix)) prefix += "x";
  const context: Context = { layout, options, source, prefix, kept: [], changed };
  walk(doc.contents as Node, [], false, context);

  // one document a file, so neither --- nor ... marks where it starts or ends
  if (doc.directives) {
    doc.directives.docStart = null;
    doc.directives.docEnd = false;
  }

  const output = doc.toString({
    indent: layout.indent ?? 2,
    indentSeq: options.indentSequences,
    lineWidth: options.lineWidth,
    minContentWidth: options.lineWidth === 0 ? 0 : undefined,
    // null prefers double quotes and true single, each falling back to the other to save escapes
    singleQuote: options.quote === "single" ? true : null,
  });
  return context.kept.reduce(
    (text, { placeholder, text: written }) => text.split(placeholder).join(written),
    output,
  );
}

/**
 * Formats a YAML document with a layout: its indentation, key order, and blank lines between
 * the entries of the maps and the items of the lists it names, and the YAML options in it.
 * Lists and maps are always written in block style, quotes only where a value needs them, and
 * comments stay with the key or item below them. Aliases are written out in full, and anchors
 * dropped, unless `expandAliases` is false. A line ending in the comment
 * `# featurevisor-ignore-line` keeps its key and value as written, and its place.
 *
 * Throws the YAML parse error, with its linePos, when the source is not a single valid YAML
 * document.
 */
export function formatYml(source: string, layout: YmlLayout = {}): string {
  const options = { ...DEFAULT_OPTIONS, ...layout.options };
  try {
    return layOut(source, layout, options);
  } catch (error) {
    // Aliases kept as written can end up above their anchor in key order, which YAML cannot
    // write. Such a file keeps the order it was written in, and the rest of the layout applies.
    if (!options.expandAliases && layout.orderKeys && /Unresolved alias/.test(String(error))) {
      return layOut(source, { ...layout, orderKeys: undefined }, options);
    }
    throw error;
  }
}
