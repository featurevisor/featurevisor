import { align } from "./lines";

type Edit = { kind: " " | "-" | "+"; line: string };

/**
 * Line edits along the longest common subsequence. Between two kept lines, the removed lines
 * come before the added ones, as `diff -u` prints them.
 */
function lineEdits(before: string[], after: string[]): Edit[] {
  const matched = align(before, after);
  const edits: Edit[] = [];
  let j = 0;
  before.forEach((line, i) => {
    if (matched[i] === -1) {
      edits.push({ kind: "-", line });
      return;
    }
    while (j < matched[i]) edits.push({ kind: "+", line: after[j++] });
    edits.push({ kind: " ", line });
    j++;
  });
  while (j < after.length) edits.push({ kind: "+", line: after[j++] });
  return edits;
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** A unified diff of two texts, as `diff -u` prints it, with three lines of context. */
export function unifiedDiff(fromName: string, toName: string, before: string, after: string) {
  const edits = lineEdits(splitLines(before), splitLines(after));
  const context = 3;
  const output = [`--- ${fromName}`, `+++ ${toName}`];

  let index = 0;
  while (index < edits.length) {
    if (edits[index].kind === " ") {
      index++;
      continue;
    }

    // a hunk runs until two changes are more than twice the context apart
    const start = Math.max(0, index - context);
    let end = index;
    while (end < edits.length) {
      let next = end;
      while (next < edits.length && edits[next].kind === " ") next++;
      if (next >= edits.length || next - end > context * 2) break;
      end = next;
      while (end < edits.length && edits[end].kind !== " ") end++;
    }
    end = Math.min(edits.length, end + context);

    let beforeStart = 1;
    let afterStart = 1;
    for (let k = 0; k < start; k++) {
      if (edits[k].kind !== "+") beforeStart++;
      if (edits[k].kind !== "-") afterStart++;
    }
    const hunk = edits.slice(start, end);
    const beforeCount = hunk.filter((edit) => edit.kind !== "+").length;
    const afterCount = hunk.filter((edit) => edit.kind !== "-").length;

    output.push(
      `@@ -${beforeCount ? beforeStart : beforeStart - 1},${beforeCount} +${afterCount ? afterStart : afterStart - 1},${afterCount} @@`,
    );
    for (const edit of hunk) output.push(`${edit.kind}${edit.line}`);

    index = end;
  }

  return `${output.join("\n")}\n`;
}
