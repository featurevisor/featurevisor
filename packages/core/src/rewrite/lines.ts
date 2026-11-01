import { formatJson, parsers, type CustomParser } from "@featurevisor/parsers";

/**
 * Text tools for the commands that rewrite definition files, fmt, migrate, convert and promote,
 * which load them only when they write. A rewrite merges its change into a file's own lines, so
 * every line the change does not touch stays exactly as written.
 */

/** For each line of `a`, its line in `b` when both are on the longest common subsequence */
export function align(a: string[], b: string[]): number[] {
  const matched = new Array<number>(a.length).fill(-1);

  // the lines both texts start and end with are on it, so only the lines between need the table
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    matched[start] = start;
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const rows = endA - start;
  const columns = endB - start;
  const width = columns + 1;
  const lengths = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[start + i] === b[start + j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (a[start + i] === b[start + j]) matched[start + i++] = start + j++;
    else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) i++;
    else j++;
  }

  // the side with lines left matches each line it can as early as it can, as a table of every
  // line would, which still matches all the lines both end with
  const skipA = i < rows;
  for (let x = start + i, y = start + j; x < a.length && y < b.length; ) {
    if (a[x] === b[y]) matched[x++] = y++;
    else if (skipA) x++;
    else y++;
  }
  return matched;
}

/**
 * Applies the changes from `base` to `changed` onto `source`, where `base` is `source` as the
 * writer renders it. Undefined when a change touches a line the two render differently.
 */
export function mergeLines(source: string, base: string, changed: string): string | undefined {
  const s = source.split("\n");
  const b = base.split("\n");
  const c = changed.split("\n");
  const inSource = align(b, s);
  const inChanged = align(b, c);

  const result: string[] = [];
  let sourceAt = 0;
  let changedAt = 0;
  for (let i = 0; i <= b.length; ) {
    if (i < b.length && inChanged[i] !== -1 && inChanged[i] === changedAt) {
      i++;
      changedAt++;
      continue;
    }
    // a run of base lines replaced by changed lines, up to the next line both keep
    let end = i;
    while (end < b.length && inChanged[end] === -1) end++;
    const until = end < b.length ? inChanged[end] : c.length;
    if (end === i && until === changedAt) break;

    let from: number;
    let to: number;
    if (end > i) {
      for (let k = i; k < end; k++) {
        if (inSource[k] === -1 || (k > i && inSource[k] !== inSource[k - 1] + 1)) return undefined;
      }
      from = inSource[i];
      to = inSource[end - 1] + 1;
    } else if (i > 0) {
      if (inSource[i - 1] === -1) return undefined;
      from = to = inSource[i - 1] + 1;
    } else {
      from = to = 0;
    }
    if (from < sourceAt) return undefined;
    result.push(...s.slice(sourceAt, from), ...c.slice(changedAt, until));
    sourceAt = to;
    changedAt = until;
    i = end;
  }
  result.push(...s.slice(sourceAt));
  return result.join("\n");
}

/** The indentation and list style the file is written in */
export function yamlOptions(source: string) {
  const lines = source.split("\n");
  let indent = 2;
  let indentSeq = true;
  for (let i = 1; i < lines.length; i++) {
    const nested = /^( +)[^\s#-]/.exec(lines[i]);
    if (nested && /^[^\s#][^#]*:\s*(#.*)?$/.test(lines[i - 1])) {
      indent = nested[1].length;
      break;
    }
  }
  for (let i = 1; i < lines.length; i++) {
    if (
      /^\s*- /.test(lines[i]) &&
      /:\s*(#.*)?$/.test(lines[i - 1]) &&
      !/^\s*-/.test(lines[i - 1])
    ) {
      indentSeq = lines[i].search(/\S/) > lines[i - 1].search(/\S/);
      break;
    }
  }
  return { indent, indentSeq, lineWidth: 0, minContentWidth: 0, flowCollectionPadding: false };
}

/** Which line endings a rewritten text gets: the file's own, judged by its first line break, or one */
export type EndOfLine = "auto" | "lf" | "crlf";

/**
 * The text with \n line endings and no byte order mark, and how to give a text the file's byte
 * order mark and the line endings `endOfLine` asks for
 */
export function lineEndings(
  file: string,
  endOfLine: EndOfLine = "auto",
): { text: string; restore: (text: string) => string } {
  const bom = file.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = file.slice(bom.length);
  const crlf = endOfLine === "auto" ? text.match(/\r?\n/)?.[0] === "\r\n" : endOfLine === "crlf";
  return {
    text: text.replace(/\r\n/g, "\n"),
    restore: (output) => bom + (crlf ? output.replace(/\n/g, "\r\n") : output),
  };
}

/** The parsers @featurevisor/parsers ships, which read and lay out YAML and JSON */
export const BUILT_IN_PARSERS: ReadonlySet<CustomParser> = new Set(Object.values(parsers));

/** Equal as JSON, with keys in the same order, whatever objects a parser makes */
export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether two texts have the same comments, when the parser can list them */
export function sameComments(
  parser: CustomParser,
  before: string,
  after: string,
  moved: string[] = [],
): boolean {
  if (typeof parser.listComments !== "function") return true;
  const a = [...parser.listComments(before)].sort();
  // comment lines moved into values, such as into conditions joined as one expression
  const b = [...parser.listComments(after), ...moved].sort();
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/** A file rendered twice by its writer: as it is, and with a change */
export interface Rendering {
  base: string;
  changed: string;
}

/** Two values as the parser writes them: JSON as fmt lays it out, and others through stringify */
export function renderValues(parser: CustomParser, before: unknown, after: unknown): Rendering {
  const write = (value: unknown) =>
    parser === parsers.json ? `${formatJson(value)}\n` : parser.stringify(value);
  return { base: write(before), changed: write(after) };
}

/**
 * A file's new text, with its own line endings, byte order mark and final newline: the change
 * merged into its own lines, or the whole rendering when the merge cannot place it. Either must
 * parse back to `value`, as JSON since key order matters, and with `keepComments`, keep the
 * file's comments. `merged` says which one it is. Undefined when neither passes.
 */
export function rewriteFile(
  file: string,
  parser: CustomParser,
  value: unknown,
  render: (text: string) => Rendering,
  { keepComments = false } = {},
): { text: string; merged: boolean } | undefined {
  const { text, restore } = lineEndings(file);
  const { base, changed } = render(text);
  const accepts = (candidate: string) => {
    try {
      if (!same(parser.parse(candidate), value)) return false;
    } catch {
      return false;
    }
    return !keepComments || sameComments(parser, text, candidate);
  };

  // a rendering may end without the newline the file ends with, as JSON's stringify does
  const finish = (candidate: string) =>
    restore(text.endsWith("\n") && !candidate.endsWith("\n") ? `${candidate}\n` : candidate);

  const merged = mergeLines(text, base, changed);
  if (merged !== undefined && accepts(merged)) return { text: finish(merged), merged: true };
  if (accepts(changed)) return { text: finish(changed), merged: false };
  return undefined;
}
