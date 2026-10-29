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

/** Prettier fills each line of a broken list of numbers, rather than one number a line */
function fillNumbers(list: number[], pad: string, lineWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  list.forEach((item, index) => {
    const text = plain(item) + (index < list.length - 1 ? "," : "");
    if (line && pad.length + line.length + 1 + text.length > lineWidth) {
      lines.push(line);
      line = text;
    } else {
      line = line ? `${line} ${text}` : text;
    }
  });
  lines.push(line);
  return lines.map((text) => pad + text);
}

/**
 * Writes JSON as Prettier does: every object with keys expanded, and a list on one line when it
 * fits. `lead` is the text before the value on its line, and `trail` the comma after it.
 */
function writeJson(
  value: unknown,
  indent: number,
  lineWidth: number,
  level = 0,
  lead = 0,
  trail = 0,
): string {
  if (isPlain(value)) return plain(value);

  const pad = " ".repeat(indent * (level + 1));
  const close = " ".repeat(indent * level);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (lineWidth > 0 && isFlat(value) && !mustBreak(value)) {
      const inline = flat(value);
      if (lead + inline.length + trail <= lineWidth) return inline;
    }
    if (lineWidth > 0 && value.length > 1 && value.every((item) => typeof item === "number")) {
      return `[\n${fillNumbers(value, pad, lineWidth).join("\n")}\n${close}]`;
    }
    const items = value.map(
      (item, index) =>
        pad +
        writeJson(item, indent, lineWidth, level + 1, pad.length, index < value.length - 1 ? 1 : 0),
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
      pad + name + writeJson(item, indent, lineWidth, level + 1, pad.length + name.length, comma)
    );
  });
  return `{\n${lines.join(",\n")}\n${close}}`;
}

/** Writes a JSON value as Prettier does, without a final newline. */
export function formatJson(value: unknown, indent = 2, options: JsonFormatOptions = {}): string {
  return writeJson(value, indent, options.lineWidth ?? 80);
}
