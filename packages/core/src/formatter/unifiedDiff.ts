type Edit = { kind: " " | "-" | "+"; line: string };

/** Line edits from a longest common subsequence. Definition files are small, so this is enough. */
function lineEdits(before: string[], after: string[]): Edit[] {
  const n = before.length;
  const m = after.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      edits.push({ kind: " ", line: before[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      edits.push({ kind: "-", line: before[i++] });
    } else {
      edits.push({ kind: "+", line: after[j++] });
    }
  }
  while (i < n) edits.push({ kind: "-", line: before[i++] });
  while (j < m) edits.push({ kind: "+", line: after[j++] });

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
