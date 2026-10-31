/**
 * Merges a rendered change into a file's own lines, so every line the change does not touch
 * stays exactly as written. Shared by the commands that rewrite definitions, migrate and
 * convert, which load it only when they run.
 */

/** For each line of `a`, its line in `b` when both are on the longest common subsequence */
function align(a: string[], b: string[]): number[] {
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const matched = new Array<number>(a.length).fill(-1);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) matched[i++] = j++;
    else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) i++;
    else j++;
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

/** The text with \n line endings and no byte order mark, and how to give a text the file's own */
export function lineEndings(file: string): { text: string; restore: (text: string) => string } {
  const bom = file.startsWith("\uFEFF") ? "\uFEFF" : "";
  const crlf = file.match(/\r?\n/)?.[0] === "\r\n";
  return {
    text: file.slice(bom.length).replace(/\r\n/g, "\n"),
    restore: (text) => bom + (crlf ? text.replace(/\n/g, "\r\n") : text),
  };
}
