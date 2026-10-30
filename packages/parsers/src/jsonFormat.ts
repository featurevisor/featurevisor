import type { FormatLayout, FormatPath } from "./layout";

/** Choices only JSON can express. Featurevisor passes its own from Core's house style. */
export interface JsonFormatOptions {
  /**
   * Put a list on one line when it fits in this many columns, as Prettier does at its default
   * of 80, so the two agree on a project's files. 0 gives every item its own line.
   */
  lineWidth?: number;
}

function isPlain(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

function plain(value: unknown): string {
  // Prettier writes 1e+21 as 1e21
  if (typeof value === "number") return JSON.stringify(value).replace("e+", "e");
  return JSON.stringify(value) ?? "null";
}

/** Whether a value can go on one line: no object with keys in it, at any depth */
function isFlat(value: unknown): boolean {
  if (isPlain(value)) return true;
  if (Array.isArray(value)) return value.every(isFlat);
  return Object.keys(value as object).length === 0;
}

function flat(value: unknown): string {
  if (isPlain(value)) return plain(value);
  if (Array.isArray(value)) return `[${value.map(flat).join(", ")}]`;
  return "{}";
}

/** Prettier gives each item its own line in a list of two or more lists of two or more */
function mustBreak(list: unknown[]): boolean {
  return list.length > 1 && list.every((item) => Array.isArray(item) && item.length > 1);
}

/**
 * Prettier fills each line of a broken list of numbers, rather than one number a line, and
 * starts a new line after a blank one
 */
function fillNumbers(list: number[], pad: string, lineWidth: number, blank: boolean[]): string[] {
  const lines: string[] = [];
  let line = "";
  list.forEach((item, index) => {
    const text = plain(item) + (index < list.length - 1 ? "," : "");
    if (line && blank[index]) {
      lines.push(pad + line, "");
      line = text;
    } else if (line && pad.length + line.length + 1 + text.length > lineWidth) {
      lines.push(pad + line);
      line = text;
    } else {
      line = line ? `${line} ${text}` : text;
    }
  });
  lines.push(pad + line);
  return lines;
}

function endOfString(source: string, start: number): number {
  let index = start + 1;
  while (source[index] !== '"') index += source[index] === "\\" ? 2 : 1;
  return index;
}

/**
 * The paths of the members and items written after a blank line, other than the first of
 * their object or list, as JSON.stringify gives them. The source must be valid JSON.
 */
function findBlankLines(source: string): Set<string> {
  const found = new Set<string>();
  const open: { path: FormatPath; list: boolean; index: number; key?: string; inKey: boolean }[] =
    [];
  let newlines = 0;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const parent = open[open.length - 1];
    if (char === "\n") newlines++;
    if (/\s/.test(char)) continue;

    if (char === "," || char === ":" || char === "}" || char === "]") {
      if (char === "," && parent.list) parent.index++;
      if (char === "," && !parent.list) parent.inKey = true;
      if (char === "}" || char === "]") open.pop();
      newlines = 0;
      continue;
    }

    if (parent && !parent.list && parent.inKey) {
      const end = endOfString(source, index);
      parent.key = JSON.parse(source.slice(index, end + 1));
      if (newlines > 1 && parent.index > 0)
        found.add(JSON.stringify([...parent.path, parent.key!]));
      parent.index++;
      parent.inKey = false;
      index = end;
      newlines = 0;
      continue;
    }

    if (parent?.list && newlines > 1 && parent.index > 0) {
      found.add(JSON.stringify([...parent.path, parent.index]));
    }
    newlines = 0;

    const path = parent ? [...parent.path, parent.list ? parent.index : parent.key!] : [];
    if (char === "{" || char === "[") {
      open.push({ path, list: char === "[", index: 0, inKey: char === "{" });
    } else if (char === '"') {
      index = endOfString(source, index);
    } else {
      while (index + 1 < source.length && !/[\s,\]}]/.test(source[index + 1])) index++;
    }
  }

  return found;
}

/** The parts of a layout JSON applies besides the indent. All are optional. */
export type JsonLayout = Partial<Pick<FormatLayout, "spaceEntries" | "spaceItems">> & {
  /** The JSON the value was parsed from, to keep the blank lines written in it */
  source?: string;
};

interface Writer {
  indent: number;
  lineWidth: number;
  layout: JsonLayout;
  /** Where the author wrote a blank line, from findBlankLines */
  blank: Set<string>;
}

/**
 * Writes JSON as Prettier does: every object with keys expanded, and a list on one line when it
 * fits. `lead` is the text before the value on its line, and `trail` the comma after it.
 */
function writeJson(
  value: unknown,
  writer: Writer,
  path: FormatPath = [],
  lead = 0,
  trail = 0,
): string {
  if (isPlain(value)) return plain(value);

  const { indent, lineWidth } = writer;
  const pad = " ".repeat(indent * (path.length + 1));
  const close = " ".repeat(indent * path.length);
  const spaced = Array.isArray(value)
    ? writer.layout.spaceItems?.(path)
    : writer.layout.spaceEntries?.(path);
  const blankBefore = (key: string | number, index: number) =>
    index > 0 && (spaced === true || writer.blank.has(JSON.stringify([...path, key])));

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const blank = value.map((_, index) => blankBefore(index, index));
    const numbers = value.length > 1 && value.every((item) => typeof item === "number");
    // Prettier keeps a blank line between numbers, which breaks the list, and drops one
    // between other items when the list fits on a line
    if (lineWidth > 0 && isFlat(value) && !mustBreak(value) && !(numbers && blank.includes(true))) {
      const inline = flat(value);
      if (lead + inline.length + trail <= lineWidth) return inline;
    }
    if (lineWidth > 0 && numbers) {
      return `[\n${fillNumbers(value, pad, lineWidth, blank).join("\n")}\n${close}]`;
    }
    const items = value.map(
      (item, index) =>
        (blank[index] ? "\n" : "") +
        pad +
        writeJson(item, writer, [...path, index], pad.length, index < value.length - 1 ? 1 : 0),
    );
    return `[\n${items.join(",\n")}\n${close}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, item]) => item !== undefined,
  );
  if (entries.length === 0) return "{}";
  const lines = entries.map(([key, item], index) => {
    const name = `${JSON.stringify(key)}: `;
    const comma = index < entries.length - 1 ? 1 : 0;
    return (
      (blankBefore(key, index) ? "\n" : "") +
      pad +
      name +
      writeJson(item, writer, [...path, key], pad.length + name.length, comma)
    );
  });
  return `{\n${lines.join(",\n")}\n${close}}`;
}

/**
 * Writes a JSON value as Prettier does, without a final newline, with blank lines between the
 * members and items the layout names. Given the source the value was parsed from, it keeps the
 * blank lines written there too, as Prettier does. A list on one line has none.
 */
export function formatJson(
  value: unknown,
  indent = 2,
  options: JsonFormatOptions = {},
  layout: JsonLayout = {},
): string {
  const blank = layout.source === undefined ? new Set<string>() : findBlankLines(layout.source);
  return writeJson(value, { indent, lineWidth: options.lineWidth ?? 80, layout, blank });
}
