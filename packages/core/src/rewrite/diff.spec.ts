import { unifiedDiff } from "./diff";

describe("unifiedDiff", () => {
  it("prints changed lines with context", () => {
    expect(unifiedDiff("a.yml", "a.yml", "a: 1\nb: 2\n", "a: 1\n\nb: 2\n")).toBe(
      "--- a.yml\n+++ a.yml\n@@ -1,2 +1,3 @@\n a: 1\n+\n b: 2\n",
    );
  });

  it("splits changes far apart into separate hunks", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const after = before.replace("line 1\n", "line one\n").replace("line 18\n", "line eighteen\n");
    const diff = unifiedDiff("f", "f", before, after);

    expect(diff.match(/^@@/gm)).toHaveLength(2);
    expect(diff).toContain("-line 1\n+line one\n");
    expect(diff).toContain("-line 18\n+line eighteen\n");
  });
});
