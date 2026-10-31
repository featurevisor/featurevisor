/**
 * Edits featurevisor.config.js as text: removes top level settings of `module.exports` and adds
 * new ones after its opening brace. Everything else in the file stays as written. A setting
 * it cannot find, such as one spread in from another object, stays, and the result says which
 * ones it removed.
 */

export interface ConfigEdit {
  remove: string[];
  /** Settings to add, by name. A list of values is an array written one value per line. */
  add: [string, string | string[]][];
}

/** The index just past a value starting at `start`, at the next top level `,` or `}` */
function endOfValue(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      for (index++; index < source.length && source[index] !== char; index++) {
        if (source[index] === "\\") index++;
      }
    } else if (char === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index);
      if (index === -1) return source.length;
    } else if (char === "/" && source[index + 1] === "*") {
      index = source.indexOf("*/", index) + 1;
    } else if ("([{".includes(char)) {
      depth++;
    } else if (")]}".includes(char)) {
      if (depth === 0) return index;
      depth--;
    } else if (char === "," && depth === 0) {
      return index;
    }
  }
  return source.length;
}

/** Where the object `module.exports` is set to opens, or -1 */
function exportsStart(source: string): number {
  const match = /module\.exports\s*=\s*\{/.exec(source);
  return match ? match.index + match[0].length - 1 : -1;
}

/** Where the object opening at `open` closes, past every property's value */
function endOfObject(source: string, open: number): number {
  let index = endOfValue(source, open + 1);
  while (source[index] === ",") index = endOfValue(source, index + 1);
  return index;
}

/** The start and end of the top level property `name` of the exported object */
function findProperty(source: string, name: string): [number, number] | undefined {
  const open = exportsStart(source);
  if (open === -1) return undefined;
  const close = endOfObject(source, open);
  const pattern = new RegExp(`(^|[{,\\s])(["']?)${name}\\2\\s*:`, "g");
  pattern.lastIndex = open + 1;
  for (
    let match = pattern.exec(source);
    match && match.index < close;
    match = pattern.exec(source)
  ) {
    const keyStart = match.index + match[1].length;
    // not in a comment, and not a property of an object nested in the exported one
    const lineStart = source.lastIndexOf("\n", keyStart - 1) + 1;
    if (source.slice(lineStart, keyStart).includes("//")) continue;
    if (depthOf(source.slice(open + 1, keyStart)) !== 0) continue;
    return [keyStart, endOfValue(source, match.index + match[0].length)];
  }
  return undefined;
}

/** How deep a position is in brackets, ignoring strings and comments */
function depthOf(text: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      for (index++; index < text.length && text[index] !== char; index++) {
        if (text[index] === "\\") index++;
      }
    } else if (char === "/" && text[index + 1] === "/") {
      const next = text.indexOf("\n", index);
      index = next === -1 ? text.length : next;
    } else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
  }
  return depth;
}

/** The edited text, and the settings it removed. Undefined when it exports no object to edit. */
export function editConfig(
  source: string,
  edit: ConfigEdit,
): { text: string; removed: string[] } | undefined {
  if (exportsStart(source) === -1) return undefined;
  let result = source;
  const removed: string[] = [];
  for (const name of edit.remove) {
    const found = findProperty(result, name);
    if (!found) continue;
    removed.push(name);
    let [start, end] = found;
    // the comma after the value, and the whole line when the setting has it to itself
    if (result[end] === ",") end++;
    const lineStart = result.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = result.indexOf("\n", end);
    if (
      !result.slice(lineStart, start).trim() &&
      !result.slice(end, lineEnd === -1 ? undefined : lineEnd).trim()
    ) {
      start = lineStart;
      end = lineEnd === -1 ? result.length : lineEnd + 1;
    }
    result = result.slice(0, start) + result.slice(end);
  }

  if (edit.add.length > 0) {
    const open = exportsStart(result);
    const indent = /\n([ \t]+)\S/.exec(result.slice(open))?.[1] || "  ";
    const written = (value: string | string[]) =>
      typeof value === "string"
        ? value
        : `[${value.map((item) => `\n${indent}${indent}${item},`).join("")}\n${indent}]`;
    const lines = edit.add
      .map(([name, value]) => `\n${indent}${name}: ${written(value)},`)
      .join("");
    result = result.slice(0, open + 1) + lines + result.slice(open + 1);
  }
  return { text: result, removed };
}

/** A JavaScript string literal in the quotes the configuration already uses */
export function quote(source: string, value: string): string {
  const singles = (source.match(/'/g) || []).length;
  const doubles = (source.match(/"/g) || []).length;
  const mark = singles > doubles ? "'" : '"';
  return `${mark}${value.replace(/\\/g, "\\\\").replace(new RegExp(mark, "g"), `\\${mark}`)}${mark}`;
}
