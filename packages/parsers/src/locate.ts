import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { Document, Node } from "yaml";

export interface SourcePosition {
  /** One based. */
  line: number;
  /** One based. */
  column: number;
}

export interface LocatedString {
  /** Where an offset inside the parsed string sits in the file. */
  positionAt(offset: number): SourcePosition;
  /** A line of the file, for showing it with a caret. */
  lineText(line: number): string;
}

function resolve(document: Document, node: unknown): unknown {
  let current = node;
  for (let hops = 0; isAlias(current) && hops < 100; hops++) {
    current = current.resolve(document);
  }
  return current;
}

function findNode(document: Document, path: (string | number)[]): unknown {
  let node: unknown = document.contents;
  for (const segment of path) {
    node = resolve(document, node);
    if (isMap(node)) {
      const pair = node.items.find(
        (item) => isScalar(item.key) && String(item.key.value) === String(segment),
      );
      if (!pair) return undefined;
      node = pair.value;
    } else if (isSeq(node) && typeof segment === "number") {
      node = node.items[segment];
    } else {
      return undefined;
    }
  }
  return resolve(document, node);
}

function createLineIndex(content: string) {
  const lineStarts = [0];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") lineStarts.push(index + 1);
  }
  const positionOf = (offset: number): SourcePosition => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - lineStarts[low] + 1 };
  };
  const lineText = (line: number) => {
    const start = lineStarts[line - 1];
    if (start === undefined) return "";
    const end = lineStarts[line] === undefined ? content.length : lineStarts[line] - 1;
    return content.slice(start, end).replace(/\r$/, "");
  };
  return { positionOf, lineText };
}

/**
 * Finds a string value in a YAML file by its path, following anchors and aliases to where the
 * value is written, and maps offsets inside the parsed string back to file positions. Folded,
 * quoted and block scalars are aligned character by character, so positions stay exact for
 * plain and block literal values, and close for values with escapes.
 */
export function locateYamlString(
  content: string,
  path: (string | number)[],
): LocatedString | undefined {
  let document: Document;
  try {
    document = parseDocument(content, { keepSourceTokens: false });
  } catch {
    return undefined;
  }
  const node = findNode(document, path) as Node | undefined;
  if (!isScalar(node) || typeof node.value !== "string" || !node.range) return undefined;

  const value = node.value;
  const [start, valueEnd] = node.range;
  let raw = content.slice(start, valueEnd);
  let rawStart = start;
  if (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED") {
    // Skip the header line holding `|` or `>`.
    const headerEnd = raw.indexOf("\n");
    rawStart = headerEnd === -1 ? valueEnd : start + headerEnd + 1;
    raw = content.slice(rawStart, valueEnd);
  } else if (node.type === "QUOTE_SINGLE" || node.type === "QUOTE_DOUBLE") {
    rawStart = start + 1;
    raw = content.slice(rawStart, Math.max(rawStart, valueEnd - 1));
  }

  // Align each character of the parsed value with the next matching source character.
  const offsets: number[] = [];
  let cursor = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    while (
      cursor < raw.length &&
      raw[cursor] !== character &&
      !((character === " " || character === "\n") && raw[cursor] === "\n")
    ) {
      cursor++;
    }
    offsets.push(rawStart + Math.min(cursor, raw.length));
    if (cursor < raw.length) cursor++;
  }
  offsets.push(rawStart + Math.min(cursor, raw.length));

  const { positionOf, lineText } = createLineIndex(content);
  return {
    positionAt: (offset: number) =>
      positionOf(offsets[Math.max(0, Math.min(offset, offsets.length - 1))]),
    lineText,
  };
}
