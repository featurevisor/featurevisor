import { align } from "./lines";

describe("align", () => {
  const lines = (text: string) => text.split("");

  it("matches each line to its line on the longest common subsequence", () => {
    expect(align(lines("abcd"), lines("axcd"))).toEqual([0, -1, 2, 3]);
    expect(align(lines(""), lines("ab"))).toEqual([]);
    expect(align(lines("ab"), lines(""))).toEqual([-1, -1]);
  });

  it("matches a repeated line as early as it can, at either end", () => {
    expect(align(lines("xs"), lines("yss"))).toEqual([-1, 1]);
    expect(align(lines("yss"), lines("xs"))).toEqual([-1, -1, 1]);
  });

  it("aligns long texts that differ in a few lines", () => {
    const before = Array.from({ length: 20000 }, (_, index) => `line ${index}`);
    const after = [...before.slice(0, 10000), "added", ...before.slice(10000)];
    const matched = align(before, after);

    expect(matched[9999]).toBe(9999);
    expect(matched[10000]).toBe(10001);
    expect(matched[19999]).toBe(20000);
  });
});
