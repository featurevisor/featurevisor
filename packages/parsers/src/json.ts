import type { CustomParser } from "./index";

// the line width Prettier writes JSON to, so the two agree on a project's files
const LINE_WIDTH = 80;

function isPlain(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

function plain(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

/**
 * Writes JSON with every object expanded, and a list of plain values on one line when it
 * fits, as Prettier does. `lead` is the text before the value on its line, and `trail` the
 * comma after it.
 */
function writeJson(value: unknown, indent: number, level = 0, lead = 0, trail = 0): string {
  if (isPlain(value)) return plain(value);

  const pad = " ".repeat(indent * (level + 1));
  const close = " ".repeat(indent * level);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isPlain)) {
      const inline = `[${value.map(plain).join(", ")}]`;
      if (lead + inline.length + trail <= LINE_WIDTH) return inline;
    }
    const items = value.map(
      (item, index) =>
        pad + writeJson(item, indent, level + 1, pad.length, index < value.length - 1 ? 1 : 0),
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
    return pad + name + writeJson(item, indent, level + 1, pad.length + name.length, comma);
  });
  return `{\n${lines.join(",\n")}\n${close}}`;
}

export const jsonParser: CustomParser = {
  extension: "json",
  parse: function <T>(content: string): T {
    return JSON.parse(content) as T;
  },
  stringify: function (content: any) {
    return JSON.stringify(content, null, 2);
  },
  // JSON has no comments or blank lines, so the key order and indentation apply, and short
  // lists stay on one line as Prettier writes them
  format: function (source, layout) {
    return writeJson(layout.orderValue(JSON.parse(source)), layout.indent);
  },
};
